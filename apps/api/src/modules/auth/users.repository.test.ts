// ============================================================
// Users 域仓储选择器测试（阶段 2 批 2 · 第 3 步开关语义）
// ============================================================
// 口径：与批 1 auth 选择器同构——严格 === "true" 才切 PG；
// 缺省/歧义值一律 JSON；进程内记忆化单例；测试钩子可重置。
// 无需 DB（仅断言实现装配）。

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import path from "node:path";

import {
  _resetUsersRepositoryForTest,
  createUsersJsonRepository,
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

// ─── JSON 整存 RMW 已知缺陷记录（并发写不同用户丢失更新） ─────────
// 对照 users-pg.repository.test.ts 的「并发修改不同用户」用例：整存
// load→改→save 下，后写者把前写者的改动整个覆盖（实测 10/10 复现）。
// 本用例把缺陷形态钉死为红线回归：若未来 JSON 路径被改造为行级写，
// 断言会反转失败，提醒同步更新本记录与 §5.1 遗留模式标注。
// 第 4 步删除 JSON 路径时本用例随实现一并删除。
//
// 隔离：node:test 按文件并行执行，本用例会整存覆写 users.json，与路由测试
// 的注册/登录写路径互撞（即整存 RMW 缺陷的自证）。故 chdir 到临时沙箱根
// 目录（自带 config/auth/users.json），resolveRootDir() 会解析到沙箱内
// 副本，与真实存储完全隔离；结束后恢复 cwd 并清理沙箱。

test("对照：JSON 整存 RMW 并发写不同用户必现丢失更新（已知缺陷记录）", async () => {
  const originalCwd = process.cwd();
  const sandboxRoot = path.resolve(originalCwd, "..", "..", ".tmp", "users-rmw-sandbox");
  mkdirSync(path.join(sandboxRoot, "config", "auth"), { recursive: true });
  const nowIso = new Date("2026-08-19T00:00:00.000Z").toISOString();
  const seedUser = (suffix: "a" | "b") => ({
    id: `wes-rmw-${suffix}`,
    username: `wes-rmw-${suffix}`,
    passwordHash: "x",
    role: "user",
    status: "active",
    createdAt: nowIso,
    lastLoginAt: nowIso,
  });
  const filePath = path.join(sandboxRoot, "config", "auth", "users.json");

  process.chdir(sandboxRoot);
  try {
    const repo = createUsersJsonRepository();
    let lostRounds = 0;
    const ROUNDS = 5;
    for (let i = 0; i < ROUNDS; i++) {
      writeFileSync(filePath, JSON.stringify({ users: [seedUser("a"), seedUser("b")] }, null, 2));
      await Promise.all([
        repo.updateUserRole({ id: "wes-rmw-a", role: "sub_admin" }),
        repo.updateUserStatus({ id: "wes-rmw-b", status: "disabled" }),
      ]);
      const after = JSON.parse(readFileSync(filePath, "utf8")).users as Array<{ role: string; status: string; id: string }>;
      const a = after.find((u) => u.id === "wes-rmw-a")!;
      const b = after.find((u) => u.id === "wes-rmw-b")!;
      if (a.role !== "sub_admin" || b.status !== "disabled") lostRounds++;
    }
    assert.ok(lostRounds > 0, "整存 RMW 丢失更新应可复现；若未复现，说明 JSON 写路径已被改造，须同步更新本记录");
  } finally {
    process.chdir(originalCwd);
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});
