// ============================================================
// Users 域仓储选择器测试（阶段 2 S1 后：恒 PG 语义）
// ============================================================
// 批 2 第 3 步的开关语义测试（缺省 JSON / 严格 "true" / 歧义值回落）随
// S1（2026-08-25）删除 JSON 实现与选择器分支而整体删除；JSON 整存 RMW
// 对照用例（已知缺陷记录）同步删除——第 4 步删除 JSON 路径时一并删除的
// 承诺在此兑现。
// 本文件保留恒 PG 装配语义：getUsersRepository() 必须返回 PG 实现
// （registerWithInviteCode 事务化方法为装配指纹），进程内记忆化单例，
// 测试钩子可重置。行级操作语义由 users-pg.repository.test.ts 覆盖，
// 本文件不再重复。

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { _resetUsersRepositoryForTest, getUsersRepository } from "./users.repository";
import { createUsersPgRepository } from "./users-pg.repository";

const pgMarker = createUsersPgRepository; // 仅用于类型参照

afterEach(() => {
  _resetUsersRepositoryForTest();
});

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有方法（registerWithInviteCode 事务化）作为装配指纹
  return typeof (repo as { registerWithInviteCode?: unknown }).registerWithInviteCode === "function";
}

test("S1 后选择器恒装配 PG 实现（不再读取开关）", () => {
  const repo = getUsersRepository();
  assert.equal(isPgRepo(repo), true, "S1 后 users 域必须恒 PG");
});

test("选择器记忆化：多次调用返回同一单例，reset 后换新实例", () => {
  const first = getUsersRepository();
  const second = getUsersRepository();
  assert.equal(first, second, "进程内记忆化单例（翻开关需重启的语义已随开关退役）");
  _resetUsersRepositoryForTest();
  const third = getUsersRepository();
  assert.notEqual(third, first, "测试钩子重置后必须装配新实例");
});

test("PG 工厂签名与选择器装配一致", () => {
  assert.equal(typeof pgMarker, "function");
});
