// ============================================================
// Harness 持久运行类型契约测试
// ============================================================
// RP-047 Batch A：冻结八态 Run 生命周期、运行时词汇与确定性
// effectKey，供 schema、repository 与后续 Worker 批次共享。

import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_CHECKPOINT_KINDS,
  HARNESS_PROJECTOR_TIMING_DEFAULTS,
  HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE,
  HARNESS_RECOVERY_LIMIT_ERROR_CODE,
  HARNESS_RECOVERY_TIMING_DEFAULTS,
  HARNESS_RUN_EVENT_TYPES,
  HARNESS_RUN_KINDS,
  HARNESS_RUN_TERMINAL_STATUSES,
  HARNESS_WORKER_TIMING_DEFAULTS,
  HARNESS_WORKER_VALIDATOR_VERSION,
  createHarnessEffectKey,
  isActiveHarnessRunStatus,
} from "./harness-runtime.types";
import { HARNESS_RUN_STATUSES } from "./harness.types";

test("durable run states distinguish active and terminal lifecycles", () => {
  assert.deepEqual(HARNESS_RUN_STATUSES, [
    "queued",
    "running",
    "waiting",
    "recovering",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
  ]);
  assert.equal(isActiveHarnessRunStatus("queued"), true);
  assert.equal(isActiveHarnessRunStatus("cancelling"), true);
  assert.equal(isActiveHarnessRunStatus("completed"), false);
  assert.deepEqual(HARNESS_RUN_TERMINAL_STATUSES, ["completed", "failed", "cancelled"]);
});

test("runtime vocabularies and effect keys are deterministic", () => {
  assert.deepEqual(HARNESS_RUN_KINDS, ["workbench_chat", "file_analysis", "replay", "regression"]);
  assert.deepEqual(HARNESS_CHECKPOINT_KINDS, ["structural", "semantic", "combined"]);
  assert.equal(
    createHarnessEffectKey({ runId: "run-1", stepKey: "tool.search", effectName: "knowledge.lookup", ordinal: 1 }),
    "run-1:tool.search:knowledge.lookup:1",
  );
});

// ============================================================
// RP-047 Batch B：时序默认常量、恢复/取消事件词汇（E1 additive）
// ============================================================

test("Batch B worker/recovery/projector timing defaults freeze roadmap constants", () => {
  assert.equal(HARNESS_WORKER_TIMING_DEFAULTS.leaseMs, 45_000, "lease 必须为 roadmap 口径 45s");
  assert.equal(HARNESS_WORKER_TIMING_DEFAULTS.heartbeatIntervalMs, 15_000, "heartbeat 必须为 roadmap 口径 15s");
  assert.equal(HARNESS_RECOVERY_TIMING_DEFAULTS.scanIntervalMs, 10_000, "扫描周期必须为 roadmap 口径 10s");
  assert.equal(HARNESS_RECOVERY_TIMING_DEFAULTS.maxAutoRecoveries, 3, "最多 3 次自动恢复");
  assert.deepEqual([...HARNESS_RECOVERY_TIMING_DEFAULTS.backoffMs], [2_000, 10_000, 30_000], "退避必须为 2/10/30s");
  assert.ok(HARNESS_PROJECTOR_TIMING_DEFAULTS.pollIntervalMs > 0);
});

test("Batch B adds recovery and cancellation event types additively (E1)", () => {
  const a2Frozen = [
    "run_queued",
    "run_claimed",
    "run_status_changed",
    "checkpoint_committed",
    "output_updated",
    "outbox_enqueued",
    "cancel_requested",
    "run_completed",
    "run_failed",
  ];
  for (const type of a2Frozen) {
    assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(type), `A2 事件类型 ${type} 不得移除`);
  }
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("recovery_started"));
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("recovery_completed"));
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("run_cancelled"));
  assert.equal(HARNESS_RUN_EVENT_TYPES.length, 14, "Batch B 词汇 12 类 + Batch C additive 追加 2 类 = 14");
});

test("Batch C adds inputs and confirmation event types additively (E1)", () => {
  const bFrozen = [
    "run_queued",
    "run_claimed",
    "run_status_changed",
    "checkpoint_committed",
    "output_updated",
    "outbox_enqueued",
    "cancel_requested",
    "run_completed",
    "run_failed",
    "recovery_started",
    "recovery_completed",
    "run_cancelled",
  ];
  for (const type of bFrozen) {
    assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(type), `A2/B 事件类型 ${type} 不得移除`);
  }
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("run_inputs_submitted"));
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("run_action_confirmed"));
  assert.equal(HARNESS_RUN_EVENT_TYPES.length, 14, "Batch C 只允许 additive 追加 2 类事件");
});

test("Batch B validator version and recovery error codes are frozen", () => {
  assert.equal(HARNESS_WORKER_VALIDATOR_VERSION, "harness-worker/v1");
  assert.equal(HARNESS_RECOVERY_LIMIT_ERROR_CODE, "RECOVERY_LIMIT_EXCEEDED");
  assert.equal(HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE, "RECOVERY_CHECKPOINT_INCOMPATIBLE");
});
