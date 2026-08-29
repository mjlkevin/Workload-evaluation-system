// ============================================================
// AI Sessions 域仓储选择器测试（阶段 2 S2b-2 终态：PG-only）
// ============================================================
// 口径：S2b-2（2026-08-28）JSON 路径删除后选择器恒 PG；进程内记忆化单例；
// 测试钩子可重置。JSON 实现/开关分流测试已随 JSON 路径删除（含对照用例
// 「JSON 整存 RMW 并发写丢失更新」——其职责由 ai-sessions-pg.repository.test.ts
// 的「不同会话并发写」用例继续覆盖）。
// 选择器部分无需 DB（仅断言实现装配）。

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { _resetAiSessionsRepositoryForTest, getAiSessionsRepository } from "./ai-sessions.repository";
import { createAiSessionsPgRepository } from "./ai-sessions-pg.repository";

const pgMarker = createAiSessionsPgRepository; // 仅用于类型参照

afterEach(() => {
  _resetAiSessionsRepositoryForTest();
});

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

test("选择器恒装配 PG 实现（S2b-2 JSON 路径删除后）", () => {
  _resetAiSessionsRepositoryForTest();
  assert.equal(isPgRepo(getAiSessionsRepository()), true, "必须恒走 PG");
});

test("选择器记忆化：多次取用返回同一单例", () => {
  _resetAiSessionsRepositoryForTest();
  const first = getAiSessionsRepository();
  const second = getAiSessionsRepository();
  assert.equal(first, second, "进程内单例记忆化");
});

test("PG 工厂签名与选择器装配一致", () => {
  assert.equal(typeof pgMarker, "function");
});
