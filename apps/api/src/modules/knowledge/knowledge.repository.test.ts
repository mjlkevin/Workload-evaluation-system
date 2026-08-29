// ============================================================
// Knowledge 域仓储选择器测试（阶段 2 S6 终态：PG-only）
// ============================================================
// 口径：S6（2026-08-29）JSON 仓储类（KnowledgeRepository）删除后，
// knowledge.module 的选择器恒装配 PG 实现；进程内记忆化单例；测试钩子可重置。
//
// 原 8 条 JSON CRUD 用例（空表 list / 全字段落盘读回 / 缺 title-content 拒绝 /
// 重复 id 拒绝 / update 补丁 / 缺行抛错 / 归档守卫 / 存量默认值补齐）的职责
// 已由 knowledge-pg.repository.test.ts 的 14 条逐字对照用例覆盖（用例名即
// 「与 JSON 实现一致」「消息与 JSON 逐字一致」），故按 S2b-2 标杆
// （ai-sessions.repository.test.ts 终态）收缩为 3 条装配测试——六套件净 −5。
// 检索编排与路由契约用例改用 in-memory 替身（test-helpers/
// knowledge-in-memory.repository.ts），不依赖被删的 JSON 实现。
//
// 装配部分无需 DB（仅断实现装配与单例语义），无库环境同样真实执行。

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { KnowledgePgRepository } from "./knowledge-pg.repository";
import { _resetKnowledgeRepositoryForTest, getKnowledgeRepository } from "./knowledge.module";

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

afterEach(() => {
  _resetKnowledgeRepositoryForTest();
});

test("选择器恒装配 PG 实现（S6 JSON 路径删除后）", () => {
  _resetKnowledgeRepositoryForTest();
  assert.equal(isPgRepo(getKnowledgeRepository()), true, "必须恒走 PG");
});

test("选择器记忆化：多次取用返回同一单例", () => {
  _resetKnowledgeRepositoryForTest();
  const first = getKnowledgeRepository();
  const second = getKnowledgeRepository();
  assert.equal(first, second, "进程内单例记忆化");
});

test("PG 实现类签名与选择器装配一致", () => {
  assert.equal(typeof KnowledgePgRepository, "function");
});
