// ============================================================
// AI Sessions 域仓储选择器测试（阶段 2 批 3 · 第 3 步开关语义）
// ============================================================
// 口径：与批 1/批 2 选择器同构——严格 === "true" 才切 PG；
// 缺省/歧义值一律 JSON；进程内记忆化单例；测试钩子可重置。
// 另含 JSON 整存 RMW 对照用例（并发写不同会话丢失更新，§4.6 模板可选件）。
// 选择器部分无需 DB（仅断言实现装配）。

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import type { AiSessionRecord } from "./ai-sessions.types";
import {
  _resetAiSessionsRepositoryForTest,
  appendAiSessionMessageIdempotent,
  createAiSessionsJsonRepository,
  getAiSessionsRepository,
} from "./ai-sessions.repository";
import { createAiSessionsPgRepository } from "./ai-sessions-pg.repository";

const pgMarker = createAiSessionsPgRepository; // 仅用于类型参照

afterEach(() => {
  delete process.env.WES_STORE_AI_SESSIONS_PG;
  _resetAiSessionsRepositoryForTest();
});

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

test("选择器缺省（未设开关）装配 JSON 实现", () => {
  delete process.env.WES_STORE_AI_SESSIONS_PG;
  _resetAiSessionsRepositoryForTest();
  const repo = getAiSessionsRepository();
  assert.equal(isPgRepo(repo), false, "缺省必须走 JSON（回滚安全）");
});

test("选择器严格语义：仅 'true' 切 PG，歧义值一律 JSON", () => {
  for (const value of ["1", "yes", "TRUE", "True", ""]) {
    process.env.WES_STORE_AI_SESSIONS_PG = value;
    _resetAiSessionsRepositoryForTest();
    assert.equal(isPgRepo(getAiSessionsRepository()), false, `歧义值 ${JSON.stringify(value)} 必须回落 JSON`);
  }
  process.env.WES_STORE_AI_SESSIONS_PG = "true";
  _resetAiSessionsRepositoryForTest();
  assert.equal(isPgRepo(getAiSessionsRepository()), true, "'true' 必须切 PG");
});

test("选择器记忆化：装配后 env 变更不影响既有单例", () => {
  process.env.WES_STORE_AI_SESSIONS_PG = "true";
  _resetAiSessionsRepositoryForTest();
  const first = getAiSessionsRepository();
  process.env.WES_STORE_AI_SESSIONS_PG = "false";
  const second = getAiSessionsRepository();
  assert.equal(first, second, "进程内只读一次开关（翻开关需重启，与 §3.1 对齐）");
});

test("PG 工厂签名与选择器装配一致", () => {
  assert.equal(typeof pgMarker, "function");
  assert.equal(typeof createAiSessionsJsonRepository, "function");
});

// ─── JSON 整存 RMW 已知缺陷记录（并发写不同会话丢失更新） ─────────
// 对照 ai-sessions-pg.repository.test.ts 的「不同会话并发写」用例：整存
// load→改→save 下，后写者把前写者的改动整个覆盖。async accessor 的 await
// 挂起点使两个 RMW 必然交错（A/B 先各自 load 全量，再先后 save 整个文件），
// 探针实测 5/5 复现。本用例把缺陷形态钉死为红线回归：若未来 JSON 路径被
// 改造为行级写，断言会反转失败，提醒同步更新本记录与 §5.1 遗留模式标注。
// 第 4 步删除 JSON 路径时本用例随实现一并删除。
//
// 隔离：经 storePath 指向 os.tmpdir() 内的独立沙箱文件，与真实
// data/ai-sessions.json 完全隔离（无需 chdir——本域 accessor 原生支持
// storePath 注入，这是与 users 域对照用例的差异点）。

test("对照：JSON 整存 RMW 并发写不同会话必现丢失更新（已知缺陷记录）", async () => {
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "wes-ai-sessions-rmw-"));
  const filePath = path.join(sandboxDir, "ai-sessions.json");
  const nowIso = new Date("2026-08-19T00:00:00.000Z").toISOString();
  const seedSession = (sessionId: string): AiSessionRecord => ({
    sessionId,
    ownerUserId: `owner-${sessionId}`,
    ownerUsername: `owner-${sessionId}`,
    title: "种子会话",
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
  });

  try {
    let lostRounds = 0;
    const ROUNDS = 5;
    for (let i = 0; i < ROUNDS; i++) {
      writeFileSync(filePath, JSON.stringify({ sessions: [seedSession("rmw-a"), seedSession("rmw-b")] }, null, 2));
      const sourceA = { deduplicationKey: `key-a-${i}`, runId: "run-a", eventType: "assistant_message" };
      const sourceB = { deduplicationKey: `key-b-${i}`, runId: "run-b", eventType: "assistant_message" };
      await Promise.all([
        appendAiSessionMessageIdempotent({
          sessionId: "rmw-a",
          message: { messageId: `msg-a-${i}`, role: "assistant", content: "A 的消息", createdAt: nowIso },
          source: sourceA,
          storePath: filePath,
        }),
        appendAiSessionMessageIdempotent({
          sessionId: "rmw-b",
          message: { messageId: `msg-b-${i}`, role: "assistant", content: "B 的消息", createdAt: nowIso },
          source: sourceB,
          storePath: filePath,
        }),
      ]);
      const after = JSON.parse(readFileSync(filePath, "utf8")) as { sessions: Array<{ sessionId: string; messages: unknown[] }> };
      const a = after.sessions.find((s) => s.sessionId === "rmw-a")!;
      const b = after.sessions.find((s) => s.sessionId === "rmw-b")!;
      if (a.messages.length !== 1 || b.messages.length !== 1) lostRounds++;
    }
    assert.ok(lostRounds > 0, "整存 RMW 丢失更新应可复现；若未复现，说明 JSON 写路径已被改造，须同步更新本记录");
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
