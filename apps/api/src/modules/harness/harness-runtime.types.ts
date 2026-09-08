// ============================================================
// Harness 持久运行 Runtime 类型
// ============================================================
// RP-047 Batch A：定义 durable Run 的 runKind、Attempt/Checkpoint/
// Output 状态词汇、事件类型与确定性 effectKey。本文件不含
// 数据库访问逻辑，供 schema、repository 与后续批次共享契约。
// S7（2026-08-31）：Outbox 状态词汇（HARNESS_OUTBOX_STATUSES /
// HarnessOutboxStatus）已随全仓零消费者删除；事件名 outbox_enqueued
// 保留（已入库历史行兼容，见下方留档注）。

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

export const HARNESS_RUN_EVENT_TYPES = [
  "run_queued",
  "run_claimed",
  "run_status_changed",
  "checkpoint_committed",
  "output_updated",
  // outbox_enqueued：生产者已于 S2b-2 退役，永不再发；保留仅为兼容已持久化的
  // 历史行（2026-08-31 实取 harness_run_events 31 727 行中含本事件 68 行）。
  // 词汇表描述的是「这张表里可能存在什么」，删条目会让按白名单校验或映射
  // event_type 的读路径把这 68 行判为非法或静默丢弃。新增写入即为缺陷，
  // 由 harness-runtime.worker.test.ts 的负向守护拦截。
  // 本条不为 S7 而减少：additive-only（只增不减）契约未修订。
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
  // 批次 0.5（additive）：工具调用可视化事件——
  // 批次 0 让工作台真正执行只读工具，但调用过程对用户完全不可见。本批把
  // 「模型请求调用 → 执行中 → 成功 / 失败」四态写入 run 事件流，前端
  // 消费侧（useChatMessages STREAM_EVENT_TYPES）经既有 SSE 透传链路呈现。
  // 四条独立类型而非一条 + status：本表的作用是**把词汇锁进契约**，
  // 把状态塞进 payload 等于造一个不受白名单校验的联合类型——绕过白名单。
  // tool.call.progress 是本族唯一真正新增的状态：AgentEvent 只有
  // tool_call / tool_result 两种 kind（批次 0 冻结裁决：复用既有 kind 不自造），
  // 执行中心跳由事件映射层在两者之间派生，用于长耗时工具的可见性。
  // 仅异步 run 通道发射；同步通道为历史遗留回退，本批不为其登记。
  // confirm 相关类型属批次 1（写操作确认闸门），本批不预登记。
  "tool.call.started",
  "tool.call.progress",
  "tool.call.completed",
  "tool.call.failed",
  // 批次 1a（additive）：写操作工具的执行前审批闸门——
  // 批次 0/0.5 只放开只读工具，写工具一律被循环拒绝；本批把「先问用户再执行」
  // 做成可持久闸门（run.status = waiting + 既有 confirmRunAction），故词汇表需要
  // 两个新状态：等待确认、用户拒绝。
  // **「同意」不新增类型**：复用既有 run_action_confirmed（已由 confirmRunAction
  // 产生），其 payload 补 callId 与本族事件对账——再造一个 tool.call.confirmed 就是
  // 让同一个事实在两处各说一遍，正是本批要消灭的漂移形态。
  // 两条 payload 只带 actionId / callId / toolName，**不带工具参数**：参数以
  // tool.call.started 那一份为唯一来源，界面显示与实际执行因此不可能分叉。
  "tool.call.awaiting_approval",
  "tool.call.rejected",
  // 批次 9（additive）：ask_user 工具「执行本身即暂停」——
  // 与批次 1a 的区别是概念性的，不是实现取巧：1a 是**执行前**暂停（该不该让它做），
  // 本条是**执行即**暂停（它的作用就是等一个回答）。两者共用 run.status=waiting 底层，
  // 但恢复路径不同——确认走 confirmRunAction，填表走 submitRunInput。
  // 刻意不复用 tool.call.awaiting_approval：两者 payload 不同（一个只带 actionId /
  // callId / toolName，一个必须带整份表单结构），语义也不同（该不该让它做 vs 等你回答）。
  // 同一条事件要表达两种事实，读侧就必须靠猜分支——那正是本表要锁死的漂移形态。
  // payload 带 formBlock 表单结构本身（参数唯一来源仍是 tool.call.started 那一份）。
  "tool.call.awaiting_input",
  // 批次 2b-1（additive）：对话正文的持久事实。
  //
  // 为什么必须新增而不是复用既有事件（架构侧 2026-09-08 实取，非推测）：
  // 本表此前**不是**对话记录。全库事件分布实取为
  //   thought 17874 · text.delta 17731 · run_claimed 94 · run_queued 92 ·
  //   run_completed 78 · outbox_enqueued 68 · run_failed 13 · run_cancelled 9 · tool.call.* 16
  // 且 run_queued 的载荷全部是空 {}。于是：
  //  · **用户说的话根本不在事件流里**——它只存在于 harness_runs.title。title 与用户
  //    正文今天逐条相同（23 对全量比对、无截断），但 title 语义上是「标题」：哪天
  //    有人给长消息加摘要，按事件流重建历史就会**悄悄**坏掉。
  //  · **助手说的话只有 text.delta 碎片**，而批次 0.5 已把 text.delta 定性为展示/
  //    传输通道。让持久事实依赖「一片都没丢」，等于把历史对不对押在传输完整性上。
  // 两者都是「碰巧能用」，没有一行是「当时说了什么」的正式记录。本批把这份记录建出来。
  //
  // 分工（后一条是本批最容易被误解的地方，务必连注释一起读）：
  //   text.delta      = **传输通道**。逐 chunk、可为 0 条也可为上千条、按到达顺序落库，
  //                     作用是让正在看的人实时看到字在长。恢复重放会重复落，这对展示无害。
  //   assistant/message = **持久事实**。一轮一条、正文完整，作用是「当时答复的是什么」。
  //   两者并存不冲突也不冗余：删掉全部 text.delta，历史依然完整；只留 text.delta，
  //   历史就要赌「一片都没丢」。写在这里而不在读侧做合并，是为了让事实不依赖派生。
  //
  // 写入时机（见各自调用点）：user/message 在 Run 入队事务内、与 run_queued 同轨提交
  // （正文取提交时的原始入参，**不从 title 取**）；assistant/message 在本轮答复定稿时
  // 写一次（置于幂等 effect 内，恢复重放天然不重复）。
  //
  // 命名沿用斜杠风格：与 workbench-tool-event-surface 中 dsh SurfaceEventType 的
  // user/message、assistant/message、tool/result 同形（雷达文档 §8/§9.3 引用该形状）。
  // 刻意不改成 message.user——同一族词汇两种命名法，读侧只能靠记历史。
  "user/message",
  "assistant/message",
] as const;
export type HarnessRunEventType = (typeof HARNESS_RUN_EVENT_TYPES)[number];

/**
 * 批次 1b（additive）：一个 Run 的「工具痕迹」事件子集 —— 界面重建工具 chip 所需的
 * 全部持久事实（GET /ai-runs/:runId/tool-events 的过滤口径）。
 *
 * 含同意侧的 run_action_confirmed：用户点完同意到 worker 续跑之间有一段窗口，
 * 只读 tool.* 会把这一段读成「还在等你确认」，于是同一件事被问第二遍。
 * 含批次 9 的 tool.call.awaiting_input：交互表单同样是「界面在等这个人」的状态，
 * 不并进来则刷新页面后控件消失，用户对着一个还在 waiting 的 Run 无从下手。
 * 不含 tool.call.progress：心跳只更新耗时，终态帧自带的 elapsedMs 已够重建用，
 * 把它读回来只会放大响应（长任务的心跳可达数十条）。
 *
 * 由 HARNESS_RUN_EVENT_TYPES 逐字取子集（satisfies 当场校验），不重列字符串：
 * 有人改白名单时这里立即编译失败，不会出现「接口在筛一个不存在的词」。
 */
export const HARNESS_RUN_TOOL_TRAIL_EVENT_TYPES = [
  "tool.call.started",
  "tool.call.completed",
  "tool.call.failed",
  "tool.call.awaiting_approval",
  "tool.call.rejected",
  "tool.call.awaiting_input",
  "run_action_confirmed",
] as const satisfies readonly HarnessRunEventType[];
export type HarnessRunToolTrailEventType = (typeof HARNESS_RUN_TOOL_TRAIL_EVENT_TYPES)[number];

/**
 * 批次 2b-1（additive）：一个 Run 内**最多一条**的事件类型 —— 对话正文。
 * 由仓储在 appendRunEvent 里强制执行（重复写幂等吸收、首写获胜）。
 *
 * 为什么需要这条约束，而不是只靠「写在幂等位上」这个约定：
 * 崩溃窗口是真实存在的——execute 跑完、事件已落库，但 effect 行尚未提交时进程死掉，
 * 恢复重放会**重新执行整个 execute**，于是再写一条 assistant/message。会话侧不会
 * 重复（它有 ${runId}:assistant:1 来源键），事件侧没有来源键。两条同名正文等于
 * 让重建出来的历史凭空多出一轮，而这正是本批要消灭的形态。
 *
 * 清单只含对话正文，**刻意不含 text.delta**：一次答复合法地对应多条 delta，
 * 把它纳入就是让仓储吞掉传输分片——那是把传输通道当事实处理的反向错误。
 *
 * 同 HARNESS_RUN_TOOL_TRAIL_EVENT_TYPES：由白名单 satisfies 取子集，不重列字符串，
 * 有人改词汇表时这里当场编译失败。
 */
export const HARNESS_RUN_SINGLETON_EVENT_TYPES = [
  "user/message",
  "assistant/message",
] as const satisfies readonly HarnessRunEventType[];
export type HarnessRunSingletonEventType = (typeof HARNESS_RUN_SINGLETON_EVENT_TYPES)[number];

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

/** checkpoint runtimeValidation 的 validatorVersion 固定值。 */
export const HARNESS_WORKER_VALIDATOR_VERSION = "harness-worker/v1";

/** 自动恢复次数超限后的 Run 失败码（roadmap Task 2 原文）。 */
export const HARNESS_RECOVERY_LIMIT_ERROR_CODE = "RECOVERY_LIMIT_EXCEEDED";

/** 没有任何兼容检查点时的 Run 失败码（设计稿 §8.3）。 */
export const HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE = "RECOVERY_CHECKPOINT_INCOMPATIBLE";
