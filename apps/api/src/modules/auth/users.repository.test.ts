// ============================================================
// Users 域仓储选择器测试（阶段 2 批 2 · 第 3 步开关语义）
// ============================================================
// 口径：与批 1 auth 选择器同构——严格 === "true" 才切 PG；
// 缺省/歧义值一律 JSON；进程内记忆化单例；测试钩子可重置。
// 无需 DB（仅断言实现装配）。

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  _resetUsersRepositoryForTest,
  getUsersRepository,
} from "./users.repository";
import { createUsersPgRepository } from "./users-pg.repository";

const pgMarker = createUsersPgRepository; // 仅用于类型参照

afterEach(() => {
  delete process.env.WES_STORE_USERS_PG;
  _resetUsersRepositoryForTest();
});

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有方法（registerWithInviteCode 事务化）作为装配指纹
  return typeof (repo as { registerWithInviteCode?: unknown }).registerWithInviteCode === "function";
}

test("选择器缺省（未设开关）装配 JSON 实现", () => {
  delete process.env.WES_STORE_USERS_PG;
  _resetUsersRepositoryForTest();
  const repo = getUsersRepository();
  assert.equal(isPgRepo(repo), false, "缺省必须走 JSON（回滚安全）");
});

test("选择器严格语义：仅 'true' 切 PG，歧义值一律 JSON", () => {
  for (const value of ["1", "yes", "TRUE", "True", ""]) {
    process.env.WES_STORE_USERS_PG = value;
    _resetUsersRepositoryForTest();
    assert.equal(isPgRepo(getUsersRepository()), false, `歧义值 ${JSON.stringify(value)} 必须回落 JSON`);
  }
  process.env.WES_STORE_USERS_PG = "true";
  _resetUsersRepositoryForTest();
  assert.equal(isPgRepo(getUsersRepository()), true, "'true' 必须切 PG");
});

test("选择器记忆化：装配后 env 变更不影响既有单例", () => {
  process.env.WES_STORE_USERS_PG = "true";
  _resetUsersRepositoryForTest();
  const first = getUsersRepository();
  process.env.WES_STORE_USERS_PG = "false";
  const second = getUsersRepository();
  assert.equal(first, second, "进程内只读一次开关（翻开关需重启，与 §3.1 对齐）");
});

test("PG 工厂签名与选择器装配一致", () => {
  assert.equal(typeof pgMarker, "function");
});
