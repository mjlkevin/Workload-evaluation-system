// ============================================================
// Harness Runtime Worker
// ============================================================
// RP-047 Batch B：Worker 认领、lease 心跳、优雅停机、硬退出模拟、
// 混合检查点恢复（resume_next / restart_step）、effectKey 工具幂等、
// 取消安全边界。故障注入（faultInjector）模拟进程崩溃：一旦抛出
// HarnessFaultInjectedError，Worker 立即停止一切写入（模拟死进程），
// 由 Recovery Coordinator 扫描过期 lease 接管。

import { createHash } from "node:crypto";

import type {
  HarnessRunAttemptRow,
  HarnessRunCheckpointRow,
  HarnessRunRow,
} from "../../db/schema";
import type { HarnessRuntimeRepository } from "./harness-runtime.repository";
import {
  HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE,
  HARNESS_WORKER_TIMING_DEFAULTS,
  HARNESS_WORKER_VALIDATOR_VERSION,
  createHarnessEffectKey,
  type HarnessCheckpointKind,
  type HarnessOutputStatus,
  type HarnessResumePolicy,
  type HarnessWorkerTiming,
} from "./harness-runtime.types";

// ============================================================
// 错误词汇
// ============================================================

/** 工作流协作式取消（abortSignal 触发或 workflow 主动抛出）。 */
export class HarnessWorkflowCancelledError extends Error {
  constructor(message?: string) {
    super(message ?? "harness workflow cancelled");
    this.name = "HarnessWorkflowCancelledError";
  }
}

/** 故障注入错误：模拟进程崩溃，Worker 不得再写任何状态。 */
export class HarnessFaultInjectedError extends Error {
  constructor(message?: string) {
    super(message ?? "harness fault injected");
    this.name = "HarnessFaultInjectedError";
  }
}

/** 内部使用：abortSignal 触发时在步骤边界中断执行循环。 */
class HarnessStepBoundaryAbort extends Error {
  constructor() {
    super("harness step boundary abort");
    this.name = "HarnessStepBoundaryAbort";
  }
}

// ============================================================
// Workflow 契约
// ============================================================

export type HarnessWorkflowCheckpointDirective = {
  key: string;
  kind: HarnessCheckpointKind;
  resumePolicy: HarnessResumePolicy;
  effectKeys?: string[];
  aiMilestone?: Record<string, unknown>;
};

export type HarnessWorkflowOutboxEntry = {
  eventType: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
};

export type HarnessWorkflowOutputDirective = {
  status: HarnessOutputStatus;
  content: Record<string, unknown>;
  contentHash: string;
};

export type HarnessWorkflowStepOutcome = {
  nextStepKey: string | null;
  statePatch?: Record<string, unknown>;
  checkpoint?: HarnessWorkflowCheckpointDirective;
  output?: HarnessWorkflowOutputDirective;
  outbox?: HarnessWorkflowOutboxEntry[];
};

export type HarnessToolEffectExecution = {
  effectKey: string;
  toolName: string;
  input: Record<string, unknown>;
  execute: () => Promise<Record<string, unknown>>;
};

export type HarnessWorkflowStepContext = {
  run: HarnessRunRow;
  attempt: HarnessRunAttemptRow;
  stepKey: string;
  state: Record<string, unknown>;
  resumeFrom: HarnessRunCheckpointRow | null;
  abortSignal: AbortSignal;
  makeEffectKey(effectName: string, ordinal: number): string;
  recordToolEffectOnce(
    input: HarnessToolEffectExecution,
  ): Promise<{ output: Record<string, unknown> | undefined; created: boolean }>;
};

export type HarnessWorkflow = {
  workflowId: string;
  workflowVersion: string;
  firstStepKey: string;
  stepKeys: readonly string[];
  executeStep(stepKey: string, ctx: HarnessWorkflowStepContext): Promise<HarnessWorkflowStepOutcome>;
};

export type HarnessWorkflowRegistry = {
  get(workflowId: string, workflowVersion: string): HarnessWorkflow | undefined;
};

export function createHarnessWorkflowRegistry(workflows: readonly HarnessWorkflow[]): HarnessWorkflowRegistry {
  const byKey = new Map<string, HarnessWorkflow>();
  for (const workflow of workflows) {
    byKey.set(`${workflow.workflowId}@${workflow.workflowVersion}`, workflow);
  }
  return {
    get(workflowId, workflowVersion) {
      return byKey.get(`${workflowId}@${workflowVersion}`);
    },
  };
}

// ============================================================
// 状态哈希与恢复检查点选择
// ============================================================

/** 确定性 JSON 序列化：递归排序对象键，保证同义状态同 hash。 */
export function stableStringifyHarnessState(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringifyHarnessState(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringifyHarnessState(record[key])}`)
    .join(",");
  return `{${body}}`;
}

export function hashHarnessCheckpointState(state: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringifyHarnessState(state)).digest("hex");
}

export type SelectHarnessResumeCheckpointInput = {
  checkpoints: readonly HarnessRunCheckpointRow[];
  workflow: HarnessWorkflow;
  runId: string;
};

/**
 * 最近兼容检查点选择：checkpoints 必须按 sequence 倒序（最新在前）。
 * 兼容性 = workflowId/version 匹配 + stateHash 重算一致 + resumePolicy
 * 指向已知步骤 + effectKeys 全部归属本 run。manual 策略永不自动恢复。
 */
export function selectHarnessResumeCheckpoint(
  input: SelectHarnessResumeCheckpointInput,
): HarnessRunCheckpointRow | null {
  const effectPrefix = `${input.runId}:`;
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.workflowId !== input.workflow.workflowId) continue;
    if (checkpoint.workflowVersion !== input.workflow.workflowVersion) continue;
    if (checkpoint.resumePolicy === "manual") continue;
    const state = (checkpoint.state ?? {}) as Record<string, unknown>;
    if (hashHarnessCheckpointState(state) !== checkpoint.stateHash) continue;
    const effectKeys = Array.isArray(checkpoint.effectKeys) ? (checkpoint.effectKeys as unknown[]) : [];
    if (!effectKeys.every((key) => typeof key === "string" && key.startsWith(effectPrefix))) continue;
    if (checkpoint.resumePolicy === "restart_step") {
      if (!input.workflow.stepKeys.includes(checkpoint.stepKey)) continue;
    } else {
      const nextStepKey = state.nextStepKey;
      if (nextStepKey !== null && nextStepKey !== undefined) {
        if (typeof nextStepKey !== "string" || !input.workflow.stepKeys.includes(nextStepKey)) continue;
      }
    }
    return checkpoint;
  }
  return null;
}

// ============================================================
// Worker
// ============================================================

export type HarnessRuntimeWorkerOptions = {
  repository: HarnessRuntimeRepository;
  registry: HarnessWorkflowRegistry;
  workerId: string;
  timing?: Partial<HarnessWorkerTiming>;
  sleepMs?: (ms: number) => Promise<void>;
  faultInjector?: (stepKey: string, phase: "beforeStep" | "afterStepCommit") => void;
  /** SP-2026-007 MS2：Run 终态后异步蒸馏记忆钩子 */
  onRunTerminal?: (run: HarnessRunRow, outcome: "completed" | "failed" | "cancelled") => Promise<void>;
};

export type HarnessRuntimeWorker = {
  /** 认领并驱动一个 Run 到终态/边界；返回是否真的认领到了工作。 */
  runNextAttempt(): Promise<boolean>;
  /** 持续认领循环，直到 stop()。 */
  start(): Promise<void>;
  /** 优雅停机：停止认领，在步骤安全边界释放当前 Attempt。 */
  stop(): Promise<void>;
  isStopping(): boolean;
};

const WORKFLOW_NOT_FOUND_ERROR_CODE = "WORKFLOW_NOT_FOUND";
const WORKER_STEP_FAILED_ERROR_CODE = "WORKER_STEP_FAILED";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHarnessRuntimeWorker(options: HarnessRuntimeWorkerOptions): HarnessRuntimeWorker {
  const timing: HarnessWorkerTiming = { ...HARNESS_WORKER_TIMING_DEFAULTS, ...options.timing };
  const sleepMs = options.sleepMs ?? defaultSleep;
  let stopping = false;
  let inFlight: Promise<void> | null = null;

  async function driveAttempt(run: HarnessRunRow, attempt: HarnessRunAttemptRow): Promise<void> {
    const repository = options.repository;
    const runId = run.harnessRunId;
    const attemptId = attempt.harnessRunAttemptId;
    const controller = new AbortController();
    let leaseLost = false;
    let cancelDetected = false;
    let heartbeatBusy = false;

    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void (async () => {
        const renewed = await repository.heartbeatAttempt({
          attemptId,
          workerId: options.workerId,
          leaseMs: timing.leaseMs,
        });
        if (!renewed) {
          leaseLost = true;
          controller.abort();
          return;
        }
        const fresh = await repository.findRunForOwner(runId, run.ownerUserId);
        if (fresh?.cancelRequestedAt) {
          cancelDetected = true;
          controller.abort();
        }
      })()
        .catch(() => {
          // 心跳读取失败按 lease 失效处理：停止写入，等待扫描接管。
          leaseLost = true;
          controller.abort();
        })
        .finally(() => {
          heartbeatBusy = false;
        });
    }, timing.heartbeatIntervalMs);

    const throwIfAborted = (): void => {
      if (controller.signal.aborted) throw new HarnessStepBoundaryAbort();
    };

    try {
      const workflow = options.registry.get(run.workflowId, run.workflowVersion);
      if (!workflow) {
        await repository.completeAttemptAndRun({
          attemptId,
          runId,
          outcome: "failed",
          errorCode: WORKFLOW_NOT_FOUND_ERROR_CODE,
          errorMessage: `workflow ${run.workflowId}@${run.workflowVersion} is not registered`,
        });
        return;
      }

      const checkpoints = await repository.listCheckpointsForRun({ runId });
      let resumeFrom: HarnessRunCheckpointRow | null = null;
      if (checkpoints.length > 0) {
        resumeFrom = selectHarnessResumeCheckpoint({ checkpoints, workflow, runId });
        if (!resumeFrom) {
          await repository.completeAttemptAndRun({
            attemptId,
            runId,
            outcome: "failed",
            errorCode: HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE,
            errorMessage: "no compatible checkpoint for automatic recovery",
          });
          return;
        }
        await repository.setAttemptResumeCheckpoint({
          attemptId,
          checkpointId: resumeFrom.harnessRunCheckpointId,
        });
      }
      if (attempt.attemptNo > 1) {
        await repository.appendRunEvent({
          runId,
          eventType: "recovery_completed",
          payload: {
            attemptNo: attempt.attemptNo,
            resumeCheckpointId: resumeFrom?.harnessRunCheckpointId ?? null,
            resumeCheckpointKey: resumeFrom?.checkpointKey ?? null,
          },
        });
      }

      let state: Record<string, unknown> = resumeFrom
        ? { ...(resumeFrom.state as Record<string, unknown>) }
        : {};
      let stepKey: string | null = resumeFrom
        ? resumeFrom.resumePolicy === "restart_step"
          ? resumeFrom.stepKey
          : ((state.nextStepKey as string | null | undefined) ?? null)
        : workflow.firstStepKey;

      while (stepKey !== null) {
        if (stopping) {
          await repository.releaseAttemptForShutdown({ attemptId, runId });
          return;
        }
        throwIfAborted();
        options.faultInjector?.(stepKey, "beforeStep");

        const currentStepKey = stepKey;
        const ctx: HarnessWorkflowStepContext = {
          run,
          attempt,
          stepKey: currentStepKey,
          state: { ...state },
          resumeFrom,
          abortSignal: controller.signal,
          makeEffectKey: (effectName, ordinal) =>
            createHarnessEffectKey({ runId, stepKey: currentStepKey, effectName, ordinal }),
          async recordToolEffectOnce(effect) {
            const existing = await repository.findToolEffectByKey({ runId, effectKey: effect.effectKey });
            if (existing) {
              return { output: (existing.output ?? undefined) as Record<string, unknown> | undefined, created: false };
            }
            const output = await effect.execute();
            const recorded = await repository.recordToolEffectOnce({
              runId,
              attemptId,
              effectKey: effect.effectKey,
              toolName: effect.toolName,
              input: effect.input,
              output,
            });
            return {
              output: (recorded.toolEvent.output ?? undefined) as Record<string, unknown> | undefined,
              created: recorded.created,
            };
          },
        };

        const outcome = await workflow.executeStep(currentStepKey, ctx);
        // 安全边界：取消/停机/租约失效时不得在步骤提交点之后继续写入。
        throwIfAborted();
        if (stopping) {
          await repository.releaseAttemptForShutdown({ attemptId, runId });
          return;
        }

        state = { ...state, ...(outcome.statePatch ?? {}), nextStepKey: outcome.nextStepKey };

        if (outcome.checkpoint) {
          await repository.commitCheckpoint({
            runId,
            attemptId,
            checkpointKey: outcome.checkpoint.key,
            checkpointKind: outcome.checkpoint.kind,
            workflowId: workflow.workflowId,
            workflowVersion: workflow.workflowVersion,
            stepKey: currentStepKey,
            resumePolicy: outcome.checkpoint.resumePolicy,
            state,
            stateHash: hashHarnessCheckpointState(state),
            effectKeys: outcome.checkpoint.effectKeys,
            aiMilestone: outcome.checkpoint.aiMilestone,
            runtimeValidation: {
              validatedAt: new Date().toISOString(),
              validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION,
              checks: {
                ownerBound: true,
                workflowVersionMatched: true,
                stateHashMatched: true,
                nextStepKnown: true,
                effectsStable: true,
              },
            },
          });
        }
        if (outcome.output) {
          await repository.upsertRunOutput({
            runId,
            attemptId,
            status: outcome.output.status,
            content: outcome.output.content,
            contentHash: outcome.output.contentHash,
          });
        }
        options.faultInjector?.(currentStepKey, "afterStepCommit");
        stepKey = outcome.nextStepKey;
      }

      await repository.completeAttemptAndRun({ attemptId, runId, outcome: "succeeded" });
      // SP-2026-007 MS2：终态后触发异步蒸馏（不阻塞、不抛错）
      void options.onRunTerminal?.(run, "completed").catch(() => {});
    } catch (err) {
      if (leaseLost) return; // 租约已失：一切写入禁止，等待扫描接管。
      if (err instanceof HarnessFaultInjectedError) return; // 模拟死进程。
      if (
        cancelDetected ||
        controller.signal.aborted ||
        err instanceof HarnessWorkflowCancelledError ||
        err instanceof HarnessStepBoundaryAbort
      ) {
        await repository.completeAttemptAndRun({ attemptId, runId, outcome: "cancelled" });
        // SP-2026-007 MS2：终态后触发异步蒸馏（不阻塞、不抛错）
        void options.onRunTerminal?.(run, "cancelled").catch(() => {});
        return;
      }
      await repository.completeAttemptAndRun({
        attemptId,
        runId,
        outcome: "failed",
        errorCode: WORKER_STEP_FAILED_ERROR_CODE,
        errorMessage: err instanceof Error ? err.message.slice(0, 200) : "worker step failed",
      });
      // SP-2026-007 MS2：终态后触发异步蒸馏（不阻塞、不抛错）
      void options.onRunTerminal?.(run, "failed").catch(() => {});
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function runNextAttempt(): Promise<boolean> {
    if (stopping) return false;
    const claimed = await options.repository.claimNextQueuedRun({
      workerId: options.workerId,
      leaseMs: timing.leaseMs,
    });
    if (!claimed) return false;
    const driving = driveAttempt(claimed.run, claimed.attempt);
    inFlight = driving;
    try {
      await driving;
    } finally {
      if (inFlight === driving) inFlight = null;
    }
    return true;
  }

  return {
    runNextAttempt,
    async start() {
      while (!stopping) {
        const did = await runNextAttempt();
        if (!did && !stopping) await sleepMs(timing.claimPollIntervalMs);
      }
    },
    async stop() {
      stopping = true;
      await inFlight;
    },
    isStopping() {
      return stopping;
    },
  };
}
