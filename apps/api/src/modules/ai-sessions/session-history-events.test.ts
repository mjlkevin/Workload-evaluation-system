// ============================================================
// 批次 2b-3 · 换源判定（事件流 → 会话历史）纯逻辑基准
// ============================================================
// 本批把「取会话历史」的**数据源**从 ai_sessions.messages（jsonb 快照）换成
// harness_run_events 里的 user/message / assistant/message 事实序列。
//
// 本文件锁的是**判定**，不连库：覆盖/回落/归并/排序这些会决定「历史会不会静默少几条」
// 的分支，必须有无条件执行的合成用例（CI 空库同样成立）。真实数据侧的两份互补证据：
//  · scripts/session-history-derive-parity.ts —— 存量六层逐字节 + 残量计数
//  · workbench-history-source.e2e.test.ts —— 新建真实两轮对话走事件路径
//
// 三条口径（架构侧 2026-09-11 派单 + 执行方实取补充）：
//  ① retryOfRunId 非空的 Run 不算新一轮：它的 user/message 被归并掉，assistant 保留。
//     归并造成的「快照有两条 user、事件重建只有一条」差异**显式判为已覆盖**——
//     否则口径①永远生效不了（回落会把重复那份读回来，等于归并没做）。
//  ② 回落是**整会话级**的，且判据是**覆盖**而非「有没有事件」：快照里每一条消息
//     都能被事件流里的对应事实解释，才走事件路径。存在性判据会被混合通道击穿——
//     异步轮有事件、同步降级轮无 runId 也不产事件，「有 ≥1 条事件」为真却少一整轮。
//  ③ delta 是传输面，永不进历史：一轮没有 assistant/message 就是没有答复，
//     不得拿 delta 拼一条出来（那是把「一片都没丢」的赌注重新引回来）。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveSessionHistory,
  type SessionConversationFactEvent,
} from "./session-history";
import type { AiMessage, AiSessionRecord } from "./ai-sessions.types";

// ============================================================
// 夹具
// ============================================================

/** 事件载荷 = 2b-2 起的完整信封。逐字节口径要求本文件不「顺手补」任何字段。 */
function envelope(params: {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  dedupKey: string;
  runId: string;
  eventType: "user_message" | "assistant_message";
  attachmentIds?: string[];
}): AiMessage {
  return {
    messageId: params.messageId,
    role: params.role,
    content: params.content,
    createdAt: params.createdAt,
    ...(params.attachmentIds ? { attachmentIds: params.attachmentIds } : {}),
    metadata: {
      projectionSource: {
        deduplicationKey: params.dedupKey,
        runId: params.runId,
        eventType: params.eventType,
      },
    },
  };
}

type FactRun = {
  runId: string;
  retryOfRunId?: string | null;
  runCreatedAt: string;
  /** 本轮在事件流里真实存在的对话事实；不写即为「该轮这一侧没有事实」 */
  user?: AiMessage;
  assistant?: AiMessage;
  /** 传输面碎片：本批一律不得进历史，放进来就是为了证明它进不去 */
  deltas?: string[];
};

function facts(run: FactRun): SessionConversationFactEvent[] {
  const out: SessionConversationFactEvent[] = [];
  let sequence = 2; // run_queued 占 1，与真实入队事务同形
  if (run.user) {
    out.push({
      runId: run.runId,
      retryOfRunId: run.retryOfRunId ?? null,
      runCreatedAt: run.runCreatedAt,
      sequence: sequence++,
      eventType: "user/message",
      payload: run.user,
    });
  }
  for (const _delta of run.deltas ?? []) {
    // text.delta 不是对话事实类型，源在 SQL 层就已排除；这里不落进 events 数组
    void _delta;
  }
  if (run.assistant) {
    out.push({
      runId: run.runId,
      retryOfRunId: run.retryOfRunId ?? null,
      runCreatedAt: run.runCreatedAt,
      sequence: 50,
      eventType: "assistant/message",
      payload: run.assistant,
    });
  }
  return out;
}

function snapshotMessage(
  content: string,
  opts: { role?: "user" | "assistant" | "system" | "tool"; dedupKey?: string; runId?: string; messageId?: string; createdAt?: string } = {},
): AiMessage {
  const role = opts.role ?? "user";
  return {
    messageId: opts.messageId ?? `msg-${content}`,
    role,
    content,
    createdAt: opts.createdAt ?? "2026-09-01T00:00:00.000Z",
    attachmentIds: [],
    artifactIds: [],
    ...(opts.dedupKey
      ? {
          metadata: {
            projectionSource: {
              deduplicationKey: opts.dedupKey,
              runId: opts.runId ?? "run-1",
              eventType: role === "user" ? "user_message" : "assistant_message",
            },
          },
        }
      : {}),
  };
}

function session(messages: AiMessage[]): AiSessionRecord {
  return {
    sessionId: "sess-2b3",
    ownerUserId: "user-1",
    ownerUsername: "tester",
    title: "换源对照会话",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    summary: "",
    messages,
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function userMsg(runId: string, content: string, extra: Partial<AiMessage> = {}): AiMessage {
  return envelope({
    messageId: `msg-${runId}-u`,
    role: "user",
    content,
    createdAt: "2026-09-01T00:00:00.000Z",
    dedupKey: `${runId}:user:1`,
    runId,
    eventType: "user_message",
    ...extra,
  } as Parameters<typeof envelope>[0]);
}

function assistantMsg(runId: string, content: string): AiMessage {
  return envelope({
    messageId: `msg-${runId}-a`,
    role: "assistant",
    content,
    createdAt: "2026-09-01T00:01:00.000Z",
    dedupKey: `${runId}:assistant:1`,
    runId,
    eventType: "assistant_message",
  });
}

// ============================================================
// ① 归并规则：retryOfRunId 非空的 Run 不产生额外用户轮次
// ============================================================

test("批次2b-3·归并：retry 的 Run 不算新一轮，其 user/message 被并掉而 assistant 保留", () => {
  const runA = { runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z" };
  const retry = { runId: "run-A2", retryOfRunId: "run-A", runCreatedAt: "2026-09-01T01:00:00.000Z" };
  const aUser = userMsg(runA.runId, "评估一下 ERP 工作量");
  const retryUser = userMsg(retry.runId, "评估一下 ERP 工作量"); // 同一轮正文，retry 重发
  const retryAssistant = assistantMsg(retry.runId, "建议按 3 个模块估算。");

  // 今天的快照实况：两次尝试各落一条 user（派单实取：全库 retry 0 条，故只能合成）
  const snapshot = session([aUser, retryUser, retryAssistant]);
  const events = [...facts({ ...runA, user: aUser }), ...facts({ ...retry, user: retryUser, assistant: retryAssistant })];

  const { messages, resolution } = resolveSessionHistory(snapshot, events);

  assert.equal(resolution.source, "events", "被归并的重复 user 轮须显式判为已覆盖，否则口径①永远生效不了");
  assert.deepEqual(
    messages.map((m) => `${m.role}:${m.content}`),
    ["user:评估一下 ERP 工作量", "assistant:建议按 3 个模块估算。"],
    "重试是同一轮的第二次尝试，不是用户又问一遍",
  );
  assert.equal(messages.filter((m) => m.role === "user").length, 1, "用户轮次必须恰好一条");
  assert.equal(resolution.snapshotMessageCount, 3);
  assert.equal(resolution.eventMessageCount, 2);
});

test("批次2b-3·归并：retry 的 Run 只有 user/message（重试仍失败）时不凭空多出空轮次", () => {
  const runA = { runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z" };
  const retry = { runId: "run-A2", retryOfRunId: "run-A", runCreatedAt: "2026-09-01T01:00:00.000Z" };
  const aUser = userMsg(runA.runId, "问题");
  const aAssistant = assistantMsg(runA.runId, "答复");
  const retryUser = userMsg(retry.runId, "问题");

  const events = [...facts({ ...runA, user: aUser, assistant: aAssistant }), ...facts({ ...retry, user: retryUser })];
  const snapshot = session([aUser, aAssistant, retryUser]);

  const { messages, resolution } = resolveSessionHistory(snapshot, events);
  assert.equal(resolution.source, "events");
  assert.deepEqual(messages.map((m) => m.messageId), ["msg-run-A-u", "msg-run-A-a"]);
});

test("批次2b-3·归并：非 retry 的第二轮（用户真的又问一遍）必须算新一轮", () => {
  const runA = { runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z" };
  const runB = { runId: "run-B", runCreatedAt: "2026-09-01T02:00:00.000Z" }; // retryOfRunId 缺省
  const events = [
    ...facts({ ...runA, user: userMsg("run-A", "同一句话"), assistant: assistantMsg("run-A", "答复一") }),
    ...facts({ ...runB, user: userMsg("run-B", "同一句话"), assistant: assistantMsg("run-B", "答复二") }),
  ];
  const snapshot = session(events.map((evt) => evt.payload));

  const { messages, resolution } = resolveSessionHistory(snapshot, events);
  assert.equal(resolution.source, "events");
  assert.equal(messages.filter((m) => m.role === "user").length, 2, "正文相同但 runId 不同且非 retry，就是两轮");
  assert.equal(messages.length, 4);
});

// ============================================================
// ② 覆盖判定（整会话级回落）
// ============================================================

test("批次2b-3·回落：事件流里一条对话事实都没有 → 整会话回落快照（存量 17 条即此形态）", () => {
  const snapshot = session([snapshotMessage("存量提问"), snapshotMessage("存量答复", { role: "assistant" })]);
  const { messages, resolution } = resolveSessionHistory(snapshot, []);

  assert.equal(resolution.source, "snapshot");
  assert.equal(resolution.reason, "no-conversation-facts");
  assert.deepEqual(messages, snapshot.messages, "回落必须原样返回快照，不得增删改任何字段");
});

test("批次2b-3·回落：混合会话（同步降级轮不产事件）整会话回落，绝不半事件半快照拼接", () => {
  // 真实可达路径：第 1 轮走异步 Run（有事件），第 2 轮提交 503 → 前端回退旧同步通道
  // （直写 jsonb、无 runId、结构性无事件）。存在性判据会放它过，覆盖判据拦得住。
  const asyncUser = userMsg("run-A", "第一轮");
  const asyncAssistant = assistantMsg("run-A", "第一轮答复");
  const syncUser = snapshotMessage("第二轮（同步降级）");
  const syncAssistant = snapshotMessage("第二轮答复（同步降级）", { role: "assistant" });
  const events = [...facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user: asyncUser, assistant: asyncAssistant })];
  const snapshot = session([asyncUser, asyncAssistant, syncUser, syncAssistant]);

  const { messages, resolution } = resolveSessionHistory(snapshot, events);
  assert.equal(resolution.source, "snapshot", "混合会话走事件路径就会静默少一整轮，且用户会看见自己说的话消失");
  assert.equal(resolution.reason, "snapshot-not-covered");
  assert.deepEqual(resolution.uncovered.map((item) => item.why), ["no-projection-source", "no-projection-source"]);
  assert.deepEqual(messages, snapshot.messages, "回落给的是完整四轮，一条不少");
  assert.equal(messages.length, 4);
});

test("批次2b-3·回落：答复事件丢失（>1MiB 静默丢）时快照那条无对应事实 → 整会话回落", () => {
  const user = userMsg("run-A", "提问");
  // 会话侧照常有 assistant，且带来源键（它是经 appendMessageIdempotent 落的），
  // 但事件侧那一条写失败——快照说的和事件有的不一致，方向是「少一条答复」。
  const assistant = assistantMsg("run-A", "完整答复");
  const events = facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user });
  const snapshot = session([user, assistant]);

  const { messages, resolution } = resolveSessionHistory(snapshot, events);
  assert.equal(resolution.source, "snapshot");
  assert.deepEqual(resolution.uncovered.map((item) => item.why), ["no-matching-event"]);
  assert.equal(messages.length, 2, "答复不得丢");
});

test("批次2b-3·回落：来源键对不上任何 Run 事实时按未覆盖处理（不靠字符串前缀猜）", () => {
  const orphan = snapshotMessage("有键但无事实", { dedupKey: "run-ghost:assistant:1", runId: "run-ghost", role: "assistant" });
  const user = userMsg("run-A", "提问");
  const events = facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user });
  const { resolution } = resolveSessionHistory(session([user, orphan]), events);
  assert.equal(resolution.source, "snapshot");
  assert.deepEqual(resolution.uncovered.map((i) => i.why), ["no-matching-event"]);
});

test("批次2b-3·覆盖：事件比快照多（快照少一条）不算丢历史，仍走事件路径", () => {
  const user = userMsg("run-A", "提问");
  const assistant = assistantMsg("run-A", "答复");
  const events = [...facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user, assistant })];
  const { messages, resolution } = resolveSessionHistory(session([user]), events);
  assert.equal(resolution.source, "events", "事件是事实源，多出来不是丢失");
  assert.equal(messages.length, 2);
});

test("批次2b-3·空会话：两侧都空时走事件路径，不计入回落残量（残量数的是存量 17 条而非 101 条）", () => {
  const { messages, resolution } = resolveSessionHistory(session([]), []);
  assert.equal(resolution.source, "events");
  assert.equal(resolution.reason, "covered");
  assert.deepEqual(messages, []);
});

// ============================================================
// ③ delta 是传输面：有 delta 无 assistant/message 时的确定行为
// ============================================================

test("批次2b-3·delta：有 delta 无 assistant/message 且快照也没有答复 → 该轮只有用户轮，不拿 delta 拼答复", () => {
  const user = userMsg("run-A", "提问");
  const events = facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user, deltas: ["半", "截", "的", "答复"] });
  const { messages, resolution } = resolveSessionHistory(session([user]), events);

  assert.equal(resolution.source, "events");
  assert.deepEqual(messages.map((m) => m.messageId), ["msg-run-A-u"], "delta 不得被拼成一条答复");
  assert.equal(messages.filter((m) => m.role === "assistant").length, 0);
});

test("批次2b-3·delta：答复在快照里存在却无事实时回落（而非按 delta 重建）", () => {
  const user = userMsg("run-A", "提问");
  const assistant = assistantMsg("run-A", "完整答复");
  const events = facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user, deltas: ["完整", "答复"] });
  const { messages, resolution } = resolveSessionHistory(session([user, assistant]), events);
  assert.equal(resolution.source, "snapshot");
  assert.equal(messages.length, 2);
});

// ============================================================
// ④ 排序：跨 Run 按 Run 创建时刻，Run 内按事件序号
// ============================================================

test("批次2b-3·排序：乱序传入的事件按 runCreatedAt + sequence 还原为对话原序", () => {
  const runA = { runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z" };
  const runB = { runId: "run-B", runCreatedAt: "2026-09-01T00:05:00.000Z" };
  const events = [
    ...facts({ ...runB, user: userMsg("run-B", "第二轮提问"), assistant: assistantMsg("run-B", "第二轮答复") }),
    ...facts({ ...runA, user: userMsg("run-A", "第一轮提问"), assistant: assistantMsg("run-A", "第一轮答复") }),
  ];
  const { messages } = resolveSessionHistory(session(events.map((e) => e.payload)), events);
  assert.deepEqual(
    messages.map((m) => m.content),
    ["第一轮提问", "第一轮答复", "第二轮提问", "第二轮答复"],
  );
});

test("批次2b-3·排序：同一 Run 内 user 先于 assistant，与事件序号一致", () => {
  const run = { runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z" };
  const user = userMsg("run-A", "提问");
  const assistant = assistantMsg("run-A", "答复");
  const events = facts({ ...run, user, assistant });
  const shuffled = [events[1], events[0]];
  const { messages } = resolveSessionHistory(session([user, assistant]), shuffled);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
});

test("批次2b-3·排序：runCreatedAt 相同（同一毫秒）时按 runId 定序，结果可复现", () => {
  const t = "2026-09-01T00:00:00.000Z";
  const events = [
    ...facts({ runId: "run-b", runCreatedAt: t, user: userMsg("run-b", "B") }),
    ...facts({ runId: "run-a", runCreatedAt: t, user: userMsg("run-a", "A") }),
  ];
  const first = resolveSessionHistory(session(events.map((e) => e.payload)), events).messages.map((m) => m.content);
  const second = resolveSessionHistory(session(events.map((e) => e.payload)), [...events].reverse()).messages.map((m) => m.content);
  assert.deepEqual(first, ["A", "B"]);
  assert.deepEqual(second, first, "同一批事件换个传入顺序必须给同一个历史");
});

// ============================================================
// ⑤ 逐字节透传：重建不重新整形
// ============================================================

test("批次2b-3·逐字节：重建出的消息与事件载荷序列化后完全相同（含 projectionSource）", () => {
  const user = { ...userMsg("run-A", "提问"), attachmentIds: ["att-1"] } as AiMessage;
  const assistant = {
    ...assistantMsg("run-A", "答复"),
    metadata: { ...(assistantMsg("run-A", "答复").metadata ?? {}), intent: "domain_qa", toolCalls: [{ name: "query_projects" }] },
  } as AiMessage;
  const events = [...facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user, assistant })];
  const { messages } = resolveSessionHistory(session(events.map((e) => e.payload)), events);

  assert.equal(JSON.stringify(messages), JSON.stringify([user, assistant]), "载荷即消息本体，换源不得改一个字段");
  assert.deepEqual(Object.keys(messages[1] as unknown as Record<string, unknown>), Object.keys(assistant));
});

test("批次2b-3·形状：system/tool 角色与空正文不在对话事实类型里，缝也不负责过滤（整形留消费端）", () => {
  // 事件词汇表只有 user/message 与 assistant/message 两类对话事实；
  // 本函数不得顺手做角色过滤——那是 sessionRecordToHomeMessages 的整形口径。
  const user = userMsg("run-A", "提问");
  const assistant = assistantMsg("run-A", "");
  const events = facts({ runId: "run-A", runCreatedAt: "2026-09-01T00:00:00.000Z", user, assistant });
  const { messages } = resolveSessionHistory(session([user, assistant]), events);
  assert.equal(messages.length, 2, "空正文答复也是一轮事实，过滤与否由消费端决定");
});
