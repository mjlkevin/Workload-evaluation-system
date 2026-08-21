// ============================================================
// Trace 域选择器与路由测试（阶段 2 批 5 · 第 3 步）
// ============================================================
// 缺省 JSON（回滚安全）；严格 === "true" 切 PG；storePath 参数
// 强制 JSON 文件路径（既有测试契约保留，与开关状态无关）。

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import type { TraceRecord } from "./trace.types";
import {
  _resetTraceRepositoryForTest,
  getTraceRepository,
  insertTraceRecord,
} from "./trace.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

function makeTrace(traceId: string): TraceRecord {
  const now = new Date().toISOString();
  return {
    traceId,
    sourceDomain: "ai_session",
    ownerUserId: "user-a",
    ownerUsername: "alice",
    spans: [],
    summary: { totalDurationMs: 0, spanCount: 0, totalTokens: 0, hasError: false, hasDegradation: false },
    createdAt: now,
    updatedAt: now,
  };
}

after(() => {
  delete process.env.WES_STORE_TRACES_PG;
  _resetTraceRepositoryForTest();
});

test("选择器缺省（未设开关）装配 JSON 实现", () => {
  delete process.env.WES_STORE_TRACES_PG;
  _resetTraceRepositoryForTest();
  const repo = getTraceRepository();
  assert.equal(isPgRepo(repo), false, "缺省必须走 JSON（回滚安全）");
});

test("选择器严格语义：仅 'true' 切 PG，歧义值一律 JSON", () => {
  for (const value of ["1", "yes", "TRUE", "True", ""]) {
    process.env.WES_STORE_TRACES_PG = value;
    _resetTraceRepositoryForTest();
    assert.equal(isPgRepo(getTraceRepository()), false, `歧义值 ${JSON.stringify(value)} 必须回落 JSON`);
  }
  process.env.WES_STORE_TRACES_PG = "true";
  _resetTraceRepositoryForTest();
  assert.equal(isPgRepo(getTraceRepository()), true, "'true' 必须切 PG");
  delete process.env.WES_STORE_TRACES_PG;
  _resetTraceRepositoryForTest();
});

test("选择器记忆化：装配后 env 变更不影响既有单例", () => {
  process.env.WES_STORE_TRACES_PG = "true";
  _resetTraceRepositoryForTest();
  const first = getTraceRepository();
  process.env.WES_STORE_TRACES_PG = "false";
  const second = getTraceRepository();
  assert.equal(first, second, "进程内只读一次开关（翻开关需重启，与 §3.1 对齐）");
  delete process.env.WES_STORE_TRACES_PG;
  _resetTraceRepositoryForTest();
});

test("storePath 参数强制 JSON 文件路径（开关 'true' 也不改道）", async () => {
  if (!testDatabaseUrl) return; // 无 DB 环境时开关路径无从对照，跳过
  process.env.WES_STORE_TRACES_PG = "true";
  _resetTraceRepositoryForTest();

  const dir = mkdtempSync(join(tmpdir(), "wes-trace-json-"));
  const storePath = join(dir, "trace-store.json");
  const traceId = `trace-forced-json-${randomUUID()}`;
  try {
    await insertTraceRecord(makeTrace(traceId), storePath);
    assert.ok(existsSync(storePath), "给定 storePath 必须写 JSON 文件");
    const parsed = JSON.parse(readFileSync(storePath, "utf-8"));
    assert.equal(parsed.traces.length, 1);
    assert.equal(parsed.traces[0].traceId, traceId);

    // PG 侧不得出现该行（证明未改道 PG）
    const pool = new Pool({ connectionString: testDatabaseUrl });
    try {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM traces WHERE trace_id = $1", [traceId]);
      assert.equal(rows[0].n, 0, "storePath 强制 JSON：PG 不得有该行");
    } finally {
      await pool.end();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.WES_STORE_TRACES_PG;
    _resetTraceRepositoryForTest();
  }
});

test("开关 'true' 且无 storePath：写入经 PG，JSON 文件不落盘", async () => {
  if (!testDatabaseUrl) return;
  process.env.WES_STORE_TRACES_PG = "true";
  process.env.WES_TRACE_STORE_PATH = join(mkdtempSync(join(tmpdir(), "wes-trace-switch-")), "trace-store.json");
  _resetTraceRepositoryForTest();

  const traceId = `trace-pg-route-${randomUUID()}`;
  try {
    await insertTraceRecord(makeTrace(traceId));
    assert.ok(!existsSync(process.env.WES_TRACE_STORE_PATH), "PG 路由下 JSON 文件不得被创建");

    const pool = new Pool({ connectionString: testDatabaseUrl });
    try {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM traces WHERE trace_id = $1", [traceId]);
      assert.equal(rows[0].n, 1, "开关 'true' 必须落 PG");
      await pool.query("DELETE FROM traces WHERE trace_id = $1", [traceId]);
    } finally {
      await pool.end();
    }
  } finally {
    delete process.env.WES_TRACE_STORE_PATH;
    delete process.env.WES_STORE_TRACES_PG;
    _resetTraceRepositoryForTest();
  }
});
