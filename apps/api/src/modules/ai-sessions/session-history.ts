// ============================================================
// 会话历史派生缝（deriveSessionMessages）· 批次 2a 造缝，批次 2b-3 换源
// ============================================================
// 「取会话历史」的唯一口子：所有需要一条会话历史消息序列的地方，都必须经本函数，
// 不得再直读 `session.messages`。
//
// 批次 2a 造这道缝时数据源仍是 ai_sessions.messages（jsonb 快照），纯重构零行为变化。
// 批次 2b-3 把数据源换成 append-only 事件流里的对话事实（harness_run_events 的
// user/message / assistant/message，载荷自 2b-2 起是**完整消息信封**），
// 而**缝本身仍是同步的**：I/O 留在仓储读取口（ai-sessions-pg.repository），由它先批量
// 把事实取回来、判定完再写进记录的 messages 字段，才交给消费端。
// 改成 async 会把签名外溢到 sessionRecordToHomeMessages / summarizeSessionForAdminAudit
// 这些**整形**边界，那是 2a 明令「取与整形分离」要防的事。
//
// 三条换源口径（架构侧 2026-09-06 / 2026-09-11 裁决）：
//  ① **归并**：retryOfRunId 非空的 Run 不算新一轮。重试是新建 Run 并记 retry_of_run_id，
//     故「系统重试」与「用户又问一遍」在数据里分得开。被并掉的那条 user 轮**仍计入覆盖**
//     ——否则本条永远生效不了（回落会把快照里重复的那份读回来，等于归并没做）。
//  ② **回落是整会话级的，判据是覆盖而非存在**：快照里每一条消息都能被事件流里的对应
//     事实解释，才走事件路径。「有没有事件」这种存在性判据会被**混合通道**击穿：
//     异步轮有事件、同步降级轮（workbench-chat{,-stream}.handler 直写 jsonb、无 runId、
//     结构性不产事件）没有——「有 ≥1 条事件」为真却会静默少一整轮，且少在前端响应里
//     （用户看得见自己说过的话消失）。回落不是永久的：存量残量可数（实取 17 条），
//     数到 0 即可在 2c 连同快照一并退役。半事件半快照拼出来的历史最难查，故绝不逐条回落。
//  ③ **delta 是传输面，永不进历史**：一轮没有 assistant/message 就是没有答复，不得拿
//     text.delta 拼一条出来（那是把「一片都没丢」的赌注重新引回来，与本线立意相悖）。
//
// 批量口径（架构侧 2026-09-11 硬要求）：本缝的消费端里有**全表逐条 map** 的管理员审计
// （listAllAiSessionsForAdmin）。事件必须按会话 id 集合一次取回，不得每会话查一次；
// 也不得让某个消费方「继续读快照」来绕开——那等于给逐字节口径开一个按消费方划分的例外。
// 实测查询次数：conversation-event-history.test.ts 断言 + 对照脚本打印。
//
// 口径边界（2a 三条，仍然成立）：
//  · 本模块只承担「取」，不承担「整形」。窗口 slice(-12)、角色过滤、附件解析等整形口径
//    留在各消费端（模型请求整形在 services/ai/handlers/workbench-shared）。
//    特别是 workbench-request-invariant 的整形第二实现**刻意不入缝**：那条不变量比的是
//    两个独立推导，两边同源即永真，会把 DEF-2026-08-27-001 的防线退化成空跑。
//    换源之后它成了唯一的独立对照，价值更高。
//  · 附件解析上下文仍读 `session.attachments`（同为 jsonb 快照），不在本缝内。
//  · 写入侧不变：双写期 ai_sessions.messages 继续写（appendMessageIdempotent 的幂等
//    查重正建立在它之上），2c 才谈退役。
//
// 逐字节证据三份，互补：
//  · session-history.test.ts —— 2a 冻结基准（形状维度：空历史、system/tool、悬挂引用、窗口）
//  · session-history-events.test.ts —— 2b-3 判定（归并 / 覆盖 / 排序 / delta / 逐字节透传）
//  · scripts/session-history-derive-parity.ts —— 存量六层逐字节 + 残量计数 + 批量查询次数
// ============================================================

import type { AiMessage, AiSessionRecord } from "./ai-sessions.types";

/**
 * 给定已加载的会话记录，返回其历史消息序列（存储原序，不过滤、不改形、不截断）。
 *
 * 批次 2b-3 起，`session.messages` 携带的是**仓储读取口解析后的**历史
 * （见 applyEventStreamHistory）：能被事件流完整覆盖的会话给的是重建结果，
 * 覆盖不住的整会话回落快照。本函数因此不必知道源在哪——这正是 2a 造缝要买的东西。
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

// ============================================================
// 批次 2b-3 · 对话事实（事件流）→ 历史序列
// ============================================================

/**
 * 事件流里算「对话事实」的两类事件。刻意在本模块重列而不 import harness 域的
 * HARNESS_RUN_SINGLETON_EVENT_TYPES：那一份是**写入侧**幂等清单（「一个 Run 最多一条、
 * 首写获胜」），本份是**读取侧**词汇表。二者今天同集合纯属巧合——写入侧将来加一类
 * 「不落进历史」的事实（例如系统提示），读取侧不能跟着被拖着变。
 * 巧合由 conversation-event-history.test.ts 的跨域断言钉住，不靠人记。
 */
export const SESSION_CONVERSATION_FACT_EVENT_TYPES = ["user/message", "assistant/message"] as const;
export type SessionConversationFactEventType = (typeof SESSION_CONVERSATION_FACT_EVENT_TYPES)[number];

/** 一条对话事实：载荷即 2b-2 起的完整消息信封，run 侧字段用于排序与归并判定。 */
export type SessionConversationFactEvent = {
  runId: string;
  /** 非空即「本 Run 是某轮的重试」——它的用户轮不另算一轮（口径①） */
  retryOfRunId: string | null;
  /** Run 创建时刻（ISO）：跨 Run 的排序键 */
  runCreatedAt: string;
  /** Run 内序号：与事件表 sequence 同义，是 Run 内的排序键 */
  sequence: number;
  eventType: SessionConversationFactEventType;
  payload: AiMessage;
};

/**
 * 对话事实读取口。**按会话 id 集合批量取**是本接口的存在理由：单个 sessionId 的
 * `load(sessionId)` 形态会让全表管理员审计退化成 N+1。
 * 实现在 harness 域（conversation-event-history.ts）——harness_* 表形状归它管。
 */
export type SessionConversationFactSource = {
  loadConversationFacts(
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SessionConversationFactEvent[]>>;
};

/** 快照里某条消息覆盖不住的原因（只用于日志与残量归因，不含正文）。 */
export type SessionHistoryUncoveredReason =
  /** 快照这条没有 projectionSource 来源键：同步通道 / 报告旁路落的，事件流结构性无它 */
  | "no-projection-source"
  /** 有来源键，但事件流里找不到对应事实：那条事实写丢了（>1MiB 静默丢即此形态） */
  | "no-matching-event";

export type SessionHistoryResolution = {
  sessionId: string;
  /** events = 走事件流重建；snapshot = 整会话回落 jsonb 快照 */
  source: "events" | "snapshot";
  reason:
    | "covered"
    | "no-conversation-facts"
    | "snapshot-not-covered";
  eventMessageCount: number;
  snapshotMessageCount: number;
  /** 归并掉的 retry 用户轮条数（口径①生效的证据；回落计数时须排除它） */
  mergedRetryUserTurns: number;
  uncovered: Array<{ messageId: string; why: SessionHistoryUncoveredReason }>;
};

const UNCOVERED_LIST_CAP = 20;

/** 快照消息的来源键（appendMessageIdempotent 补的那一份）。无键即非 Run 投影。 */
function snapshotProjectionKey(message: AiMessage): string | null {
  const raw = (message.metadata as { projectionSource?: { deduplicationKey?: unknown } } | undefined)
    ?.projectionSource;
  const key = typeof raw?.deduplicationKey === "string" ? raw.deduplicationKey : "";
  return key || null;
}

/**
 * 事件侧来源键。优先取载荷自带的 projectionSource（2b-2 裁决：一份将成为事实源的记录
 * 必须自带全部字段），缺则按 `${runId}:user|assistant:1` 构造——2b-1 那批载荷只有
 * `{content}`，没有键可取，而构造式与会话侧落库时用的是同一个函数。
 */
function factProjectionKey(event: SessionConversationFactEvent): string {
  const carried = snapshotProjectionKey(event.payload);
  if (carried) return carried;
  return `${event.runId}:${event.eventType === "user/message" ? "user" : "assistant"}:1`;
}

/**
 * 会话历史解析结果（纯函数，不连库）。
 *
 * 排序：跨 Run 按 `runCreatedAt`、同 Run 按事件 `sequence`。同一会话上同时只允许
 * 一个在途 workbench_chat Run（harness_runs 的 activeWorkbenchSessionUnique 部分索引），
 * 故 Run 之间不会交错，这个键序与快照的「按写入时刻追加」同序。
 * runCreatedAt 同刻时按 runId 定序，使同一批事件换个传入顺序也给同一个历史。
 */
export function resolveSessionHistory(
  session: AiSessionRecord | null | undefined,
  events: readonly SessionConversationFactEvent[] | undefined,
): { messages: AiMessage[]; resolution: SessionHistoryResolution } {
  const snapshot = deriveSessionMessages(session);
  const facts = events ?? [];
  const sessionId = session?.sessionId ?? "";

  const byRun = new Map<
    string,
    { retryOfRunId: string | null; runCreatedAt: string; events: SessionConversationFactEvent[] }
  >();
  for (const event of facts) {
    let run = byRun.get(event.runId);
    if (!run) {
      run = { retryOfRunId: event.retryOfRunId, runCreatedAt: event.runCreatedAt, events: [] };
      byRun.set(event.runId, run);
    }
    run.events.push(event);
  }

  const orderedRuns = [...byRun.entries()].sort((a, b) => {
    const [runIdA, runA] = a;
    const [runIdB, runB] = b;
    if (runA.runCreatedAt !== runB.runCreatedAt) return runA.runCreatedAt < runB.runCreatedAt ? -1 : 1;
    return runIdA < runIdB ? -1 : runIdA > runIdB ? 1 : 0;
  });

  const messages: AiMessage[] = [];
  /** 事件流能解释的来源键全集——含被口径①归并掉的用户轮，否则归并永远会被判成「覆盖不住」 */
  const factKeys = new Set<string>();
  let mergedRetryUserTurns = 0;

  for (const [, run] of orderedRuns) {
    const runEvents = [...run.events].sort((a, b) => {
      if (a.sequence !== b.sequence) return a.sequence - b.sequence;
      return a.eventType < b.eventType ? -1 : a.eventType > b.eventType ? 1 : 0;
    });
    for (const event of runEvents) {
      factKeys.add(factProjectionKey(event));
      // 口径①：重试的 Run 不再产一次用户提问，但它的答复算这一轮的最终答复。
      // 载荷原样透传，这里不重新组装消息——重新组装就是第二次整形。
      if (event.eventType === "user/message" && run.retryOfRunId) {
        mergedRetryUserTurns += 1;
        continue;
      }
      messages.push(event.payload);
    }
  }

  const uncovered: SessionHistoryResolution["uncovered"] = [];
  for (const message of snapshot) {
    const key = snapshotProjectionKey(message);
    if (key && factKeys.has(key)) continue;
    uncovered.push({ messageId: message.messageId, why: key ? "no-matching-event" : "no-projection-source" });
  }

  let source: SessionHistoryResolution["source"];
  let reason: SessionHistoryResolution["reason"];
  if (facts.length === 0 && snapshot.length > 0) {
    // 2b-1 之前的全部存量（实取 17 条）：事件流里一条对话事实都没有
    source = "snapshot";
    reason = "no-conversation-facts";
  } else if (uncovered.length > 0) {
    // 混合通道 / 事实写丢：整会话回落，绝不逐条拼接
    source = "snapshot";
    reason = "snapshot-not-covered";
  } else {
    source = "events";
    reason = "covered";
  }

  return {
    messages: source === "events" ? messages : [...snapshot],
    resolution: {
      sessionId,
      source,
      reason,
      eventMessageCount: messages.length,
      snapshotMessageCount: snapshot.length,
      mergedRetryUserTurns,
      uncovered: uncovered.slice(0, UNCOVERED_LIST_CAP),
    },
  };
}

/**
 * 一批会话记录 → 解析后的记录（仓储读取口用的那一步）。
 *
 * **一次** `loadConversationFacts(全部会话 id)` 取回全部事实：逐会话取会让全表管理员
 * 审计变成 N+1（架构侧 2026-09-11 硬要求）。
 * 回落条数每次打印成可 grep 的一行——「残量数到 0 即可在 2c 删掉回落」这条纪律
 * 靠的就是这个计数，所以它必须留在运行时日志里，而不是只留在对照脚本里。
 * 日志只带 id 与条数，不带正文：工作台历史是客户的需求原文。
 */
export async function resolveSessionHistories<T extends AiSessionRecord>(
  sessions: readonly T[],
  source: SessionConversationFactSource | null | undefined,
): Promise<{ records: T[]; resolutions: SessionHistoryResolution[] }> {
  if (sessions.length === 0) return { records: [], resolutions: [] };
  const factsBySession = source
    ? await source.loadConversationFacts(sessions.map((session) => session.sessionId))
    : new Map<string, readonly SessionConversationFactEvent[]>();

  const resolutions: SessionHistoryResolution[] = [];
  const records = sessions.map((session) => {
    const { messages, resolution } = resolveSessionHistory(session, factsBySession.get(session.sessionId));
    resolutions.push(resolution);
    // 浅拷贝 + 替换 messages：不改调用方手里那份记录的数组引用
    return { ...session, messages } as T;
  });

  const fallbacks = resolutions.filter((resolution) => resolution.source === "snapshot");
  if (fallbacks.length > 0) {
    const noFacts = fallbacks.filter((resolution) => resolution.reason === "no-conversation-facts").length;
    const notCovered = fallbacks.filter((resolution) => resolution.reason === "snapshot-not-covered").length;
    console.warn(
      `[session-history] 换源批: 会话=${sessions.length} 事件路径=${sessions.length - fallbacks.length} ` +
        `回落快照=${fallbacks.length} (无对话事件=${noFacts} 覆盖不住=${notCovered}) ` +
        `归并retry轮=${resolutions.reduce((sum, resolution) => sum + resolution.mergedRetryUserTurns, 0)}`,
    );
    // 覆盖不住才是「事件流与快照不一致」的告警面，逐条列出到 id 级；
    // 纯存量（无对话事件）只是残量，不逐条刷屏。
    for (const resolution of fallbacks.filter((item) => item.reason === "snapshot-not-covered")) {
      console.warn(
        `[session-history] ⚠ 覆盖不住 session=${resolution.sessionId} ` +
          `快照=${resolution.snapshotMessageCount} 事件重建=${resolution.eventMessageCount} ` +
          `未覆盖=${resolution.uncovered.map((item) => item.why).join(",")}` +
          (resolution.uncovered.length > UNCOVERED_LIST_CAP ? "…(截断)" : ""),
      );
    }
  }
  return { records, resolutions };
}

/** 仓储读取口用的那一步：只要解析后的记录（判定明细由上面的 resolveSessionHistories 给对照脚本）。 */
export async function applyEventStreamHistory<T extends AiSessionRecord>(
  sessions: readonly T[],
  source: SessionConversationFactSource | null | undefined,
): Promise<T[]> {
  const { records } = await resolveSessionHistories(sessions, source);
  return records;
}
