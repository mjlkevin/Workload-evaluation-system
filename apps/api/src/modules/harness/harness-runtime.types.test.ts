// ============================================================
// Harness 持久运行类型契约测试
// ============================================================
// RP-047 Batch A：冻结八态 Run 生命周期、运行时词汇与确定性
// effectKey，供 schema、repository 与后续 Worker 批次共享。

import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_CHECKPOINT_KINDS,
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
// S2b-2（2026-08-28）：projector timing 常量已随 §4.8 补偿链删除，
// 本用例仅保留 worker/recovery 口径。

test("Batch B worker/recovery timing defaults freeze roadmap constants", () => {
  assert.equal(HARNESS_WORKER_TIMING_DEFAULTS.leaseMs, 45_000, "lease 必须为 roadmap 口径 45s");
  assert.equal(HARNESS_WORKER_TIMING_DEFAULTS.heartbeatIntervalMs, 15_000, "heartbeat 必须为 roadmap 口径 15s");
  assert.equal(HARNESS_RECOVERY_TIMING_DEFAULTS.scanIntervalMs, 10_000, "扫描周期必须为 roadmap 口径 10s");
  assert.equal(HARNESS_RECOVERY_TIMING_DEFAULTS.maxAutoRecoveries, 3, "最多 3 次自动恢复");
  assert.deepEqual([...HARNESS_RECOVERY_TIMING_DEFAULTS.backoffMs], [2_000, 10_000, 30_000], "退避必须为 2/10/30s");
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
  assert.equal(
    HARNESS_RUN_EVENT_TYPES.length,
    20,
    "Batch B 词汇 12 类 + Batch C/ISS-004/批次0.5 additive 追加 2+2+4 类 = 20",
  );
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
  assert.equal(
    HARNESS_RUN_EVENT_TYPES.length,
    20,
    "Batch C + ISS-004/批次0.5 additive 追加 2+4 类事件 = 20",
  );
});

test("Batch B validator version and recovery error codes are frozen", () => {
  assert.equal(HARNESS_WORKER_VALIDATOR_VERSION, "harness-worker/v1");
  assert.equal(HARNESS_RECOVERY_LIMIT_ERROR_CODE, "RECOVERY_LIMIT_EXCEEDED");
  assert.equal(HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE, "RECOVERY_CHECKPOINT_INCOMPATIBLE");
});

// ============================================================
// ISS-2026-08-10-004：流式逐字/思考事件类型（additive）
// ============================================================
// 前端消费侧（useChatMessages STREAM_EVENT_TYPES）与 SSE 透传链路已就绪；
// appendRunEvent 白名单校验此前拒绝 text.delta/thought，异步通道无从发射。

test("ISS-2026-08-10-004 adds streaming text.delta/thought event types additively", () => {
  const cFrozen = [
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
    "run_inputs_submitted",
    "run_action_confirmed",
  ];
  for (const type of cFrozen) {
    assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(type), `A2/B/C 事件类型 ${type} 不得移除`);
  }
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("text.delta"), "逐字流式事件类型必须入白名单");
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("thought"), "模型思考事件类型必须入白名单");
  assert.equal(
    HARNESS_RUN_EVENT_TYPES.length,
    20,
    "ISS-004 之后的词汇 + 批次0.5 additive 追加 4 类工具事件（16 → 20）",
  );
});

// ============================================================
// 批次 0.5（additive）：工具调用可视化事件词汇
// ============================================================
// 批次 0 让工作台真正执行只读工具，但调用对用户完全不可见。本批把
// 「模型请求调用 → 执行中 → 成功/失败」四态写入 run 事件流。
// 四条独立类型而非一条 + status：本表的作用是**把词汇锁进契约**，
// 把状态塞进 payload 等于造一个不受白名单校验的联合类型——绕过白名单。
// tool.call.progress 是唯一真正新增的状态（AgentEvent 无对应 kind，
// 由事件映射层在 tool_call 与 tool_result 之间派生心跳）。
// confirm 相关类型属批次 1，本批不预登记（见下方负向守护）。

test("批次0.5 adds tool.call.* event types additively", () => {
  const dFrozen = [
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
    "run_inputs_submitted",
    "run_action_confirmed",
    "text.delta",
    "thought",
  ];
  for (const type of dFrozen) {
    assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(type), `ISS-004 前词汇 ${type} 不得移除`);
  }
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("tool.call.started"), "工具调用开始必须入白名单");
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("tool.call.progress"), "工具执行进度必须入白名单");
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("tool.call.completed"), "工具调用成功必须入白名单");
  assert.ok((HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("tool.call.failed"), "工具调用失败必须入白名单");
  assert.equal(HARNESS_RUN_EVENT_TYPES.length, 20, "批次0.5 只允许 additive 追加 4 类事件（16 → 20）");

  // 点号命名族必须恰好是这 4 条：不得夹带其他 tool.* 变体（防词汇漂移）
  const toolFamily = HARNESS_RUN_EVENT_TYPES.filter((type) => type.startsWith("tool."));
  assert.deepEqual(
    [...toolFamily].sort(),
    ["tool.call.completed", "tool.call.failed", "tool.call.progress", "tool.call.started"],
    "tool.* 族只允许本批登记的 4 类",
  );

  // 负向守护：confirm/拦截相关事件属批次 1，本批不得预登记
  for (const premature of ["tool.call.confirmed", "tool.call.rejected", "tool.confirm.required"]) {
    assert.ok(
      !(HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(premature),
      `${premature} 属批次 1（确认闸门）范围，本批不得登记`,
    );
  }
});
