// ============================================================
// 批次 2a · 会话历史派生缝（deriveSessionMessages）
// ============================================================
// 「取会话历史」的唯一口子：所有需要一条会话历史消息序列的地方，都必须经本函数，
// 不得再直读 `session.messages`。存储侧仍是 ai_sessions.messages（jsonb 快照）——
// 本批是纯重构，行为逐字节不变，逐字节证据见：
//   · apps/api/src/modules/ai-sessions/session-history.test.ts（合成样本，形状维度）
//   · scripts/session-history-derive-parity.ts（开发库存量会话，实数据维度）
//
// 为什么要有这道缝：批次 2b 要把历史存储形态从 jsonb 快照换成 append-only 事件序列。
// 若不先收口，2b 得同时改十几个读取点，动的却是全部对话的存储形态——出错面与
// 「单次限定一个业务表面」都不成立。收口之后 2b 只换本文件里这一个函数体。
//
// 口径边界（2b 动手前必读）：
//  ① 本函数只承担「取」，不承担「整形」。窗口 slice(-12)、角色映射、附件解析等
//     整形口径留在各消费端（模型请求整形在 services/ai/handlers/workbench-shared）。
//     特别是 workbench-request-invariant 的整形第二实现**刻意不入缝**：那条不变量比的
//     是两个独立推导，两边同源即永真，会把 DEF-2026-08-27-001 的防线退化成空跑。
//  ② 附件解析上下文仍读 `session.attachments`（同为 jsonb 快照），不在本缝内。
//     2b 若把附件也迁进事件流，需另立读取口——不要顺手塞进本函数。
//  ③ 签名是同步的，因为现存 6 个读取点全都已持有整条 AiSessionRecord。
//     2b 若改为按 sessionId 查事件表，把本函数改 async 并向外机械传播即可（6 处），
//     届时仍不需要动任何整形口径。
// ============================================================

import type { AiMessage, AiSessionRecord } from "./ai-sessions.types";

/**
 * 给定已加载的会话记录，返回其历史消息序列（存储原序，不过滤、不改形、不截断）。
 *
 * 返回**新数组**而非存储侧引用：消费端（filter/map/reverse/length）只读，
 * 但把内部数组外泄会让任何一个手滑 push 的地方变成写存储语义的假象。
 *
 * messages 缺失或非数组时归一为空历史。改造前各消费端本就各自处理这种形状，
 * 逐字节对照（session-history.test.ts）实取到两处分歧，统一登记为 **F-2a-1**，
 * 且**只在非数组行上成立**：
 *   · 模型历史整形侧——旧实现带 `!Array.isArray → []` 守卫，与缝一致，无差异；
 *   · 视图计数侧——旧表达式 `session.messages?.length ?? 0` 在 messages 是
 *     JSON **字符串**时取到字符长度（把字符数当消息数），改道后为 0；
 *   · 管理员审计侧——旧表达式 `session.messages.find(...)` 在这种行上抛
 *     TypeError，改道后不抛。
 * 该形状无可达写入路径：ai_sessions.messages 为 NOT NULL DEFAULT '[]'::jsonb
 * （db/schema/json_runtime.ts:213），仓储 row→record 又 `?? []`
 * （ai-sessions-pg.repository.ts:80）。对照脚本每次实取全库 jsonb_typeof
 * 非 array 的行数并打印，不把「不可达」当成默认成立的假设。
 */
export function deriveSessionMessages(
  session: AiSessionRecord | null | undefined,
): readonly AiMessage[] {
  if (!session || !Array.isArray(session.messages)) return [];
  return [...session.messages];
}
