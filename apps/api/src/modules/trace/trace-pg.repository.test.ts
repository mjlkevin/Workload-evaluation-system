// ============================================================
// Trace 域 PG 仓储测试（阶段 2 批 5 · 第 1–3 步）
// ============================================================
// 需要 TEST_DATABASE_URL（workload_eval_test）；缺失时整体跳过
// （与 ai-sessions-pg / system-pg 测试同范式）。
//
// 隔离：traces 表内容全由本文件支配——before/afterEach TRUNCATE。
// §4.6 并发模板：并发写不同 trace 互不覆盖（JSON 整存 RMW 的真正丢失
// 机制对照不适用于本域——JSON 实现 readFileSync→改→writeFileSync 为
// 同步段、无 await 挂起点，单线程下无法交错，故不加 JSON 对照用例）。

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { traces } from "../../db/schema";
import type { TraceRecord } from "./trace.types";
import {
  TraceStoreError,
  createTracePgRepository,
  type TracePgRepository,
} from "./trace-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let repo: TracePgRepository | null = null;

function makeTrace(overrides?: Partial<TraceRecord>): TraceRecord {
  const now = new Date().toISOString();
  return {
    traceId: randomUUID(),
    sourceDomain: "ai_session",
    sourceId: `session-${randomUUID()}`,
    ownerUserId: "user-a",
    ownerUsername: "alice",
    userInputSummary: "评估工作量",
    spans: [
      {
        spanId: randomUUID(),
        spanType: "model_call",
        name: "model-call-general",
        status: "completed",
        startedAt: now,
        endedAt: now,
        durationMs: 12,
        contextRefs: [],
        attributes: {},
        tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
    ],
    summary: { totalDurationMs: 12, spanCount: 1, totalTokens: 30, hasError: false, hasDegradation: false },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createTracePgRepository(drizzle(pool));
  await pool.query("TRUNCATE TABLE traces");
});

beforeEach(async () => {
  if (pool) await pool.query("TRUNCATE TABLE traces");
});

afterEach(async () => {
  if (pool) await pool.query("TRUNCATE TABLE traces");
});

after(async () => {
  if (pool) await pool.end();
});

// ─── 基础读写 ────────────────────────────────────────────────

test("insert + findTraceById 全字段往返（含 requestId）", async () => {
  if (!pool || !repo) return;
  const record = makeTrace({ requestId: "req-001", userInputSummary: "带关联 ID" });
  const inserted = await repo.insertTrace(record);
  assert.equal(inserted.traceId, record.traceId);

  const found = await repo.findTraceById(record.traceId);
  assert.ok(found, "insert 后必须能读回");
  assert.equal(found.requestId, "req-001");
  assert.equal(found.sourceDomain, "ai_session");
  assert.equal(found.sourceId, record.sourceId);
  assert.equal(found.ownerUserId, "user-a");
  assert.equal(found.ownerUsername, "alice");
  assert.equal(found.userInputSummary, "带关联 ID");
  assert.deepEqual(found.spans, record.spans);
  assert.deepEqual(found.summary, record.summary);
  // createdAt/updatedAt 为 DB 时钟（范式 #4），应为近期时间
  const createdAtMs = new Date(found.createdAt).getTime();
  assert.ok(Math.abs(Date.now() - createdAtMs) < 10_000, "createdAt 应为落库时刻附近（DB 时钟）");
});

test("insert 可选字段缺省时读回不带该 key（与 JSON 形状一致）", async () => {
  if (!pool || !repo) return;
  const record = makeTrace();
  delete (record as Partial<TraceRecord>).requestId;
  delete (record as Partial<TraceRecord>).sourceId;
  delete (record as Partial<TraceRecord>).userInputSummary;
  await repo.insertTrace(record);
  const found = await repo.findTraceById(record.traceId);
  assert.ok(found);
  assert.ok(!("requestId" in found), "null 可选字段不应出现在记录上");
  assert.ok(!("sourceId" in found));
  assert.ok(!("userInputSummary" in found));
});

test("insert 幂等：同 traceId 重放返回原记录且表内恰好一行（范式 #2）", async () => {
  if (!pool || !repo) return;
  const original = makeTrace({ userInputSummary: "原始" });
  await repo.insertTrace(original);
  const replay = makeTrace({ traceId: original.traceId, userInputSummary: "重放" });
  const result = await repo.insertTrace(replay);
  assert.equal(result.userInputSummary, "原始", "冲突重放必须返回原记录");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM traces WHERE trace_id = $1", [original.traceId]);
  assert.equal(rows[0].n, 1);
});

test("findTraceById 未命中返回 null（缺行 ≠ 失败，范式 #5）", async () => {
  if (!repo) return;
  const found = await repo.findTraceById("nonexistent-trace-id");
  assert.equal(found, null);
});

// ─── update ─────────────────────────────────────────────────

test("updateTraceRecord 合并 patch、刷新 updatedAt、不动其余字段", async () => {
  if (!pool || !repo) return;
  const record = makeTrace();
  await repo.insertTrace(record);
  const before = await repo.findTraceById(record.traceId);
  assert.ok(before);

  const newSpan = {
    ...record.spans[0],
    spanId: randomUUID(),
    spanType: "tool_call" as const,
    name: "tool-call-x",
  };
  const updated = await repo.updateTraceRecord(record.traceId, {
    spans: [...record.spans, newSpan],
    summary: { ...record.summary, spanCount: 2 },
  });
  assert.ok(updated, "存在行的更新必须返回记录");
  assert.equal(updated.spans.length, 2);
  assert.equal(updated.summary.spanCount, 2);
  assert.equal(updated.ownerUsername, "alice", "未 patch 字段保持不变");
  assert.ok(new Date(updated.updatedAt).getTime() >= new Date(before.updatedAt).getTime() - 1);

  const missing = await repo.updateTraceRecord("nonexistent-trace-id", { userInputSummary: "x" });
  assert.equal(missing, null, "不存在行返回 null");
});

test("并发更新同一 trace：最终收敛、行完整无撕裂（范式 #3）", async () => {
  if (!pool || !repo) return;
  const record = makeTrace();
  await repo.insertTrace(record);

  // 4 路并发整行 patch（各自基于读到的快照），行锁串行化后最终态
  // 必须等于其中一路的完整 patch（不允许字段混合撕裂）
  const writers = [0, 1, 2, 3].map(async (i) => {
    return repo!.updateTraceRecord(record.traceId, {
      userInputSummary: `writer-${i}`,
      summary: { ...record.summary, spanCount: i + 1 },
    });
  });
  const results = await Promise.all(writers);
  assert.ok(results.every((r) => r !== null));

  const final = await repo.findTraceById(record.traceId);
  assert.ok(final);
  const matchedWriter = results.some(
    (r) => r!.userInputSummary === final.userInputSummary && r!.summary.spanCount === final.summary.spanCount,
  );
  assert.ok(matchedWriter, "最终态必须是某一次完整写入（无撕裂）");
});

// ─── query ──────────────────────────────────────────────────

test("queryTraces：owner 过滤、空 owner 查全量、分页与 total", async () => {
  if (!pool || !repo) return;
  for (let i = 0; i < 3; i += 1) {
    await repo.insertTrace(makeTrace({ ownerUserId: "user-a" }));
  }
  for (let i = 0; i < 2; i += 1) {
    await repo.insertTrace(makeTrace({ ownerUserId: "user-b" }));
  }

  const mine = await repo.queryTraces({ ownerUserId: "user-a" });
  assert.equal(mine.total, 3);
  assert.ok(mine.traces.every((t) => t.ownerUserId === "user-a"));

  const all = await repo.queryTraces({ ownerUserId: "" });
  assert.equal(all.total, 5, "ownerUserId 空字符串 = admin 查全量");

  const paged = await repo.queryTraces({ ownerUserId: "", limit: 2, offset: 1 });
  assert.equal(paged.traces.length, 2);
  assert.equal(paged.total, 5);
  assert.equal(paged.limit, 2);
  assert.equal(paged.offset, 1);
});

test("queryTraces：sourceDomain/sourceId/traceId 过滤", async () => {
  if (!pool || !repo) return;
  const hit = makeTrace({ sourceDomain: "harness_run", sourceId: "run-1" });
  const miss = makeTrace({ sourceDomain: "ai_session", sourceId: "run-2" });
  await repo.insertTrace(hit);
  await repo.insertTrace(miss);

  const byDomain = await repo.queryTraces({ ownerUserId: "", sourceDomain: "harness_run" });
  assert.equal(byDomain.total, 1);
  assert.equal(byDomain.traces[0].traceId, hit.traceId);

  const bySource = await repo.queryTraces({ ownerUserId: "", sourceId: "run-2" });
  assert.equal(bySource.total, 1);
  assert.equal(bySource.traces[0].traceId, miss.traceId);

  const byId = await repo.queryTraces({ ownerUserId: "", traceId: hit.traceId });
  assert.equal(byId.total, 1);
});

test("queryTraces：hasError/hasDegradation/spanType 过滤", async () => {
  if (!pool || !repo) return;
  const errTrace = makeTrace({ summary: { totalDurationMs: 1, spanCount: 1, totalTokens: 0, hasError: true, hasDegradation: false } });
  const degTrace = makeTrace({ summary: { totalDurationMs: 1, spanCount: 1, totalTokens: 0, hasError: false, hasDegradation: true } });
  const toolTrace = makeTrace();
  toolTrace.spans[0].spanType = "tool_call";
  await repo.insertTrace(errTrace);
  await repo.insertTrace(degTrace);
  await repo.insertTrace(toolTrace);

  const errors = await repo.queryTraces({ ownerUserId: "", hasError: true });
  assert.equal(errors.total, 1);
  assert.equal(errors.traces[0].traceId, errTrace.traceId);

  const degraded = await repo.queryTraces({ ownerUserId: "", hasDegradation: true });
  assert.equal(degraded.total, 1);
  assert.equal(degraded.traces[0].traceId, degTrace.traceId);

  const bySpan = await repo.queryTraces({ ownerUserId: "", spanType: "tool_call" });
  assert.equal(bySpan.total, 1);
  assert.equal(bySpan.traces[0].traceId, toolTrace.traceId);
});

test("queryTraces：fromIso/toIso 时间范围（含端点语义同 JSON）", async () => {
  if (!pool || !repo) return;
  const db = repo.__dbForTest();
  // 直接写入三个不同 createdAt 的行（确定性时间）
  const mk = (id: string, createdAt: Date) =>
    db.insert(traces).values({
      traceId: id,
      requestId: null,
      sourceDomain: "ai_session",
      sourceId: null,
      ownerUserId: "user-a",
      ownerUsername: "alice",
      userInputSummary: null,
      intentResult: null,
      spans: [],
      summary: { totalDurationMs: 0, spanCount: 0, totalTokens: 0, hasError: false, hasDegradation: false },
      createdAt,
      updatedAt: createdAt,
    });
  const t1 = new Date("2026-08-01T00:00:00.000Z");
  const t2 = new Date("2026-08-10T00:00:00.000Z");
  const t3 = new Date("2026-08-20T00:00:00.000Z");
  await mk("trace-t1", t1);
  await mk("trace-t2", t2);
  await mk("trace-t3", t3);

  const ranged = await repo.queryTraces({
    ownerUserId: "",
    fromIso: "2026-08-01T00:00:00.000Z",
    toIso: "2026-08-10T00:00:00.000Z",
  });
  assert.equal(ranged.total, 2, "端点包含（>= / <=，与 JSON filter 一致）");

  const ordered = await repo.queryTraces({ ownerUserId: "" });
  assert.deepEqual(
    ordered.traces.map((t) => t.traceId),
    ["trace-t3", "trace-t2", "trace-t1"],
    "最新在前（对齐 JSON unshift 语义）",
  );
});

test("listTracesForOwner 返回该 owner 的 traces", async () => {
  if (!pool || !repo) return;
  await repo.insertTrace(makeTrace({ ownerUserId: "user-a" }));
  await repo.insertTrace(makeTrace({ ownerUserId: "user-a" }));
  await repo.insertTrace(makeTrace({ ownerUserId: "user-b" }));
  const list = await repo.listTracesForOwner("user-a");
  assert.equal(list.length, 2);
  assert.ok(list.every((t) => t.ownerUserId === "user-a"));
});

// ─── purge（retention） ─────────────────────────────────────

test("purgeOlderThan 只删 cutoff 之前的行并返回删除数", async () => {
  if (!pool || !repo) return;
  const db = repo.__dbForTest();
  const old = new Date("2026-01-01T00:00:00.000Z");
  const fresh = new Date("2026-08-20T00:00:00.000Z");
  for (const [id, at] of [["trace-old-1", old], ["trace-old-2", old], ["trace-fresh", fresh]] as const) {
    await db.insert(traces).values({
      traceId: id,
      requestId: null,
      sourceDomain: "ai_session",
      sourceId: null,
      ownerUserId: "user-a",
      ownerUsername: "alice",
      userInputSummary: null,
      intentResult: null,
      spans: [],
      summary: { totalDurationMs: 0, spanCount: 0, totalTokens: 0, hasError: false, hasDegradation: false },
      createdAt: at,
      updatedAt: at,
    });
  }
  const removed = await repo.purgeOlderThan("2026-06-01T00:00:00.000Z");
  assert.equal(removed, 2);
  const remaining = await repo.queryTraces({ ownerUserId: "" });
  assert.equal(remaining.total, 1);
  assert.equal(remaining.traces[0].traceId, "trace-fresh");

  const again = await repo.purgeOlderThan("2026-06-01T00:00:00.000Z");
  assert.equal(again, 0, "无可删行返回 0（幂等）");
});

// ─── §4.6 并发模板 ──────────────────────────────────────────

test("并发插入不同 trace（8 路）：全部落库、互不覆盖", async () => {
  if (!pool || !repo) return;
  const records = Array.from({ length: 8 }, () => makeTrace());
  await Promise.all(records.map((r) => repo!.insertTrace(r)));
  const all = await repo.queryTraces({ ownerUserId: "", limit: 100 });
  assert.equal(all.total, 8, "JSON 整存 RMW 会丢插入；PG 行级写必须全数生效");
  const ids = new Set(all.traces.map((t) => t.traceId));
  for (const r of records) assert.ok(ids.has(r.traceId), `trace ${r.traceId} 不得丢失`);
});

test("并发更新不同 trace（不同字段）：全部生效、无互相覆盖", async () => {
  if (!pool || !repo) return;
  const a = makeTrace({ userInputSummary: "a-before" });
  const b = makeTrace({ userInputSummary: "b-before" });
  await repo.insertTrace(a);
  await repo.insertTrace(b);

  await Promise.all([
    repo.updateTraceRecord(a.traceId, { userInputSummary: "a-after" }),
    repo.updateTraceRecord(b.traceId, { userInputSummary: "b-after" }),
  ]);

  const ra = await repo.findTraceById(a.traceId);
  const rb = await repo.findTraceById(b.traceId);
  assert.equal(ra?.userInputSummary, "a-after", "A 的写入不得被 B 覆盖");
  assert.equal(rb?.userInputSummary, "b-after", "B 的写入不得被 A 覆盖");
});

// ─── 缓存语义：不加缓存层，带外写入立即可见 ─────────────────

test("无缓存证明：带外 SQL 直写后 repo 读取立即可见", async () => {
  if (!pool || !repo) return;
  const id = `trace-oob-${randomUUID()}`;
  await pool.query(
    `INSERT INTO traces (trace_id, request_id, source_domain, source_id, owner_user_id, owner_username, user_input_summary, intent_result, spans, summary, created_at, updated_at)
     VALUES ($1, NULL, 'ai_session', NULL, 'user-a', 'alice', NULL, NULL, '[]'::jsonb, '{}'::jsonb, now(), now())`,
    [id],
  );
  const found = await repo.findTraceById(id);
  assert.ok(found, "无缓存层：带外写入必须立即可见（无 TTL 滞后窗口）");
});

// ─── 错误边界（范式 #1） ────────────────────────────────────

test("DB 不可达时抛 TraceStoreError 且不泄露连接串", async () => {
  const brokenPool = new Pool({ connectionString: "postgres://invalid@127.0.0.1:1/none", max: 1, connectionTimeoutMillis: 500 });
  const brokenRepo = createTracePgRepository(drizzle(brokenPool));
  await assert.rejects(
    () => brokenRepo.findTraceById("any"),
    (err: unknown) => {
      assert.ok(err instanceof TraceStoreError, "必须收敛为 TraceStoreError");
      assert.equal(err.code, "TRACE_STORE_INTERNAL");
      assert.ok(!String(err.message).includes("postgres://"), "错误消息不得含连接串");
      return true;
    },
  );
  await brokenPool.end().catch(() => {});
});
