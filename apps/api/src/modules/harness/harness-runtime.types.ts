// ============================================================
// Harness 持久运行 Runtime 类型
// ============================================================
// RP-047 Batch A：定义 durable Run 的 runKind、Attempt/Checkpoint/
// Output/Outbox 状态词汇、事件类型与确定性 effectKey。本文件不含
// 数据库访问逻辑，供 schema、repository 与后续批次共享契约。

import type { HarnessRunStatus } from "./harness.types";

export const HARNESS_RUN_KINDS = ["workbench_chat", "file_analysis", "replay", "regression"] as const;
export type HarnessRunKind = (typeof HARNESS_RUN_KINDS)[number];

export const HARNESS_RUN_ACTIVE_STATUSES = ["queued", "running", "waiting", "recovering", "cancelling"] as const;
export type HarnessRunActiveStatus = (typeof HARNESS_RUN_ACTIVE_STATUSES)[number];

export const HARNESS_RUN_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
export type HarnessRunTerminalStatus = (typeof HARNESS_RUN_TERMINAL_STATUSES)[number];

export const HARNESS_ATTEMPT_STATUSES = ["claimed", "running", "succeeded", "failed", "orphaned", "cancelled"] as const;
export type HarnessAttemptStatus = (typeof HARNESS_ATTEMPT_STATUSES)[number];

export const HARNESS_CHECKPOINT_KINDS = ["structural", "semantic", "combined"] as const;
export type HarnessCheckpointKind = (typeof HARNESS_CHECKPOINT_KINDS)[number];

export const HARNESS_RESUME_POLICIES = ["resume_next", "restart_step", "manual"] as const;
export type HarnessResumePolicy = (typeof HARNESS_RESUME_POLICIES)[number];

export const HARNESS_OUTPUT_STATUSES = ["partial", "final"] as const;
export type HarnessOutputStatus = (typeof HARNESS_OUTPUT_STATUSES)[number];

export const HARNESS_OUTBOX_STATUSES = ["pending", "processing", "published", "failed"] as const;
export type HarnessOutboxStatus = (typeof HARNESS_OUTBOX_STATUSES)[number];

export const HARNESS_RUN_EVENT_TYPES = [
  "run_queued",
  "run_claimed",
  "run_status_changed",
  "checkpoint_committed",
  "output_updated",
  "outbox_enqueued",
  "cancel_requested",
  "run_completed",
  "run_failed",
  // RP-047 Batch B（扩展项 E1，additive）：恢复与取消终态事件
  "recovery_started",
  "recovery_completed",
  "run_cancelled",
  // RP-047 Batch C（扩展项 E1，additive）：补充信息与确认闸门事件
  "run_inputs_submitted",
  "run_action_confirmed",
  // ISS-2026-08-10-004（additive）：逐字流式与模型思考事件——
  // 前端消费侧（useChatMessages STREAM_EVENT_TYPES）与 SSE 透传链路已就绪，
  // 异步 worker 经 streamingAdapter.onToken 逐 chunk 写入 run 事件流。
  "text.delta",
  "thought",
] as const;
export type HarnessRunEventType = (typeof HARNESS_RUN_EVENT_TYPES)[number];

export type HarnessEffectKeyInput = {
  runId: string;
  stepKey: string;
  effectName: string;
  ordinal: number;
};

export function isActiveHarnessRunStatus(status: HarnessRunStatus): boolean {
  return (HARNESS_RUN_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function createHarnessEffectKey(input: HarnessEffectKeyInput): string {
  return `${input.runId}:${input.stepKey}:${input.effectName}:${input.ordinal}`;
}

// ============================================================
// RP-047 Batch B：Worker / Recovery Coordinator / Projector 时序契约
// ============================================================
// 生产默认常量冻结 roadmap Task 2 口径：45s lease、15s heartbeat、
// 10s 恢复扫描、最多 3 次自动恢复、2/10/30s 退避。全部可注入，
// 故障注入测试以小值覆盖，默认常量由类型测试守护。

export type HarnessWorkerTiming = {
  leaseMs: number;
  heartbeatIntervalMs: number;
  claimPollIntervalMs: number;
  concurrency: number;
};

export const HARNESS_WORKER_TIMING_DEFAULTS: HarnessWorkerTiming = {
  leaseMs: 45_000,
  heartbeatIntervalMs: 15_000,
  claimPollIntervalMs: 2_000,
  concurrency: 1,
};

export type HarnessRecoveryTiming = {
  scanIntervalMs: number;
  maxAutoRecoveries: number;
  backoffMs: readonly number[];
};

export const HARNESS_RECOVERY_TIMING_DEFAULTS: HarnessRecoveryTiming = {
  scanIntervalMs: 10_000,
  maxAutoRecoveries: 3,
  backoffMs: [2_000, 10_000, 30_000],
};

export type HarnessProjectorTiming = {
  pollIntervalMs: number;
  lockMs: number;
  maxAttempts: number;
  retryAfterMs: number;
};

export const HARNESS_PROJECTOR_TIMING_DEFAULTS: HarnessProjectorTiming = {
  pollIntervalMs: 5_000,
  lockMs: 30_000,
  maxAttempts: 5,
  retryAfterMs: 10_000,
};

/** checkpoint runtimeValidation 的 validatorVersion 固定值。 */
export const HARNESS_WORKER_VALIDATOR_VERSION = "harness-worker/v1";

/** 自动恢复次数超限后的 Run 失败码（roadmap Task 2 原文）。 */
export const HARNESS_RECOVERY_LIMIT_ERROR_CODE = "RECOVERY_LIMIT_EXCEEDED";

/** 没有任何兼容检查点时的 Run 失败码（设计稿 §8.3）。 */
export const HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE = "RECOVERY_CHECKPOINT_INCOMPATIBLE";
