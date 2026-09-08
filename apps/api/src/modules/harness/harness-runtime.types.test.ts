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
  HARNESS_RUN_SINGLETON_EVENT_TYPES,
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
    25,
    "Batch B 词汇 12 类 + Batch C/ISS-004/批次0.5/批次1a/批次9/批次2b-1 additive 追加 2+2+4+2+1+2 类 = 25",
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
    25,
    "Batch C + ISS-004/批次0.5/批次1a/批次9/批次2b-1 additive 追加 2+4+2+1+2 类事件 = 25",
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
    25,
    "ISS-004 之后的词汇 + 批次0.5/批次1a/批次9/批次2b-1 additive 追加 4+2+1+2 类（16 → 23 → 25）",
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
  assert.equal(HARNESS_RUN_EVENT_TYPES.length, 25, "批次0.5 追加 4 类 + 批次1a 追加 2 类 + 批次9 追加 1 类 + 批次2b-1 追加 2 类（16 → 25）");

  // 点号命名族必须恰好是这 7 条：不得夹带其他 tool.* 变体（防词汇漂移）。
  // 批次 0.5 登记 4 条，批次 1a（写操作审批闸门）additive 追加 2 条，
  // 批次 9（ask_user 交互表单）additive 追加 1 条。
  const toolFamily = HARNESS_RUN_EVENT_TYPES.filter((type) => type.startsWith("tool."));
  assert.deepEqual(
    [...toolFamily].sort(),
    [
      "tool.call.awaiting_approval",
      "tool.call.awaiting_input",
      "tool.call.completed",
      "tool.call.failed",
      "tool.call.progress",
      "tool.call.rejected",
      "tool.call.started",
    ],
    "tool.* 族只允许批次 0.5（4 类）+ 批次 1a（2 类）+ 批次 9（1 类）登记的 7 类",
  );

  // 负向守护：批次 1a 的「同意」刻意**不新增**事件类型——复用既有 run_action_confirmed。
  // 造一个 tool.call.confirmed 等于让同一事实在两处各说一遍，正是本批要消灭的漂移形态。
  // （原「tool.call.rejected 属批次 1 不得预登记」的守护随本批正式登记而失效，已移除。）
  for (const premature of ["tool.call.confirmed", "tool.confirm.required", "tool.call.approved"]) {
    assert.ok(
      !(HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(premature),
      `${premature} 不得登记：同意复用 run_action_confirmed，不另起词汇`,
    );
  }
});

// ============================================================
// 批次 1a（additive）：写操作工具的执行前审批闸门词汇
// ============================================================
// 闸门必须落在 run 事件流上才扛得住 worker 重启（判据④）：「等待确认」与「用户拒绝」
// 得是持久事件，而不是内存里的 Promise。同意复用既有 run_action_confirmed。

test("批次1a adds tool approval gate event types additively", () => {
  const preApprovalFrozen20 = [
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
    "tool.call.started",
    "tool.call.progress",
    "tool.call.completed",
    "tool.call.failed",
  ];
  assert.deepEqual(
    [...HARNESS_RUN_EVENT_TYPES].slice(0, 20),
    preApprovalFrozen20,
    "前 20 类必须逐位不变——批次 1a 起不得重排、删除或改名既有词汇",
  );
  assert.deepEqual(
    [...HARNESS_RUN_EVENT_TYPES].slice(20, 22),
    ["tool.call.awaiting_approval", "tool.call.rejected"],
    "本批新增的两类审批事件名与顺序必须精确一致（后续批次只能继续往后加，不得插入本批槽位）",
  );
});

// ============================================================
// 批次 9（additive）：ask_user 交互表单的「执行即暂停」词汇
// ============================================================
// 必须独立成类而非复用 tool.call.awaiting_approval：两者 payload 不同
// （审批只带 actionId / callId / toolName，本类必须带整份表单结构），
// 语义也不同（该不该让它做 vs 等你回答）。同一条事件表达两种事实，
// 读侧就只能靠猜分支——那正是本表要锁死的漂移形态。

test("批次9 adds the ask_user awaiting-input event type additively", () => {
  assert.deepEqual(
    [...HARNESS_RUN_EVENT_TYPES].slice(0, 23),
    [
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
      "tool.call.started",
      "tool.call.progress",
      "tool.call.completed",
      "tool.call.failed",
      "tool.call.awaiting_approval",
      "tool.call.rejected",
      "tool.call.awaiting_input",
    ],
    "批次 9 收口时的 23 类必须逐位不变：批次 2b-1 起只能继续往后加",
  );
  // 两条 awaiting 事件必须同时在册：合并成一条即为本批要防的语义漂移
  assert.ok(
    (HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("tool.call.awaiting_approval"),
    "审批等待不得被表单等待顶掉——两者是不同的等待",
  );
});

// ============================================================
// 批次 2b-1（additive）：对话正文的持久事实事件词汇
// ============================================================
// 事件流此前**不是**对话记录：实取全库分布 thought 17874 · text.delta 17731 ·
// run_queued 92 …，run_queued 载荷恒为 {}，用户说的话只存在于 harness_runs.title，
// 助手说的话只有 text.delta 碎片。两者都是「碰巧能用」，没有一行是「当时说了什么」
// 的正式记录。本批把这份记录建出来，命名沿用斜杠风格（与 workbench-tool-event-surface
// 里 dsh SurfaceEventType 的同形词一致，雷达文档 §8/§9.3 已引用该形状）。
//
// 刻意不叫 message.user：本表的词是「surface/正文」这一族，与 tool/result 同形，
// 改成点号会把同一族拆成两种命名法，读侧只能靠记住历史来对齐。

test("批次2b-1 adds the conversation-body event types additively", () => {
  // 批次 9 之前冻结的 22 类 + 批次 9 的 1 类，槽位不得被本批顶掉
  assert.deepEqual(
    [...HARNESS_RUN_EVENT_TYPES].slice(22, 23),
    ["tool.call.awaiting_input"],
    "批次 9 的槽位必须仍在原位——本批只能往后加",
  );
  assert.deepEqual(
    [...HARNESS_RUN_EVENT_TYPES].slice(23),
    ["user/message", "assistant/message"],
    "本批新增的两类必须按「用户先、助手后」落在末位，名称精确一致",
  );
  assert.equal(
    HARNESS_RUN_EVENT_TYPES.length,
    23 + 2,
    "批次 2b-1 只允许在批次 9 的 23 类之上 additive 追加 2 类",
  );

  // 斜杠命名的「对话正文」族恰好这两条：不得夹带第三种
  const messageFamily = HARNESS_RUN_EVENT_TYPES.filter((type) => type.endsWith("/message"));
  assert.deepEqual(
    [...messageFamily].sort(),
    ["assistant/message", "user/message"],
    "/message 族只允许本批登记的 2 类",
  );

  // tool/result 是**模型可见面**的词汇（workbench-tool-event-surface 的准入白名单，
  // 描述「哪些内容能进模型上下文」），不是持久化的 Run 事件：工具执行的事实已经由
  // tool.call.* 六类承载。把它登记进本表等于让同一个事实有两个持久来源。
  assert.ok(
    !(HARNESS_RUN_EVENT_TYPES as readonly string[]).includes("tool/result"),
    "tool/result 不得登记为 Run 事件类型：它是模型可见面词汇，工具事实已由 tool.call.* 承载",
  );

  // 「一个 Run 内最多一条」的清单必须与 /message 族逐字相同。
  // text.delta 绝不能在列：一次答复合法地对应上千条 delta，把它纳入就等于
  // 让仓储吞掉后续分片——那是把传输通道当事实处理的反向错误。
  assert.deepEqual(
    [...HARNESS_RUN_SINGLETON_EVENT_TYPES].sort(),
    [...messageFamily].sort(),
    "幂等追加清单必须恰好是对话正文族，两者不得各自演化",
  );
  assert.ok(
    !(HARNESS_RUN_SINGLETON_EVENT_TYPES as readonly string[]).includes("text.delta"),
    "text.delta 是传输碎片，合法地可重复，不得纳入单次清单",
  );
});
