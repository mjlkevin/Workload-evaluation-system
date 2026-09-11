// ============================================================
// 批次 2b-3 · 对话事实批量读取口（harness 事件流 → 会话历史源）
// ============================================================
// 本文件只管两件事：① 一次查询取回**一批**会话的对话事实；② 只取对话事实。
// 判定（覆盖 / 回落 / 归并 / 排序）在 ai-sessions/session-history.ts，本处不掺——
// 掺进来就没法单独证明「N 个会话 = 1 次查询」这条硬要求。
//
// 为什么按会话 id 集合批量取（架构侧 2026-09-11 硬要求）：管理员审计
// listAllAiSessionsForAdmin 是全表逐条 map，逐会话查事件会当场变成 N+1；
// 而「审计那条路继续读快照」这种绕法等于给逐字节口径开一个按消费方划分的例外。
// 所以「N 个会话只发 1 条 SQL」在本文件里是**断言**，不是注释里的约定。
// ============================================================

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import { aiSessions, harnessRunEvents, harnessRuns } from "../../db/schema";
import { createConversationEventHistorySource } from "./conversation-event-history";
import { SESSION_CONVERSATION_FACT_EVENT_TYPES } from "../ai-sessions/session-history";
import { HARNESS_RUN_SINGLETON_EVENT_TYPES } from "./harness-runtime.types";
import type { AiMessage } from "../ai-sessions/ai-sessions.types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
const createdSessionIds: string[] = [];
const createdRunIds: string[] = [];

/**
 * 计数包装：drizzle 的 node-postgres 会话对「没有 connect 的 client」直接调
 * `client.query(config, values)`。给一个 ClientBase 形状的壳，把每条 SQL 记下来再转给真池。
 * 不用 statement_timeout / 日志解析那些间接手段——本断言要的就是「这次调用发了几条」。
 */
function countingClient(poolInstance: Pool, statements: string[]) {
  return {
    // drizzle 传的是 { name, text, types } 配置 + values，不是裸 SQL 串
    query: (config: unknown, values?: unknown[]) => {
      const text = typeof config === "string" ? config : String((config as { text?: unknown })?.text ?? config);
      statements.push(text);
      return poolInstance.query(config as never, values as never[]) as never;
    },
    release: () => undefined,
  };
}

async function withSource(body: (source: ReturnType<typeof createConversationEventHistorySource>, statements: string[]) => Promise<void>) {
  const poolInstance = new Pool({ connectionString: TEST_DATABASE_URL!, max: 2 });
  const statements: string[] = [];
  try {
    const dbInstance = drizzle(countingClient(poolInstance, statements) as never);
    await body(createConversationEventHistorySource(dbInstance), statements);
  } finally {
    await poolInstance.end();
  }
}

/** 会话 + 一个 Run + 该 Run 的事件序列。runId 由本函数生成并回传，夹具不自己编。 */
async function seedConversation(params: {
  build: (runId: string) => {
    messages: AiMessage[];
    /** [eventType, payload] 序列，按序落 sequence 1..n */
    events: Array<[string, Record<string, unknown>]>;
  };
  retryOfRunId?: string | null;
  runCreatedAt?: Date;
}): Promise<{ sessionId: string; runId: string }> {
  const sessionId = `2b3-sess-${randomUUID()}`;
  const runId = randomUUID();
  const { messages, events } = params.build(runId);
  createdSessionIds.push(sessionId);
  createdRunIds.push(runId);

  const at = params.runCreatedAt ?? new Date("2026-09-03T08:00:00Z");
  await db!.insert(aiSessions).values({
    sessionId,
    ownerUserId: "2b3-owner",
    ownerUsername: "2b3",
    title: "换源夹具会话",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    messages,
    createdAt: at,
    updatedAt: at,
  });
  await insertRun({ runId, sessionId, retryOfRunId: params.retryOfRunId ?? null, createdAt: at, title: "换源夹具 Run" });
  await insertEvents(runId, events);
  return { sessionId, runId };
}

async function insertRun(params: { runId: string; sessionId: string; retryOfRunId?: string | null; createdAt: Date; title: string }) {
  createdRunIds.push(params.runId);
  await db!.insert(harnessRuns).values({
    harnessRunId: params.runId,
    ownerUserId: "2b3-owner",
    ownerUsername: "2b3",
    mode: "interactive",
    stage: "workbench_chat",
    status: "completed",
    title: params.title,
    aiSessionId: params.sessionId,
    runKind: "workbench_chat",
    retryOfRunId: params.retryOfRunId ?? null,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  });
}

async function insertEvents(runId: string, events: Array<[string, Record<string, unknown>]>) {
  let sequence = 1;
  for (const [eventType, payload] of events) {
    await db!.insert(harnessRunEvents).values({
      harnessRunEventId: randomUUID(),
      harnessRunId: runId,
      sequence: sequence++,
      eventType,
      payload,
    });
  }
}

function envelopeMessage(runId: string, role: "user" | "assistant", content: string): AiMessage {
  return {
    messageId: `msg-${randomUUID()}`,
    role,
    content,
    createdAt: "2026-09-03T08:00:00.000Z",
    attachmentIds: [],
    metadata: {
      projectionSource: {
        deduplicationKey: `${runId}:${role}:1`,
        runId,
        eventType: role === "user" ? "user_message" : "assistant_message",
      },
    },
  };
}

function userTurn(runId: string, content: string) {
  return {
    messages: [envelopeMessage(runId, "user", content)],
    events: [["run_queued", {}] as [string, Record<string, unknown>], ["user/message", envelopeMessage(runId, "user", content) as unknown as Record<string, unknown>] as [string, Record<string, unknown>]],
  };
}

before(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
  db = drizzle(pool);
});

after(async () => {
  if (!db) return;
  for (const runId of createdRunIds.splice(0)) {
    await db.delete(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId)).catch(() => undefined);
    await db.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId)).catch(() => undefined);
  }
  for (const sessionId of createdSessionIds.splice(0)) {
    await db.delete(aiSessions).where(eq(aiSessions.sessionId, sessionId)).catch(() => undefined);
  }
  await pool!.end();
});

const FACT_QUERY = /harness_run_events/i;

test(
  "批次2b-3·批量：4 个会话只发 1 条 SQL（管理员审计全表逐条 map 不得退化成 N+1）",
  { skip: !TEST_DATABASE_URL },
  async () => {
    const seeded = await Promise.all(
      Array.from({ length: 4 }, (_, index) => seedConversation({ build: (runId) => userTurn(runId, `提问 ${index}`) })),
    );
    const ids = seeded.map((item) => item.sessionId);

    await withSource(async (source, statements) => {
      const before = statements.length;
      const facts = await source.loadConversationFacts(ids);
      const issued = statements.slice(before).filter((text) => FACT_QUERY.test(text));
      assert.equal(issued.length, 1, `4 个会话必须一次取回，实取 ${issued.length} 条：${JSON.stringify(issued.map((t) => t.slice(0, 80)))}`);
      assert.equal(facts.size, 4, "四个会话的对话事实都要回来");
      for (const id of ids) assert.equal((facts.get(id) ?? []).length, 1, `会话 ${id} 应有 1 条用户事实`);
    });
  },
);

test("批次2b-3·批量：空会话集合不查库（省一次往返，也别让 in () 空集去赌）", { skip: !TEST_DATABASE_URL }, async () => {
  await withSource(async (source, statements) => {
    const facts = await source.loadConversationFacts([]);
    assert.equal(facts.size, 0);
    assert.equal(statements.filter((text) => FACT_QUERY.test(text)).length, 0, "没有会话要查时一条 SQL 都不该发");
  });
});

test("批次2b-3·词汇表：只取对话事实，run_queued / thought / text.delta 不得混进历史源", { skip: !TEST_DATABASE_URL }, async () => {
  const { sessionId } = await seedConversation({
    build: (runId) => ({
      messages: [envelopeMessage(runId, "user", "提问"), envelopeMessage(runId, "assistant", "答复")],
      events: [
        ["run_queued", {}],
        ["user/message", envelopeMessage(runId, "user", "提问") as unknown as Record<string, unknown>],
        ["thought", { text: "想一想" }],
        ["text.delta", { delta: "答" }],
        ["text.delta", { delta: "复" }],
        ["assistant/message", envelopeMessage(runId, "assistant", "答复") as unknown as Record<string, unknown>],
        ["run_completed", {}],
      ],
    }),
  });

  await withSource(async (source) => {
    const facts = (await source.loadConversationFacts([sessionId])).get(sessionId) ?? [];
    assert.deepEqual(
      facts.map((fact) => fact.eventType),
      ["user/message", "assistant/message"],
      "delta 是传输面，混进历史源就等于按碎片重建答复",
    );
  });
});

test("批次2b-3·字段：run 侧的 retryOfRunId 与两个排序键随事实回来", { skip: !TEST_DATABASE_URL }, async () => {
  const runCreatedAt = new Date("2026-09-03T08:00:00Z");
  const { sessionId, runId } = await seedConversation({
    runCreatedAt,
    retryOfRunId: null,
    build: (id) => ({
      messages: [envelopeMessage(id, "user", "提问")],
      events: [["user/message", envelopeMessage(id, "user", "提问") as unknown as Record<string, unknown>]],
    }),
  });

  await withSource(async (source) => {
    const facts = (await source.loadConversationFacts([sessionId])).get(sessionId) ?? [];
    assert.equal(facts.length, 1);
    const fact = facts[0];
    assert.equal(fact.runId, runId);
    assert.equal(fact.retryOfRunId, null, "retry_of_run_id 为空必须映射成 null，不能靠 undefined 猜");
    assert.equal(fact.runCreatedAt, runCreatedAt.toISOString());
    assert.equal(fact.sequence, 1, "Run 内序号是排序键，必须如实带回");
    assert.equal((fact.payload as unknown as Record<string, unknown>).content, "提问", "载荷原样透传，读取口不整形");
  });
});

test("批次2b-3·归并输入：retry 的 Run 带得出非空 retryOfRunId（口径①的数据前提）", { skip: !TEST_DATABASE_URL }, async () => {
  const original = await seedConversation({ build: (runId) => userTurn(runId, "提问") });
  const retryRunId = randomUUID();
  await insertRun({
    runId: retryRunId,
    sessionId: original.sessionId,
    retryOfRunId: original.runId,
    createdAt: new Date("2026-09-03T09:00:00Z"),
    title: "重试 Run",
  });
  await insertEvents(retryRunId, [["user/message", envelopeMessage(retryRunId, "user", "提问") as unknown as Record<string, unknown>]]);

  await withSource(async (source) => {
    const facts = (await source.loadConversationFacts([original.sessionId])).get(original.sessionId) ?? [];
    assert.equal(facts.length, 2);
    assert.equal(facts[0].retryOfRunId, null, "原始 Run 的 retryOfRunId 为空");
    assert.equal(facts[1].retryOfRunId, original.runId, "重试 Run 必须带得出它 retry 的是哪一轮，否则口径①无从判定");
    assert.ok(facts[0].runCreatedAt <= facts[1].runCreatedAt, "跨 Run 排序键在重试场景下与对话顺序同向");
  });
});

test("批次2b-3·隔离：未请求的会话不得被串进来", { skip: !TEST_DATABASE_URL }, async () => {
  const mine = await seedConversation({ build: (runId) => userTurn(runId, "我的提问") });
  const theirs = await seedConversation({ build: (runId) => userTurn(runId, "别人的提问") });

  await withSource(async (source) => {
    const facts = await source.loadConversationFacts([mine.sessionId]);
    assert.equal(facts.has(theirs.sessionId), false, "未请求的会话不得被带回");
    const list = facts.get(mine.sessionId) ?? [];
    assert.equal(list.length, 1);
    assert.equal((list[0].payload as unknown as Record<string, unknown>).content, "我的提问");
  });
});

test("批次2b-3·跨域词汇表：读取侧对话事实清单必须与写入侧单次清单同集合", () => {
  // 二者今天同集合（user/message / assistant/message）纯属巧合：那份是写入侧
  // 「一个 Run 最多一条、首写获胜」的幂等清单，这份是读取侧的历史词汇表。
  // 谁单方面演化，换源就会悄悄读漏或多读一类事实——所以把它钉成断言。
  assert.deepEqual(
    [...SESSION_CONVERSATION_FACT_EVENT_TYPES].sort(),
    [...HARNESS_RUN_SINGLETON_EVENT_TYPES].sort(),
    "读写两侧的对话事实清单必须一起演化（不同步即本用例当场红）",
  );
});
