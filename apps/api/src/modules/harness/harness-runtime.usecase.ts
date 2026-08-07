// ============================================================
// AI Runs 异步 Run usecase（RP-047 Batch C）
// ============================================================
// 规格 §11：POST /ai-sessions/:sessionId/runs 202 幂等提交、active Runs
// 列表、Run snapshot、cancel/inputs/confirm/retry 动作与 Session 删除
// 409 保护的业务规则层。
//
// 安全边界：
//   - 非 owner / 不存在的 Run 与 Session 一律 404，不泄露存在性（G2）。
//   - feature flag 关闭时所有新端点 503 ASYNC_RUNS_DISABLED（G4，D2）。
//   - repository 错误只消费固定 code，不穿透 Drizzle/pg 原始错误。
//   - 单向依赖：ai-sessions.usecase 引入本文件的 AiRunsConflictError，
//     本文件仅 type-import ai-sessions.types，避免循环导入。

import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import type { AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import { HarnessRuntimeError } from "./harness-runtime.repository";

// ============================================================
// 错误类型（状态码矩阵 §2 冻结）
// ============================================================

export class AiRunsDisabledError extends Error {
  readonly status = 503;
  readonly code = "ASYNC_RUNS_DISABLED";

  constructor(message = "异步 Run 能力未启用") {
    super(message);
    this.name = "AiRunsDisabledError";
  }
}

export class AiRunsNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "资源不存在") {
    super(message);
    this.name = "AiRunsNotFoundError";
  }
}

export class AiRunsConflictError extends Error {
  readonly status = 409;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AiRunsConflictError";
    this.code = code;
  }
}

export class AiRunsValidationError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "AiRunsValidationError";
  }
}

// ============================================================
// feature flag（D2：读取点收敛，只认字符串 "true"）
// ============================================================

export function isDurableRunsEnabledFromEnv(): boolean {
  return process.env.WES_AI_DURABLE_RUNS_ENABLED === "true";
}

// ============================================================
// repository 鸭子端口（真实实现为 HarnessRuntimeRepository；
// 测试以内存 fake 注入。deps.repo 类型保持开放以兼容 fake 注入，
// 内部按本端口消费。）
// ============================================================

export type AiRunsRepoPort = {
  createQueuedRun(input: {
    ownerUserId: string;
    ownerUsername: string;
    aiSessionId: string;
    submissionKey: string;
    title: string;
    workflowId: string;
    workflowVersion: string;
    executionConfig?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    retryOfRunId?: string;
  }): Promise<{ run: Record<string, unknown>; created: boolean }>;
  findRunForOwner(runId: string, ownerUserId: string): Promise<Record<string, unknown> | null>;
  listActiveRunsForOwner(ownerUserId: string): Promise<Array<Record<string, unknown>>>;
  getRunSnapshot(
    runId: string,
  ): Promise<{ run: Record<string, unknown>; attempt: unknown; checkpoint: unknown; output: unknown } | null>;
  requestRunCancel(input: {
    runId: string;
    requestedBy: string;
  }): Promise<{ changed: boolean; run: Record<string, unknown> }>;
  submitRunInput(input: {
    runId: string;
    input: Record<string, unknown>;
    requestedBy: string;
  }): Promise<{ run: Record<string, unknown>; event: Record<string, unknown> }>;
  confirmRunAction(input: {
    runId: string;
    actionId: string;
    confirmedBy: string;
  }): Promise<{ created: boolean; run: Record<string, unknown>; event: Record<string, unknown> | null }>;
};

export type AiRunsUsecaseDeps = {
  // 鸭子类型端口：生产接 createHarnessRuntimeRepository(db)，测试接内存 fake
  repo: any;
  enabled: boolean;
  findSession: (user: AuthUser, sessionId: string) => Promise<AiSessionRecord | null>;
};

export type AiRunsSubmitInput = {
  submissionKey?: unknown;
  clientMessageId?: unknown;
  content?: unknown;
};

export type AiRunsSubmitResult = {
  status: 202;
  data: { runId: string; sessionId: string; status: string; eventCursor: number };
};

export type AiRunsUsecase = ReturnType<typeof createAiRunsUsecase>;

// ============================================================
// 内部工具
// ============================================================

const TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];
const WORKBENCH_WORKFLOW_ID = "workbench_chat_v1";
const WORKBENCH_WORKFLOW_VERSION = "1.0.0";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRepo(deps: AiRunsUsecaseDeps): AiRunsRepoPort {
  return deps.repo as AiRunsRepoPort;
}

function assertEnabled(deps: AiRunsUsecaseDeps): void {
  if (!deps.enabled) throw new AiRunsDisabledError();
}

/** repository 固定 code → API 冲突码映射（其余原样上抛由 controller 兜底）。 */
function mapRepoConflict(err: unknown): never {
  if (err instanceof HarnessRuntimeError) {
    if (err.code === "ACTIVE_WORKBENCH_RUN_EXISTS") {
      throw new AiRunsConflictError("SESSION_HAS_ACTIVE_RUN", "该会话存在进行中的异步任务");
    }
    if (err.code === "HARNESS_RUN_NOT_WAITING") {
      throw new AiRunsConflictError("RUN_NOT_WAITING", "仅 waiting 状态的任务可执行该动作");
    }
  }
  throw err;
}

/** 包装 createQueuedRun 调用：冲突码映射，其余错误上抛。 */
async function createRunOrThrow(
  call: () => Promise<{ run: Record<string, unknown>; created: boolean }>,
): Promise<{ run: Record<string, unknown>; created: boolean }> {
  try {
    return await call();
  } catch (err) {
    mapRepoConflict(err);
  }
}

// ============================================================
// 工厂
// ============================================================

export function createAiRunsUsecase(deps: AiRunsUsecaseDeps) {
  const repo = toRepo(deps);

  /** C1 提交契约：202 + submissionKey 幂等；flag/校验/归属顺序冻结。 */
  async function submitRun(user: AuthUser, sessionId: string, input: AiRunsSubmitInput): Promise<AiRunsSubmitResult> {
    assertEnabled(deps);
    const submissionKey = asText(input.submissionKey);
    if (!submissionKey) throw new AiRunsValidationError("submissionKey 必填");
    const content = asText(input.content);
    if (!content) throw new AiRunsValidationError("content 不能为空");

    const session = await deps.findSession(user, sessionId);
    if (!session) throw new AiRunsNotFoundError("会话不存在");

    const clientMessageId = asText(input.clientMessageId);
    const metadata: Record<string, unknown> = {};
    if (clientMessageId) metadata.clientMessageId = clientMessageId;

    const created = await createRunOrThrow(() =>
      repo.createQueuedRun({
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: sessionId,
        submissionKey,
        title: content.slice(0, 80),
        workflowId: WORKBENCH_WORKFLOW_ID,
        workflowVersion: WORKBENCH_WORKFLOW_VERSION,
        executionConfig: { content },
        metadata,
      }),
    );

    return {
      status: 202,
      data: {
        runId: String(created.run.harnessRunId),
        sessionId,
        status: String(created.run.status ?? "queued"),
        eventCursor: Number(created.run.eventSequence ?? 1),
      },
    };
  }

  /** C1 读取：当前用户活跃任务列表（供 Shell 恢复）。 */
  async function listActiveRuns(user: AuthUser) {
    assertEnabled(deps);
    const runs = await repo.listActiveRunsForOwner(user.id);
    return runs.map((run) => ({
      runId: String(run.harnessRunId),
      sessionId: run.aiSessionId === null || run.aiSessionId === undefined ? null : String(run.aiSessionId),
      title: String(run.title ?? ""),
      status: String(run.status ?? ""),
      eventCursor: Number(run.eventSequence ?? 0),
      createdAt: run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt ?? ""),
      updatedAt: run.updatedAt instanceof Date ? run.updatedAt.toISOString() : String(run.updatedAt ?? ""),
    }));
  }

  /** C1 读取：Run snapshot（run + 当前 attempt + 最近检查点 + output）。 */
  async function getRunSnapshot(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const snapshot = await repo.getRunSnapshot(runId);
    if (!snapshot || snapshot.run.ownerUserId !== user.id) throw new AiRunsNotFoundError("任务不存在");
    return snapshot;
  }

  /** C3 动作：cancel。active 返回 202，终态 409，非 owner 404。 */
  async function cancelRun(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    if (TERMINAL_STATUSES.includes(String(run.status))) {
      throw new AiRunsConflictError("RUN_ALREADY_TERMINAL", "任务已进入终态，无法取消");
    }
    const result = await repo.requestRunCancel({ runId, requestedBy: user.id });
    if (!result.changed) {
      throw new AiRunsConflictError("RUN_ALREADY_TERMINAL", "任务已进入终态，无法取消");
    }
    return { status: 202 as const, data: { runId, status: String(result.run.status ?? "cancelling") } };
  }

  /** C3 动作：inputs。waiting Run 收到补充信息后回到 queued 续跑。 */
  async function submitInputs(user: AuthUser, runId: string, body: { input?: unknown }) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    if (!isPlainObject(body.input) || Object.keys(body.input).length === 0) {
      throw new AiRunsValidationError("input 必须是非空对象");
    }
    let result: { run: Record<string, unknown>; event: Record<string, unknown> };
    try {
      result = await repo.submitRunInput({ runId, input: body.input, requestedBy: user.id });
    } catch (err) {
      return mapRepoConflict(err);
    }
    return { status: 202 as const, data: { runId, status: String(result.run.status ?? "queued") } };
  }

  /** C3 动作：confirm 幂等确认闸门。首次 202，重放 200 且不重复事件。 */
  async function confirmAction(user: AuthUser, runId: string, actionId: unknown) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    const actionKey = asText(actionId);
    if (!actionKey) throw new AiRunsValidationError("actionId 必填");
    let result: { created: boolean; run: Record<string, unknown>; event: Record<string, unknown> | null };
    try {
      result = await repo.confirmRunAction({ runId, actionId: actionKey, confirmedBy: user.id });
    } catch (err) {
      return mapRepoConflict(err);
    }
    return {
      status: result.created ? (202 as const) : (200 as const),
      data: { runId, actionId: actionKey, status: String(result.run.status ?? "") },
    };
  }

  /** C3 动作：retry。仅 failed 终态可重试；新 Run 带 retryOfRunId，原 Run 行零变更。 */
  async function retryRun(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    if (String(run.status) !== "failed") {
      throw new AiRunsConflictError("RUN_NOT_FAILED", "仅失败终态的任务可重试");
    }

    const metadata = isPlainObject(run.metadata)
      ? JSON.parse(JSON.stringify(run.metadata))
      : {};
    // clientMessageId 属于原次提交，重试是新提交，不继承乐观 UI 对齐键
    delete metadata.clientMessageId;

    const sessionId = run.aiSessionId === null || run.aiSessionId === undefined ? "" : String(run.aiSessionId);
    if (!sessionId) {
      // 无 Session 绑定的 Run（非 workbench 提交路径）不在本 API 重试范围
      throw new AiRunsConflictError("RUN_NOT_RETRYABLE", "任务未绑定会话，无法重试");
    }

    const created = await createRunOrThrow(() =>
      repo.createQueuedRun({
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: sessionId,
        submissionKey: randomUUID(),
        title: String(run.title ?? ""),
        workflowId: String(run.workflowId ?? WORKBENCH_WORKFLOW_ID),
        workflowVersion: String(run.workflowVersion ?? WORKBENCH_WORKFLOW_VERSION),
        executionConfig: isPlainObject(run.executionConfig)
          ? (JSON.parse(JSON.stringify(run.executionConfig)) as Record<string, unknown>)
          : {},
        metadata,
        retryOfRunId: runId,
      }),
    );

    return {
      status: 202 as const,
      data: {
        runId: String(created.run.harnessRunId),
        sessionId: run.aiSessionId === null || run.aiSessionId === undefined ? null : String(run.aiSessionId),
        status: String(created.run.status ?? "queued"),
        retryOfRunId: runId,
      },
    };
  }

  return {
    submitRun,
    listActiveRuns,
    getRunSnapshot,
    cancelRun,
    submitInputs,
    confirmAction,
    retryRun,
  };
}
