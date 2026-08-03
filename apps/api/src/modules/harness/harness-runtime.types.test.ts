// ============================================================
// Harness 持久运行类型契约测试
// ============================================================
// RP-047 Batch A：冻结八态 Run 生命周期、运行时词汇与确定性
// effectKey，供 schema、repository 与后续 Worker 批次共享。

import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_CHECKPOINT_KINDS,
  HARNESS_RUN_KINDS,
  HARNESS_RUN_TERMINAL_STATUSES,
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
