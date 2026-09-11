// ============================================================
// 批次 2b-3 · 换源判据②——新建真实两轮对话走**事件路径**，历史逐字节相同
// ============================================================
// 为什么必须是「新建的真实对话」而不是拿存量充数（架构侧 2026-09-11 派单口径③，
// 也是上一轮的教训）：开发库实取 101 条会话里 user/message 与 assistant/message
// **各 0 条**，17 条带消息的会话今天必然 100% 走回落。拿它们当判据，对照脚本会以
// 「全都走回落」的方式假绿通过——证得了「回落没出错」，证不了「事件流重建会不会
// 静默少历史」，而后者才是整条 2b 线的要害。
//
// 本文件三件事，缺一不可：
//  A. 新建真实两轮对话 → 读取口给的是**事件路径**（不是回落）→ 重建历史与快照逐字节相同；
//  B. 判别用例：改掉快照那条消息的正文，读回来的**仍是事件那份**——
//     没有这一条，A 就可能只是「jsonb 和 jsonb 自己比」的空转；
//  C. 反证回落方向：删掉一条事件、快照不动，读取口翻成整会话回落，
//     历史仍然**一条不少**（失败方向是「多读」而不是「静默少一条」）。
//
// 装配复用 test-helpers/drive-workbench-turn.ts（真 usecase 提交 + 真 boot + 真 worker
// + 真库），读取走真实 `getAiSession` → ai-sessions PG 仓储 → 2b-3 解析口。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";

import { aiSessions, harnessRunEvents, harnessRuns } from "../../db/schema";
import { createConversationEventHistorySource } from "./conversation-event-history";
import { deriveSessionMessages, resolveSessionHistory } from "../ai-sessions/session-history";
import { createAiSession, getAiSession } from "../ai-sessions/ai-sessions.usecase";
import { createTestUser, cleanupTestUsers } from "../../test-helpers/test-users";
import { driveWorkbenchTurn } from "../../test-helpers/drive-workbench-turn";
import type { AiMessage, AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import type { AuthUser } from "../../types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let alice: AuthUser | null = null;
const createdRunIds: string[] = [];
const createdSessionIds: string[] = [];

before(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  db = drizzle(pool);
  alice = await createTestUser("wes-b2b3-alice", { role: "admin" });
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
  await cleanupTestUsers("wes-b2b3").catch(() => undefined);
  await pool!.end();
});

/** 不经任何解析，直读 ai_sessions.messages——它是被对照的那一侧。 */
async function readRawSnapshot(sessionId: string): Promise<AiMessage[]> {
  const rows = await db!.select().from(aiSessions).where(eq(aiSessions.sessionId, sessionId));
  const messages = (rows[0]?.messages ?? []) as unknown as AiMessage[];
  return Array.isArray(messages) ? messages : [];
}

function asRecord(sessionId: string, messages: AiMessage[]): AiSessionRecord {
  return { messages, sessionId } as unknown as AiSessionRecord;
}

async function loadFacts(sessionId: string) {
  const source = createConversationEventHistorySource(db as never);
  return (await source.loadConversationFacts([sessionId])).get(sessionId) ?? [];
}

/** 字节数 + SHA-256 前 12 位：够判「同一份序列」，又不把客户的正文打进日志。 */
function digestOf(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return `${Buffer.byteLength(text, "utf-8")}B/${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

function printHistory(label: string, messages: AiMessage[]): void {
  console.log(`[B2b3·${label}] 条数=${messages.length} 整体摘要=${digestOf(messages)}`);
  messages.forEach((message, index) => {
    console.log(
      `[B2b3·${label}]   #${index} ${message.role} messageId=${message.messageId} ` +
        `createdAt=${message.createdAt} 正文=${digestOf(message.content)} ` +
        `键=${Object.keys(message).sort().join(",")}`,
    );
  });
}

const TURN_1_CONTENT = "第一轮：评估一下 ERP 项目工作量，客户是制造业，含多组织协同。";
const TURN_1_DELTAS = ["第一轮答复：", "建议按 ", "3 个模块估算", "。✅"];
const TURN_2_CONTENT = "第二轮：那供应链云呢？（全角括号）";
const TURN_2_DELTAS = ["第二轮答复：", "供应链云建议单独排期。"];

async function createTwoTurnSession(): Promise<{ sessionId: string; turn1RunId: string; turn2RunId: string }> {
  const session = await createAiSession(alice!, { title: "批次2b3换源会话", workflowKey: "free_chat" });
  createdSessionIds.push(session.sessionId);
  const turn1 = await driveWorkbenchTurn({
    databaseUrl: TEST_DATABASE_URL!,
    owner: alice!,
    sessionId: session.sessionId,
    content: TURN_1_CONTENT,
    deltas: TURN_1_DELTAS,
    onRunCreated: (runId) => createdRunIds.push(runId),
  });
  const turn2 = await driveWorkbenchTurn({
    databaseUrl: TEST_DATABASE_URL!,
    owner: alice!,
    sessionId: session.sessionId,
    content: TURN_2_CONTENT,
    deltas: TURN_2_DELTAS,
    onRunCreated: (runId) => createdRunIds.push(runId),
  });
  return { sessionId: session.sessionId, turn1RunId: turn1.runId, turn2RunId: turn2.runId };
}

// ============================================================
// A. 判据②本体：新建真实两轮对话 → 走事件路径 → 逐字节相同
// ============================================================

test(
  "批次2b-3 判据②A：新建真实两轮对话走事件路径，重建历史与快照逐字节相同",
  { skip: !TEST_DATABASE_URL },
  async () => {
    const { sessionId, turn1RunId, turn2RunId } = await createTwoTurnSession();
    console.log(`[B2b3·判据②] 新建会话 id=${sessionId} run1=${turn1RunId} run2=${turn2RunId}`);

    const snapshot = await readRawSnapshot(sessionId);
    const facts = await loadFacts(sessionId);
    const { messages: rebuilt, resolution } = resolveSessionHistory(asRecord(sessionId, snapshot), facts);

    printHistory("快照(ai_sessions.messages)", snapshot);
    printHistory("事件流重建", rebuilt);
    console.log(
      `[B2b3·判据②] 判定：源=${resolution.source} 原因=${resolution.reason} ` +
        `事件=${facts.length} 条 事件重建=${resolution.eventMessageCount} 条 快照=${resolution.snapshotMessageCount} 条 ` +
        `未覆盖=${resolution.uncovered.length} 归并retry=${resolution.mergedRetryUserTurns}`,
    );

    // ① 这条会话必须走**事件路径**——否则整个判据退化成「回落没出错」的假绿
    assert.equal(
      resolution.source,
      "events",
      `判据②要求该会话走事件路径而非回落；实取 reason=${resolution.reason}，未覆盖项=${JSON.stringify(resolution.uncovered)}`,
    );
    assert.equal(facts.length, 4, "两轮对话应各有 user/message 与 assistant/message 共 4 条事实");
    assert.equal(resolution.uncovered.length, 0);

    // ② 逐字节：重建结果与快照序列化后完全相同（不排除任何字段）
    assert.equal(
      JSON.stringify(rebuilt),
      JSON.stringify(snapshot),
      `事件流重建与快照不逐字节相同（条数 ${rebuilt.length} vs ${snapshot.length}；摘要 ${digestOf(rebuilt)} vs ${digestOf(snapshot)}）`,
    );

    // ③ 生产读取路径（真 getAiSession → 真仓储 → 解析口）给出的就是上面那份
    const served = await getAiSession(alice!, sessionId);
    assert.ok(served, "真实读取路径必须取到该会话");
    const servedHistory = deriveSessionMessages(served);
    assert.equal(
      JSON.stringify(servedHistory),
      JSON.stringify(snapshot),
      "经 deriveSessionMessages 取到的历史必须与快照逐字节相同",
    );
    printHistory("deriveSessionMessages(生产读取口)", [...servedHistory]);

    // ④ 顺序即对话原序：user/assistant 交替，且各轮正文只出现在自己那一轮
    assert.deepEqual(
      servedHistory.map((message) => `${message.role}`),
      ["user", "assistant", "user", "assistant"],
    );
    assert.equal(servedHistory[0].content, TURN_1_CONTENT);
    assert.equal(servedHistory[2].content, TURN_2_CONTENT);
    assert.equal(servedHistory[1].content, TURN_1_DELTAS.join(""));
    assert.equal(servedHistory[3].content, TURN_2_DELTAS.join(""));
    // 事件载荷的来源键与快照一致——覆盖判定不是靠正文猜出来的
    assert.equal(
      (servedHistory[0].metadata as { projectionSource?: { deduplicationKey?: string } })?.projectionSource
        ?.deduplicationKey,
      `${turn1RunId}:user:1`,
    );
  },
);

// ============================================================
// B. 判别用例：改掉快照正文，读回来的仍是事件那份
// ============================================================

test(
  "批次2b-3 判据②B：改掉快照那条消息的正文，读回来的仍是事件载荷（证明源真的换了）",
  { skip: !TEST_DATABASE_URL },
  async () => {
    const { sessionId } = await createTwoTurnSession();
    const snapshotBefore = await readRawSnapshot(sessionId);

    // 把第二轮的 assistant 正文改掉（会话快照侧），事件流不动。
    // 覆盖判定认来源键不认正文，所以该会话**仍走事件路径**，读回来的必须是事件那份原文。
    // 没有本条，判据 A 就可能只是「jsonb 与 jsonb 自己比」——源没换也照样绿。
    const mutated = snapshotBefore.map((message, index) =>
      index === 3 ? { ...message, content: "【夹具改动】这一句只存在于快照，事件流里没有" } : message,
    );
    await db!
      .update(aiSessions)
      .set({ messages: mutated as never })
      .where(eq(aiSessions.sessionId, sessionId));

    const snapshotAfter = await readRawSnapshot(sessionId);
    assert.equal(
      snapshotAfter[3].content,
      "【夹具改动】这一句只存在于快照，事件流里没有",
      "夹具改动必须真的落到快照，否则本用例什么都没判别",
    );

    const served = await getAiSession(alice!, sessionId);
    const servedHistory = deriveSessionMessages(served!);
    console.log(
      `[B2b3·判据②B] 快照第 4 条=${digestOf(snapshotAfter[3].content)} 读回来=${digestOf(servedHistory[3].content)} ` +
        `（两侧摘要不同才说明读取源不是快照）`,
    );
    assert.equal(
      servedHistory[3].content,
      TURN_2_DELTAS.join(""),
      "读回来的必须是事件流那份——给的是被改过的快照正文，就说明源还在 jsonb，换源没生效",
    );
    assert.notEqual(servedHistory[3].content, snapshotAfter[3].content);
    // 其余三条与事件载荷一致，且条数不少
    assert.equal(servedHistory.length, 4);
    assert.equal(JSON.stringify(servedHistory.slice(0, 3)), JSON.stringify(snapshotBefore.slice(0, 3)));
  },
);

// ============================================================
// C. 反证回落方向：丢一条事件，历史仍一条不少
// ============================================================

test(
  "批次2b-3 判据②C：删掉一条对话事实后整会话回落快照，历史一条不少（失败方向不是静默丢）",
  { skip: !TEST_DATABASE_URL },
  async () => {
    const { sessionId, turn2RunId } = await createTwoTurnSession();
    const snapshot = await readRawSnapshot(sessionId);
    assert.equal(snapshot.length, 4);

    // 模拟 BE-2026-09-08…:risks-3 的形态：答复事件写丢了，快照那条还在
    await db!
      .delete(harnessRunEvents)
      .where(and(eq(harnessRunEvents.harnessRunId, turn2RunId), eq(harnessRunEvents.eventType, "assistant/message")));

    const facts = await loadFacts(sessionId);
    const { messages, resolution } = resolveSessionHistory(asRecord(sessionId, snapshot), facts);
    console.log(
      `[B2b3·判据②C] 判定：源=${resolution.source} 原因=${resolution.reason} 事件=${facts.length} 条 ` +
        `未覆盖=${JSON.stringify(resolution.uncovered)}`,
    );

    assert.equal(resolution.source, "snapshot", "事件覆盖不住快照时必须整会话回落，而不是给出少一轮的历史");
    assert.equal(resolution.reason, "snapshot-not-covered");
    assert.deepEqual(resolution.uncovered.map((item) => item.why), ["no-matching-event"]);
    assert.equal(messages.length, 4, "回落给的是完整四轮");
    assert.equal(JSON.stringify(messages), JSON.stringify(snapshot), "回落即原样，不得增删改");

    // 生产读取路径同结论
    const served = await getAiSession(alice!, sessionId);
    assert.equal(deriveSessionMessages(served!).length, 4, "读取口不得因为事件缺失而少给一条");
  },
);
