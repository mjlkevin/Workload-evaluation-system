// ============================================================
// Harness Recovery Coordinator
// ============================================================
// RP-047 Batch B：10s 扫描过期 lease、取消优先、最近兼容检查点
// 判定、最多 3 次自动恢复与 2/10/30s 退避。扫描只做调度决策，
// 真正的重跑由 Worker 在下次认领时完成。进程内 in-flight 集合
// 防止同一 Coordinator 并发扫描重复恢复；跨进程互斥由
// repository.scheduleRunRecovery 的行锁 + not_active 守卫兜底。

import type { HarnessRuntimeRepository } from "./harness-runtime.repository";
import {
  HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE,
  HARNESS_RECOVERY_LIMIT_ERROR_CODE,
  HARNESS_RECOVERY_TIMING_DEFAULTS,
  type HarnessRecoveryTiming,
} from "./harness-runtime.types";
import { selectHarnessResumeCheckpoint, type HarnessWorkflowRegistry } from "./harness-runtime.worker";

export type HarnessRecoveryScanOutcome =
  | "scheduled"
  | "limit_exceeded"
  | "cancelled"
  | "incompatible"
  | "skipped"
  | "error";

export type HarnessRecoveryScanResult = {
  runId: string;
  outcome: HarnessRecoveryScanOutcome;
  errorCode?: string;
};

export type HarnessRecoveryCoordinatorOptions = {
  repository: HarnessRuntimeRepository;
  registry: HarnessWorkflowRegistry;
  timing?: Partial<HarnessRecoveryTiming>;
  batchSize?: number;
  sleepMs?: (ms: number) => Promise<void>;
};

export type HarnessRecoveryCoordinator = {
  /** 扫描一次过期 lease 并对每个受损 Run 做出调度决策。 */
  scanOnce(): Promise<HarnessRecoveryScanResult[]>;
  /** 按 scanIntervalMs 持续扫描，直到 stop()。 */
  start(): Promise<void>;
  stop(): void;
};

const DEFAULT_BATCH_SIZE = 50;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHarnessRecoveryCoordinator(
  options: HarnessRecoveryCoordinatorOptions,
): HarnessRecoveryCoordinator {
  const timing: HarnessRecoveryTiming = { ...HARNESS_RECOVERY_TIMING_DEFAULTS, ...options.timing };
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const sleepMs = options.sleepMs ?? defaultSleep;
  const inFlight = new Set<string>();
  let stopping = false;

  async function scanOnce(): Promise<HarnessRecoveryScanResult[]> {
    const expired = await options.repository.findRunsWithExpiredActiveLease({ limit: batchSize });
    const results: HarnessRecoveryScanResult[] = [];
    for (const { run, attempt } of expired) {
      const runId = run.harnessRunId;
      if (inFlight.has(runId)) {
        results.push({ runId, outcome: "skipped" });
        continue;
      }
      inFlight.add(runId);
      try {
        // 取消优先：挂起取消的 Run 不消耗恢复预算，直接进入取消终态。
        if (run.cancelRequestedAt) {
          await options.repository.scheduleRunRecovery({
            runId,
            maxAutoRecoveries: timing.maxAutoRecoveries,
            backoffMs: timing.backoffMs,
          });
          results.push({ runId, outcome: "cancelled" });
          continue;
        }

        const checkpoints = await options.repository.listCheckpointsForRun({ runId });
        if (checkpoints.length > 0) {
          const workflow = options.registry.get(run.workflowId, run.workflowVersion);
          const selected = workflow
            ? selectHarnessResumeCheckpoint({ checkpoints, workflow, runId })
            : null;
          if (!selected) {
            // 有检查点但无一兼容：自动恢复无意义，直接判失败且不消耗恢复预算。
            await options.repository.completeAttemptAndRun({
              attemptId: attempt.harnessRunAttemptId,
              runId,
              outcome: "failed",
              errorCode: HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE,
              errorMessage: "no compatible checkpoint for automatic recovery",
            });
            results.push({ runId, outcome: "incompatible", errorCode: HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE });
            continue;
          }
        }
        // 零检查点：从头重启，仍走统一恢复调度（消耗一次恢复预算）。

        const scheduled = await options.repository.scheduleRunRecovery({
          runId,
          maxAutoRecoveries: timing.maxAutoRecoveries,
          backoffMs: timing.backoffMs,
        });
        if (scheduled.outcome === "scheduled") {
          results.push({ runId, outcome: "scheduled" });
        } else if (scheduled.outcome === "limit_exceeded") {
          results.push({ runId, outcome: "limit_exceeded", errorCode: HARNESS_RECOVERY_LIMIT_ERROR_CODE });
        } else if (scheduled.outcome === "cancelled") {
          results.push({ runId, outcome: "cancelled" });
        } else {
          // not_active：并发恢复方已接管，本次跳过。
          results.push({ runId, outcome: "skipped" });
        }
      } catch (err) {
        results.push({
          runId,
          outcome: "error",
          errorCode: err instanceof Error ? err.message.slice(0, 200) : "RECOVERY_SCAN_ERROR",
        });
      } finally {
        inFlight.delete(runId);
      }
    }
    return results;
  }

  return {
    scanOnce,
    async start() {
      while (!stopping) {
        await scanOnce();
        if (!stopping) await sleepMs(timing.scanIntervalMs);
      }
    },
    stop() {
      stopping = true;
    },
  };
}
