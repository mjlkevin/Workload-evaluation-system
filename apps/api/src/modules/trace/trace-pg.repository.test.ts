// ============================================================
// Traces 域 PG 仓储测试（阶段 2 批 5 · 第 1–3 步）
// ============================================================
// 口径：按批 1–4 确立的五条硬性范式验证 traces 表的 PG 实现——
// 幂等插入（onConflictDoNothing + 重查消歧）、行锁事务 merge 更新、
// DB 时钟、安全错误边界；外加 §4.6 测试套件模板的并发用例
// （8 路并发插入不同 trace / 不同 trace 并发更新 / 同 trace 并发收敛）
// 与本域缓存策略用例（不加缓存层 → 带外写入立即可见）。
// 仅读取 TEST_DATABASE_URL；缺失时跳过（与 ai-sessions-pg 同范式）。
//
// 隔离（批 3 先例，2026-08-21 补强）：CI 中多个测试文件并发共享同一
// 测试库，traces 表并非本文件独占——整表 TRUNCATE + 全表计数断言会被
// 并发套件写入干扰（main CI 32457204 偶发 9!==8 根因）。
// 因此本文件所有行使用 wes-t-trace-* owner 前缀，全部断言按 owner
// 过滤收敛到自身数据集；清理改为条件 DELETE，不再整表 TRUNCATE。
// 「ownerUserId 空串 = 查全量」语义仍覆盖，但改为「自身数据集全部在场」
// 的包含式断言（全表精确计数在共享库下不可判定）。

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

// 数据集隔离前缀：本文件所有行的 owner_user_id 均以此开头
const OWNER_A = "wes-t-trace-a";
const OWNER_B = "wes-t-trace-b";
const OWNER_LIKE = "wes-t-trace-%";

let pool: Pool | null = null;
let repo: TracePgRepository | null = null;

function makeTrace(overrides?: Partial<TraceRecord>): TraceRecord {
  const now = new Date().toISOString();
  return {
    traceId: randomUUID(),
    sourceDomain: "ai_session",
    sourceId: `session-${randomUUID()}`,
    ownerUserId: OWNER_A,
    ownerUsername: "wes-t-alice",
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

async function cleanOwnRows(): Promise<void> {
  if (pool) await pool!.query("DELETE FROM traces WHERE owner_user_id LIKE $1", [OWNER_LIKE]);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createTracePgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 afterEach 可能未跑完）
  await cleanOwnRows();
});

beforeEach(cleanOwnRows);
afterEach(cleanOwnRows);

after(async () => {
  if (pool) await pool!.end();
});

// ─── 基础读写 ────────────────────────────────────────────────

test("insert + findTraceById 全字段往返（含 requestId）", { skip: !testDatabaseUrl }, async () => {
  const record = makeTrace({ requestId: "req-001", userInputSummary: "带关联 ID" });
  const inserted = await repo!.insertTrace(record);
  assert.equal(inserted.traceId, record.traceId);

  const found = await repo!.findTraceById(record.traceId);
  assert.ok(found, "insert 后必须能读回");
  assert.equal(found.requestId, "req-001");
  assert.equal(found.sourceDomain, "ai_session");
  assert.equal(found.sourceId, record.sourceId);
  assert.equal(found.ownerUserId, OWNER_A);
  assert.equal(found.ownerUsername, "wes-t-alice");
  assert.equal(found.userInputSummary, "带关联 ID");
  assert.deepEqual(found.spans, record.spans);
  assert.deepEqual(found.summary, record.summary);
  // createdAt/updatedAt 为 DB 时钟（范式 #4），应为近期时间
  const createdAtMs = new Date(found.createdAt).getTime();
  assert.ok(Math.abs(Date.now() - createdAtMs) < 10_000, "createdAt 应为落库时刻附近（DB 时钟）");
});

test("insert 可选字段缺省时读回不带该 key（与 JSON 形状一致）", { skip: !testDatabaseUrl }, async () => {
  const record = makeTrace();
  delete (record as Partial<TraceRecord>).requestId;
  delete (record as Partial<TraceRecord>).sourceId;
  delete (record as Partial<TraceRecord>).userInputSummary;
  await repo!.insertTrace(record);
  const found = await repo!.findTraceById(record.traceId);
  assert.ok(found);
  assert.ok(!("requestId" in found), "null 可选字段不应出现在记录上");
  assert.ok(!("sourceId" in found));
  assert.ok(!("userInputSummary" in found));
});

test("insert 幂等：同 traceId 重放返回原记录且表内恰好一行（范式 #2）", { skip: !testDatabaseUrl }, async () => {
  const original = makeTrace({ userInputSummary: "原始" });
  await repo!.insertTrace(original);
  const replay = makeTrace({ traceId: original.traceId, userInputSummary: "重放" });
  const result = await repo!.insertTrace(replay);
  assert.equal(result.userInputSummary, "原始", "冲突重放必须返回原记录");
  const { rows } = await pool!.query("SELECT count(*)::int AS n FROM traces WHERE trace_id = $1", [original.traceId]);
  assert.equal(rows[0].n, 1);
});

test("findTraceById 未命中返回 null（缺行 ≠ 失败，范式 #5）", { skip: !testDatabaseUrl }, async () => {
  const found = await repo!.findTraceById("nonexistent-trace-id");
  assert.equal(found, null);
});

// ─── update ─────────────────────────────────────────────────

test("updateTraceRecord 合并 patch、刷新 updatedAt、不动其余字段", { skip: !testDatabaseUrl }, async () => {
  const record = makeTrace();
  await repo!.insertTrace(record);
  const before = await repo!.findTraceById(record.traceId);
  assert.ok(before);

  const newSpan = {
    ...record.spans[0],
    spanId: randomUUID(),
    spanType: "tool_call" as const,
    name: "tool-call-x",
  };
  const updated = await repo!.updateTraceRecord(record.traceId, {
    spans: [...record.spans, newSpan],
    summary: { ...record.summary, spanCount: 2 },
  });
  assert.ok(updated, "存在行的更新必须返回记录");
  assert.equal(updated.spans.length, 2);
  assert.equal(updated.summary.spanCount, 2);
  assert.equal(updated.ownerUsername, "wes-t-alice", "未 patch 字段保持不变");
  assert.ok(new Date(updated.updatedAt).getTime() >= new Date(before.updatedAt).getTime() - 1);

  const missing = await repo!.updateTraceRecord("nonexistent-trace-id", { userInputSummary: "x" });
  assert.equal(missing, null, "不存在行返回 null");
});

test("并发更新同一 trace：最终收敛、行完整无撕裂（范式 #3）", { skip: !testDatabaseUrl }, async () => {
  const record = makeTrace();
  await repo!.insertTrace(record);

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

  const final = await repo!.findTraceById(record.traceId);
  assert.ok(final);
  const matchedWriter = results.some(
    (r) => r!.userInputSummary === final.userInputSummary && r!.summary.spanCount === final.summary.spanCount,
  );
  assert.ok(matchedWriter, "最终态必须是某一次完整写入（无撕裂）");
});

// ─── query ──────────────────────────────────────────────────

test("queryTraces：owner 过滤、空 owner 查全量、分页与 total", { skip: !testDatabaseUrl }, async () => {
  for (let i = 0; i < 3; i += 1) {
    await repo!.insertTrace(makeTrace({ ownerUserId: OWNER_A }));
  }
  for (let i = 0; i < 2; i += 1) {
    await repo!.insertTrace(makeTrace({ ownerUserId: OWNER_B }));
  }

  const mine = await repo!.queryTraces({ ownerUserId: OWNER_A });
  assert.equal(mine.total, 3);
  assert.ok(mine.traces.every((t) => t.ownerUserId === OWNER_A));

  // 空 owner = 查全量（不加 owner 过滤）：共享库下全表精确计数不可判定，
  // 改为「自身数据集 5 行全部在场 + 无 owner 过滤生效」包含式断言
  const all = await repo!.queryTraces({ ownerUserId: "", limit: 100 });
  assert.ok(all.total >= 5, "ownerUserId 空字符串 = admin 查全量");
  const ownIds = new Set(all.traces.filter((t) => t.ownerUserId.startsWith("wes-t-trace-")).map((t) => t.traceId));
  assert.equal(ownIds.size, 5, "自身数据集 5 行必须全部返回");

  const paged = await repo!.queryTraces({ ownerUserId: OWNER_A, limit: 2, offset: 1 });
  assert.equal(paged.traces.length, 2);
  assert.equal(paged.total, 3);
  assert.equal(paged.limit, 2);
  assert.equal(paged.offset, 1);
});

test("queryTraces：sourceDomain/sourceId/traceId 过滤", { skip: !testDatabaseUrl }, async () => {
  const runId1 = `wes-t-run-${randomUUID().slice(0, 8)}`;
  const runId2 = `wes-t-run-${randomUUID().slice(0, 8)}`;
  const hit = makeTrace({ sourceDomain: "harness_run", sourceId: runId1 });
  const miss = makeTrace({ sourceDomain: "ai_session", sourceId: runId2 });
  await repo!.insertTrace(hit);
  await repo!.insertTrace(miss);

  // sourceDomain 为枚举共享值（并发套件也用 harness_run），不带 owner 时
  // 只能断言包含；带唯一 sourceId / traceId 时可精确
  const byDomain = await repo!.queryTraces({ ownerUserId: OWNER_A, sourceDomain: "harness_run" });
  assert.ok(byDomain.traces.some((t) => t.traceId === hit.traceId), "harness_run 结果须含本用例行");

  const bySource = await repo!.queryTraces({ ownerUserId: "", sourceId: runId2 });
  assert.equal(bySource.total, 1);
  assert.equal(bySource.traces[0].traceId, miss.traceId);

  const byId = await repo!.queryTraces({ ownerUserId: "", traceId: hit.traceId });
  assert.equal(byId.total, 1);
});

test("queryTraces：hasError/hasDegradation/spanType 过滤", { skip: !testDatabaseUrl }, async () => {
  const errTrace = makeTrace({ summary: { totalDurationMs: 1, spanCount: 1, totalTokens: 0, hasError: true, hasDegradation: false } });
  const degTrace = makeTrace({ summary: { totalDurationMs: 1, spanCount: 1, totalTokens: 0, hasError: false, hasDegradation: true } });
  const toolTrace = makeTrace();
  toolTrace.spans[0].spanType = "tool_call";
  await repo!.insertTrace(errTrace);
  await repo!.insertTrace(degTrace);
  await repo!.insertTrace(toolTrace);

  // 布尔/spanType 过滤值为并发套件共享语义，按 owner 收敛后精确断言
  const errors = await repo!.queryTraces({ ownerUserId: OWNER_A, hasError: true });
  assert.equal(errors.total, 1);
  assert.equal(errors.traces[0].traceId, errTrace.traceId);

  const degraded = await repo!.queryTraces({ ownerUserId: OWNER_A, hasDegradation: true });
  assert.equal(degraded.total, 1);
  assert.equal(degraded.traces[0].traceId, degTrace.traceId);

  const bySpan = await repo!.queryTraces({ ownerUserId: OWNER_A, spanType: "tool_call" });
  assert.equal(bySpan.total, 1);
  assert.equal(bySpan.traces[0].traceId, toolTrace.traceId);
});

test("queryTraces：fromIso/toIso 时间范围（含端点语义同 JSON）", { skip: !testDatabaseUrl }, async () => {
  const db = repo!.__dbForTest();
  // 直接写入三个不同 createdAt 的行（确定性时间），owner 前缀隔离
  const rangeOwner = `wes-t-trace-range-${randomUUID().slice(0, 8)}`;
  const mk = (id: string, createdAt: Date) =>
    db.insert(traces).values({
      traceId: id,
      requestId: null,
      sourceDomain: "ai_session",
      sourceId: null,
      ownerUserId: rangeOwner,
      ownerUsername: "wes-t-alice",
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

  const ranged = await repo!.queryTraces({
    ownerUserId: rangeOwner,
    fromIso: "2026-08-01T00:00:00.000Z",
    toIso: "2026-08-10T00:00:00.000Z",
  });
  assert.equal(ranged.total, 2, "端点包含（>= / <=，与 JSON filter 一致）");

  const ordered = await repo!.queryTraces({ ownerUserId: rangeOwner });
  assert.deepEqual(
    ordered.traces.map((t) => t.traceId),
    ["trace-t3", "trace-t2", "trace-t1"],
    "最新在前（对齐 JSON unshift 语义）",
  );
});

test("listTracesForOwner 返回该 owner 的 traces", { skip: !testDatabaseUrl }, async () => {
  await repo!.insertTrace(makeTrace({ ownerUserId: OWNER_A }));
  await repo!.insertTrace(makeTrace({ ownerUserId: OWNER_A }));
  await repo!.insertTrace(makeTrace({ ownerUserId: OWNER_B }));
  const list = await repo!.listTracesForOwner(OWNER_A);
  assert.equal(list.length, 2);
  assert.ok(list.every((t) => t.ownerUserId === OWNER_A));
});

// ─── purge（retention） ─────────────────────────────────────

test("purgeOlderThan 只删 cutoff 之前的行并返回删除数", { skip: !testDatabaseUrl }, async () => {
  const db = repo!.__dbForTest();
  const old = new Date("2026-01-01T00:00:00.000Z");
  const fresh = new Date("2026-08-20T00:00:00.000Z");
  for (const [id, at] of [["trace-old-1", old], ["trace-old-2", old], ["trace-fresh", fresh]] as const) {
    await db.insert(traces).values({
      traceId: id,
      requestId: null,
      sourceDomain: "ai_session",
      sourceId: null,
      ownerUserId: OWNER_A,
      ownerUsername: "wes-t-alice",
      userInputSummary: null,
      intentResult: null,
      spans: [],
      summary: { totalDurationMs: 0, spanCount: 0, totalTokens: 0, hasError: false, hasDegradation: false },
      createdAt: at,
      updatedAt: at,
    });
  }
  // purge 按表级 cutoff 删除（含并发套件的陈旧行），删除数只做下界断言；
  // 精确效果按自身数据集核验：old 两行消失、fresh 保留
  const removed = await repo!.purgeOlderThan("2026-06-01T00:00:00.000Z");
  assert.ok(removed >= 2, `至少删掉本用例 2 行旧数据（实际 ${removed}）`);
  assert.equal(await repo!.findTraceById("trace-old-1"), null);
  assert.equal(await repo!.findTraceById("trace-old-2"), null);
  const remaining = await repo!.queryTraces({ ownerUserId: OWNER_A });
  assert.equal(remaining.total, 1);
  assert.equal(remaining.traces[0].traceId, "trace-fresh");

  const again = await repo!.purgeOlderThan("2026-06-01T00:00:00.000Z");
  assert.ok(again >= 0, "重复执行不报错（幂等）");
});

// ─── §4.6 并发模板 ──────────────────────────────────────────

test("并发插入不同 trace（8 路）：全部落库、互不覆盖", { skip: !testDatabaseUrl }, async () => {
  const records = Array.from({ length: 8 }, () => makeTrace());
  await Promise.all(records.map((r) => repo!.insertTrace(r)));
  // 按自身 owner 收敛计数（共享库下全表计数会被并发套件干扰）
  const all = await repo!.queryTraces({ ownerUserId: OWNER_A, limit: 100 });
  assert.equal(all.total, 8, "JSON 整存 RMW 会丢插入；PG 行级写必须全数生效");
  const ids = new Set(all.traces.map((t) => t.traceId));
  for (const r of records) assert.ok(ids.has(r.traceId), `trace ${r.traceId} 不得丢失`);
});

test("并发更新不同 trace（不同字段）：全部生效、无互相覆盖", { skip: !testDatabaseUrl }, async () => {
  const a = makeTrace({ userInputSummary: "a-before" });
  const b = makeTrace({ userInputSummary: "b-before" });
  await repo!.insertTrace(a);
  await repo!.insertTrace(b);

  await Promise.all([
    repo!.updateTraceRecord(a.traceId, { userInputSummary: "a-after" }),
    repo!.updateTraceRecord(b.traceId, { userInputSummary: "b-after" }),
  ]);

  const ra = await repo!.findTraceById(a.traceId);
  const rb = await repo!.findTraceById(b.traceId);
  assert.equal(ra?.userInputSummary, "a-after", "A 的写入不得被 B 覆盖");
  assert.equal(rb?.userInputSummary, "b-after", "B 的写入不得被 A 覆盖");
});

// ─── 缓存语义：不加缓存层，带外写入立即可见 ─────────────────

test("无缓存证明：带外 SQL 直写后 repo 读取立即可见", { skip: !testDatabaseUrl }, async () => {
  const id = `trace-oob-${randomUUID()}`;
  await pool!.query(
    `INSERT INTO traces (trace_id, request_id, source_domain, source_id, owner_user_id, owner_username, user_input_summary, intent_result, spans, summary, created_at, updated_at)
     VALUES ($1, NULL, 'ai_session', NULL, $2, 'wes-t-alice', NULL, NULL, '[]'::jsonb, '{}'::jsonb, now(), now())`,
    [id, OWNER_A],
  );
  const found = await repo!.findTraceById(id);
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
