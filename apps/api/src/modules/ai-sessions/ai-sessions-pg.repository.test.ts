// ============================================================
// AI Sessions 域 PG 仓储测试（阶段 2 批 3 · 第 1–3 步）
// ============================================================
// 口径：按批 1/批 2 确立的五条硬性范式验证 ai_sessions 表的 PG 实现——
// 幂等插入（onConflictDoNothing + 重查消歧）、条件 UPDATE/DELETE CAS、
// jsonb 原子追加（同会话并发不丢失）、DB 时钟、安全错误边界；
// 外加 §4.6 测试套件模板的并发用例（同一会话并发追加 + 不同会话并发写）
// 与本域缓存策略用例（不加缓存层 → 带外写入立即可见）。
// 仅读取 TEST_DATABASE_URL；缺失时跳过（与 users-pg.repository.test 同范式）。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { readDbNow } from "../../db/now";
import { aiSessions } from "../../db/schema";
import type { AuthUser } from "../../types";
import type { AiSessionRecord } from "./ai-sessions.types";
import {
  AiSessionsStoreError,
  createAiSessionsPgRepository,
  type AiSessionsPgRepository,
} from "./ai-sessions-pg.repository";
import { appendAiSessionEvent, createAiSession, deleteAiSession, getAiSession } from "./ai-sessions.usecase";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let repo: AiSessionsPgRepository | null = null;
const createdSessionIds: string[] = [];

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createAiSessionsPgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 afterEach 可能未跑完）
  await pool.query("DELETE FROM ai_sessions WHERE session_id LIKE 'wes-t-aisess-%'");
});

after(async () => {
  if (pool) await pool.end();
});

afterEach(async () => {
  if (!pool) return;
  for (const sessionId of createdSessionIds.splice(0)) {
    await pool.query("DELETE FROM ai_sessions WHERE session_id = $1", [sessionId]);
  }
});

function trackSession(sessionId: string): string {
  createdSessionIds.push(sessionId);
  return sessionId;
}

function makeSession(overrides: Partial<AiSessionRecord> = {}): AiSessionRecord {
  const sessionId = trackSession(overrides.sessionId ?? `wes-t-aisess-${randomUUID().slice(0, 8)}`);
  const nowIso = new Date().toISOString();
  return {
    sessionId,
    ownerUserId: overrides.ownerUserId ?? "wes-t-owner-a",
    ownerUsername: overrides.ownerUsername ?? "wes-t-owner-a",
    title: overrides.title ?? "测试会话",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    summary: "",
    messages: [],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

async function seedSession(overrides: Partial<AiSessionRecord> = {}): Promise<AiSessionRecord> {
  const { session } = await repo!.createSession({ session: makeSession(overrides) });
  return session;
}

async function readDbSession(sessionId: string) {
  const result = await pool!.query("SELECT * FROM ai_sessions WHERE session_id = $1", [sessionId]);
  return result.rows[0] ?? null;
}

// ─── 幂等插入（范式 #2） ─────────────────────────────────────

test("createSession 幂等：同 sessionId 重放返回原记录", { skip: !testDatabaseUrl }, async () => {
  const input = makeSession({ title: "首次标题" });
  const first = await repo!.createSession({ session: input });
  assert.equal(first.created, true);

  // 重放（携带不同标题）：原记录获胜
  const replay = await repo!.createSession({ session: { ...input, title: "重放标题" } });
  assert.equal(replay.created, false);
  assert.equal(replay.session.title, "首次标题");
  assert.equal(replay.session.sessionId, input.sessionId);
});

// ─── 归属隔离 ────────────────────────────────────────────────

test("findSession 归属过滤：非 owner 与不存在同为 null", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  assert.equal(await repo!.findSession({ ownerUserId: "wes-t-owner-b", sessionId: session.sessionId }), null);
  assert.equal(await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: "wes-t-aisess-no-such" }), null);
  const own = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  assert.equal(own!.sessionId, session.sessionId);
});

test("listSessionsByOwner 只返回本人会话", { skip: !testDatabaseUrl }, async () => {
  await seedSession({ ownerUserId: "wes-t-owner-a" });
  await seedSession({ ownerUserId: "wes-t-owner-b" });
  const listA = await repo!.listSessionsByOwner("wes-t-owner-a");
  assert.ok(listA.length >= 1);
  assert.ok(listA.every((session) => session.ownerUserId === "wes-t-owner-a"));
});

// ─── 条件 UPDATE / DELETE CAS（范式 #3） ─────────────────────

test("renameSession 行级更新：不存在或非 owner 返回 null", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const renamed = await repo!.renameSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId, title: "新标题" });
  assert.equal(renamed!.title, "新标题");
  const row = await readDbSession(session.sessionId);
  assert.equal(row.title, "新标题");

  assert.equal(
    await repo!.renameSession({ ownerUserId: "wes-t-owner-b", sessionId: session.sessionId, title: "越权" }),
    null,
    "非 owner 不得改名",
  );
  assert.equal(
    await repo!.renameSession({ ownerUserId: "wes-t-owner-a", sessionId: "wes-t-aisess-no-such", title: "幽灵" }),
    null,
  );
});

test("deleteSession 行级删除：重复删除与非 owner 均 false", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  assert.equal(await repo!.deleteSession({ ownerUserId: "wes-t-owner-b", sessionId: session.sessionId }), false);
  assert.equal(await repo!.deleteSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId }), true);
  assert.equal(await repo!.deleteSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId }), false);
  assert.equal(await readDbSession(session.sessionId), null);
});

// ─── jsonb 原子追加（范式 #3） ───────────────────────────────

test("appendSessionEvent 一次追加四类子行并刷新 updatedAt", { skip: !testDatabaseUrl }, async () => {
  // 注入回拨 1 小时的创建时钟，确保追加后 updatedAt 刷新可确定性断言（避免同毫秒巧合）
  const pastIso = new Date(Date.now() - 3600_000).toISOString();
  const { session } = await repo!.createSession({ session: makeSession({ ownerUserId: "wes-t-owner-a" }), now: new Date(pastIso) });
  assert.equal(session.createdAt, pastIso);
  const nowIso = new Date().toISOString();
  const updated = await repo!.appendSessionEvent({
    ownerUserId: "wes-t-owner-a",
    sessionId: session.sessionId,
    messages: [{ messageId: "m1", role: "user", content: "你好", createdAt: nowIso }],
    attachments: [{ attachmentId: "att1", name: "a.xlsx", createdAt: nowIso }],
    artifacts: [{ artifactId: "art1", type: "note", title: "产物", content: "x", status: "generated", createdAt: nowIso }],
    pendingActions: [{ actionId: "pa1", actionType: "confirm", title: "待办", riskLevel: "low", status: "pending", payload: {}, createdAt: nowIso }],
  });
  assert.equal(updated!.messages.length, 1);
  assert.equal(updated!.attachments.length, 1);
  assert.equal(updated!.artifacts.length, 1);
  assert.equal(updated!.pendingActions.length, 1);
  assert.notEqual(updated!.updatedAt, session.createdAt, "追加后 updatedAt 必须刷新");

  assert.equal(
    await repo!.appendSessionEvent({ ownerUserId: "wes-t-owner-a", sessionId: "wes-t-aisess-no-such", messages: [{ messageId: "m2", role: "user", content: "x", createdAt: nowIso }] }),
    null,
  );
  assert.equal(
    await repo!.appendSessionEvent({ ownerUserId: "wes-t-owner-b", sessionId: session.sessionId, messages: [{ messageId: "m3", role: "user", content: "越权", createdAt: nowIso }] }),
    null,
    "非 owner 不得追加",
  );
});

// ─── DB 时钟（范式 #4） ──────────────────────────────────────

test("createSession 时间戳取 DB 时钟（readDbNow 前后夹逼）", { skip: !testDatabaseUrl }, async () => {
  const before = await readDbNow(repo!.__dbForTest());
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const after = await readDbNow(repo!.__dbForTest());
  const created = Number(new Date(session.createdAt));
  assert.ok(created >= before.getTime() - 1000 && created <= after.getTime() + 1000, "createdAt 应落在 DB 时钟前后夹逼区间内");
  assert.equal(session.createdAt, session.updatedAt);
});

// ─── 错误边界（范式 #1 / ISS-2026-08-18-004） ────────────────

test("读取失败抛 AI_SESSIONS_STORE_INTERNAL 且不泄露连接串", { skip: !testDatabaseUrl }, async () => {
  const badHost = "postgres://wes:wes@127.0.0.1:59999/wes_no_such_db";
  const brokenRepo = createAiSessionsPgRepository(drizzle(new Pool({ connectionString: badHost, connectionTimeoutMillis: 300 })));
  await assert.rejects(
    () => brokenRepo.listAllSessions(),
    (err: unknown) => {
      assert.ok(err instanceof AiSessionsStoreError);
      assert.equal((err as AiSessionsStoreError).code, "AI_SESSIONS_STORE_INTERNAL");
      assert.ok(!String((err as Error).message).includes("127.0.0.1"), "错误信息不得含连接细节");
      return true;
    },
  );
  // 读取失败不得静默返回空集合（ISS-2026-08-18-004）
  await assert.rejects(() => brokenRepo.listSessionsByOwner("wes-t-owner-a"));
});

// ─── §4.6 并发模板：同一会话并发追加（jsonb 原子性） ──────────

test("并发：同一会话 8 路并发追加消息全部生效（无丢失无撕裂）", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const contents = Array.from({ length: 8 }, (_, i) => `并发消息-${i}`);
  await Promise.all(
    contents.map((content, i) =>
      repo!.appendSessionEvent({
        ownerUserId: "wes-t-owner-a",
        sessionId: session.sessionId,
        messages: [{ messageId: `race-same-${i}`, role: "user", content, createdAt: new Date().toISOString() }],
      }),
    ),
  );
  const after = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  assert.equal(after!.messages.length, 8, "8 路并发追加必须全部落库");
  for (const content of contents) {
    assert.ok(after!.messages.some((message) => message.content === content), `缺失消息：${content}`);
  }
});

// ─── §4.6 并发模板：不同会话并发写（JSON 整存 RMW 真正会坏的一半） ──

test("并发：不同会话并发写互不覆盖（A/B 各自 4 路追加全部生效）", { skip: !testDatabaseUrl }, async () => {
  const sessionA = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const sessionB = await seedSession({ ownerUserId: "wes-t-owner-b" });
  const contentsA = Array.from({ length: 4 }, (_, i) => `A-消息-${i}`);
  const contentsB = Array.from({ length: 4 }, (_, i) => `B-消息-${i}`);
  await Promise.all([
    ...contentsA.map((content, i) =>
      repo!.appendSessionEvent({
        ownerUserId: "wes-t-owner-a",
        sessionId: sessionA.sessionId,
        messages: [{ messageId: `race-a-${i}`, role: "user", content, createdAt: new Date().toISOString() }],
      }),
    ),
    ...contentsB.map((content, i) =>
      repo!.appendSessionEvent({
        ownerUserId: "wes-t-owner-b",
        sessionId: sessionB.sessionId,
        messages: [{ messageId: `race-b-${i}`, role: "user", content, createdAt: new Date().toISOString() }],
      }),
    ),
  ]);
  const afterA = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: sessionA.sessionId });
  const afterB = await repo!.findSession({ ownerUserId: "wes-t-owner-b", sessionId: sessionB.sessionId });
  assert.equal(afterA!.messages.length, 4, "会话 A 的 4 条消息必须全部落库（不得被 B 的写覆盖）");
  assert.equal(afterB!.messages.length, 4, "会话 B 的 4 条消息必须全部落库（不得被 A 的写覆盖）");
  assert.ok(afterA!.messages.every((message) => message.content.startsWith("A-")), "会话 A 不得混入 B 的消息");
  assert.ok(afterB!.messages.every((message) => message.content.startsWith("B-")), "会话 B 不得混入 A 的消息");
});

// ─── RP-047 幂等投影追加（来源键 dedup） ─────────────────────

test("appendMessageIdempotent：首次创建、重放命中、会话不存在", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const source = { deduplicationKey: "run-1:assistant:1", runId: "run-1", eventType: "assistant_message" };
  const message = { messageId: "proj-1", role: "assistant" as const, content: "投影消息", createdAt: new Date().toISOString() };

  const first = await repo!.appendMessageIdempotent({ sessionId: session.sessionId, message, source });
  assert.deepEqual({ found: first.found, created: first.created }, { found: true, created: true });
  assert.deepEqual(
    (first.message.metadata as { projectionSource?: unknown } | undefined)?.projectionSource,
    source,
    "存储消息必须携带来源键",
  );

  const replay = await repo!.appendMessageIdempotent({
    sessionId: session.sessionId,
    message: { ...message, content: "重放不得覆盖" },
    source,
  });
  assert.deepEqual({ found: replay.found, created: replay.created }, { found: true, created: false });
  assert.equal(replay.message.content, "投影消息", "重放返回原消息");

  const after = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  assert.equal(after!.messages.length, 1);

  const missing = await repo!.appendMessageIdempotent({ sessionId: "wes-t-aisess-no-such", message, source });
  assert.deepEqual({ found: missing.found, created: missing.created }, { found: false, created: false });
});

test("appendMessageIdempotent：附件按 attachmentId 去重", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const attachment = { attachmentId: "att-dedup", name: "a.xlsx", createdAt: new Date().toISOString() };
  const base = {
    sessionId: session.sessionId,
    attachments: [attachment, { ...attachment }],
    message: { messageId: "proj-att", role: "assistant" as const, content: "带附件", createdAt: new Date().toISOString() },
  };
  await repo!.appendMessageIdempotent({ ...base, source: { deduplicationKey: "k-att-1", runId: "r", eventType: "e" } });
  await repo!.appendMessageIdempotent({
    ...base,
    message: { ...base.message, messageId: "proj-att-2" },
    source: { deduplicationKey: "k-att-2", runId: "r", eventType: "e" },
  });
  const after = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  assert.equal(after!.attachments.length, 1, "同 attachmentId 只保留一份");
  assert.equal(after!.messages.length, 2);
});

test("appendMessageIdempotent：并发重放同一来源键恰好一条 created", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const source = { deduplicationKey: "race-key-1", runId: "run-race", eventType: "assistant_message" };
  const message = { messageId: "proj-race", role: "assistant" as const, content: "竞态投影", createdAt: new Date().toISOString() };
  const results = await Promise.all(
    Array.from({ length: 6 }, () => repo!.appendMessageIdempotent({ sessionId: session.sessionId, message, source })),
  );
  assert.equal(results.filter((r) => r.created).length, 1, "6 路并发重放恰好一条 created");
  assert.ok(results.every((r) => r.found), "全部命中会话");
  const after = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  const matched = after!.messages.filter(
    (m) =>
      (m.metadata as { projectionSource?: { deduplicationKey?: string } } | undefined)?.projectionSource
        ?.deduplicationKey === "race-key-1",
  );
  assert.equal(matched.length, 1, "消息数组中该来源键恰好一条");
});

// ─── 本域缓存策略用例：不加缓存层 → 带外写入立即可见 ──────────

test("缓存语义：无缓存层，带外 SQL 写入读路径立即可见", { skip: !testDatabaseUrl }, async () => {
  const sessionId = trackSession(`wes-t-aisess-fresh-${randomUUID().slice(0, 8)}`);
  const nowIso = new Date().toISOString();
  // 带外（绕过仓储）直接 SQL 插入一行
  await pool!.query(
    `INSERT INTO ai_sessions (session_id, owner_user_id, owner_username, title, domain, workflow_key, business_role, status, summary, messages, attachments, artifacts, pending_actions, linked_records, created_at, updated_at)
     VALUES ($1, 'wes-t-owner-a', 'wes-t-owner-a', '带外插入', 'business_evaluation', 'free_chat', 'pre_sales', 'temporary_chat', '', '[]', '[]', '[]', '[]', '{}', $2, $2)`,
    [sessionId, nowIso],
  );
  const listed = await repo!.listSessionsByOwner("wes-t-owner-a");
  assert.ok(listed.some((session) => session.sessionId === sessionId), "带外插入必须立即可见（无陈旧缓存）");

  // 带外追加一条消息，读路径同样立即可见
  await pool!.query(
    `UPDATE ai_sessions SET messages = messages || $2::jsonb WHERE session_id = $1`,
    [sessionId, JSON.stringify([{ messageId: "oob-1", role: "user", content: "带外消息", createdAt: nowIso }])],
  );
  const found = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId });
  assert.equal(found!.messages.length, 1, "带外 jsonb 追加必须立即可见");

  // 写路径同理：仓储写入经裸 SQL 立即可读
  await repo!.renameSession({ ownerUserId: "wes-t-owner-a", sessionId, title: "仓储改名" });
  const row = await readDbSession(sessionId);
  assert.equal(row.title, "仓储改名");
});

// ─── S2b-1 补测：parsedSummary 持久化 / 8000 截断（usecase 层）/ 旧格式兼容 ──

// ① 附件 parsedSummary 必须经 jsonb 原样持久化（PG 仓储不截断，截断在 usecase 层）

test("appendSessionEvent 持久化附件 parsedSummary 原文", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const nowIso = new Date().toISOString();
  await repo!.appendSessionEvent({
    ownerUserId: "wes-t-owner-a",
    sessionId: session.sessionId,
    attachments: [{
      attachmentId: "att-summary",
      name: "需求.xlsx",
      parsedSummary: "项目：XX\n业务需求：\n1. 重点",
      createdAt: nowIso,
    }],
  });
  const read = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  const attachment = read!.attachments.find((item) => item.attachmentId === "att-summary");
  assert.ok(attachment, "附件必须存在");
  assert.equal(attachment.parsedSummary, "项目：XX\n业务需求：\n1. 重点", "parsedSummary 必须原样持久化（仓储层不截断）");
});

// ② 8000 截断在 usecase 层（PARSED_SUMMARY_MAX_LENGTH）：经 createAiSession +
// appendAiSessionEvent 种入超长 parsedSummary，读回断言带截断标记且长度精确。
// 本用例经 usecase 走与测试同库的选择器装配（构造与读取同源）。

test("8000 截断在 usecase 层：超长 parsedSummary 读回带截断标记", { skip: !testDatabaseUrl }, async () => {
  const user: AuthUser = {
    id: "wes-pg-usecase-owner",
    username: "wes-pg-usecase-owner",
    passwordHash: "",
    role: "user",
    businessRole: "pre_sales",
    status: "active",
    createdAt: "2026-08-27T00:00:00.000Z",
    lastLoginAt: "2026-08-27T00:00:00.000Z",
  };
  const longSummary = "长".repeat(9000);
  const created = await createAiSession(user, { title: "截断测试", workflowKey: "parse_requirement_file" });
  try {
    await appendAiSessionEvent(user, created.sessionId, {
      attachments: [{ name: "big.xlsx", parsedSummary: longSummary }],
    });
    const read = await getAiSession(user, created.sessionId);
    assert.ok(read, "会话必须存在");
    const attachment = read.attachments.find((item) => item.name === "big.xlsx");
    assert.ok(attachment, "附件必须存在");
    assert.ok(attachment.parsedSummary?.endsWith("…[truncated]"), "usecase 层必须加截断标记");
    assert.equal(attachment.parsedSummary!.length, 8000 + "…[truncated]".length, "截断后长度 = 8000 + 标记");
  } finally {
    await deleteAiSession(user, created.sessionId);
  }
});

// ③ 旧格式兼容（原 usecase.test L169 职责迁移）：JSON 时代遗留行缺 parsedSummary
// 字段，经 jsonb 带外写入后读回不炸、字段保持 undefined（无迁移脚本，读取兼容）。

test("旧格式兼容：缺 parsedSummary 字段的附件读取不炸且保持 undefined", { skip: !testDatabaseUrl }, async () => {
  const session = await seedSession({ ownerUserId: "wes-t-owner-a" });
  const nowIso = new Date().toISOString();
  await pool!.query(
    `UPDATE ai_sessions SET attachments = $2::jsonb WHERE session_id = $1`,
    [session.sessionId, JSON.stringify([{ attachmentId: "legacy-att", name: "旧格式.xlsx", createdAt: nowIso }])],
  );
  const read = await repo!.findSession({ ownerUserId: "wes-t-owner-a", sessionId: session.sessionId });
  assert.equal(read!.attachments.length, 1, "旧格式附件必须可读");
  assert.equal(read!.attachments[0].attachmentId, "legacy-att");
  assert.equal("parsedSummary" in read!.attachments[0], false, "缺 parsedSummary 保持 undefined（无迁移脚本，读取兼容）");
});
