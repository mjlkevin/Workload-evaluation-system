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
