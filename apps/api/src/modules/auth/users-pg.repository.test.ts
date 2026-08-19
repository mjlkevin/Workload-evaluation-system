// ============================================================
// Users 域 PG 仓储测试（阶段 2 批 2 · 登录热路径）
// ============================================================
// 口径：按批 1 确立的五条硬性范式验证 users 表的 PG 实现——
// 幂等插入（onConflictDoNothing + 重查消歧）、条件 UPDATE CAS、
// 写穿缓存（命中不再读库 / 写后立即一致 / 冷启动回填）、DB 时钟、
// 安全错误边界；外加批 2 附带改造项：register 事务化
//（邀请码 CAS + 用户插入同事务，用户名冲突回滚不浪费邀请码）。
// 仅读取 TEST_DATABASE_URL；缺失时跳过（与 auth-pg.repository.test 同范式）。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";

import { inviteCodes, users } from "../../db/schema";
import { createAuthPgRepository } from "./auth-pg.repository";
import {
  UsersStoreError,
  createUsersPgRepository,
  type UsersPgRepository,
} from "./users-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let repo: UsersPgRepository | null = null;
const createdUsernames: string[] = [];
const createdCodes: string[] = [];

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createUsersPgRepository(drizzle(pool));
  // PG users 表在测试套件内无其他写入方（seed.guards 仅测守卫分支不落库），
  // 清空以保证「首个注册用户为 admin」用例可确定性断言。
  await pool.query("DELETE FROM users");
});

after(async () => {
  if (pool) await pool.end();
});

afterEach(async () => {
  if (!pool) return;
  for (const username of createdUsernames.splice(0)) {
    await pool.query("DELETE FROM users WHERE username = $1", [username]);
  }
  for (const code of createdCodes.splice(0)) {
    await pool.query("DELETE FROM invite_codes WHERE code = $1", [code]);
  }
});

function trackUser(username: string): string {
  createdUsernames.push(username);
  return username;
}

function trackCode(code: string): string {
  createdCodes.push(code);
  return code;
}

function makeUserInput(overrides: Partial<{ username: string; role: "admin" | "sub_admin" | "user" }> = {}) {
  const username = trackUser(overrides.username ?? `wes-t-${randomUUID().slice(0, 8)}`);
  return {
    id: randomUUID(),
    username,
    passwordHash: "$2a$10$test-hash-not-real",
    role: overrides.role ?? ("user" as const),
    businessRole: "pre_sales" as const,
  };
}

async function readDbUser(username: string) {
  const result = await pool!.query("SELECT * FROM users WHERE username = $1", [username]);
  return result.rows[0] ?? null;
}

async function readDbInviteCode(code: string) {
  const result = await pool!.query("SELECT * FROM invite_codes WHERE code = $1", [code]);
  return result.rows[0] ?? null;
}

// ─── 幂等与基础读写 ─────────────────────────────────────────

test("createUser 幂等：同 id 重放返回原记录（created=false）", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  const first = await repo!.createUser(input);
  assert.equal(first.created, true);
  assert.equal(first.user.username, input.username);
  assert.equal(first.user.status, "active");

  const replay = await repo!.createUser(input);
  assert.equal(replay.created, false, "重放必须消歧为已存在");
  assert.equal(replay.user.id, input.id);
});

test("createUser 用户名冲突：按 username 重查消歧返回原记录", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  await repo!.createUser(input);

  const collision = await repo!.createUser({ ...input, id: randomUUID() });
  assert.equal(collision.created, false);
  assert.equal(collision.user.id, input.id, "username 冲突必须返回既有用户而非新 id");
});

test("findUserByUsername 大小写不敏感", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput({ username: `wes-t-upper-${randomUUID().slice(0, 8)}` });
  await repo!.createUser(input);

  const found = await repo!.findUserByUsername(input.username.toUpperCase());
  assert.ok(found, "大写输入必须命中小写存储的用户名");
  assert.equal(found!.id, input.id);
});

test("updateUserStatus CAS：存在则更新返回新记录，不存在返回 null", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  await repo!.createUser(input);

  const updated = await repo!.updateUserStatus({ id: input.id, status: "disabled" });
  assert.ok(updated);
  assert.equal(updated!.status, "disabled");

  const missing = await repo!.updateUserStatus({ id: randomUUID(), status: "active" });
  assert.equal(missing, null);
});

test("updateUserRole / updateUserBusinessRole / updateUserPasswordHash 行级更新", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  await repo!.createUser(input);

  const roleUpdated = await repo!.updateUserRole({ id: input.id, role: "sub_admin" });
  assert.equal(roleUpdated!.role, "sub_admin");

  const brUpdated = await repo!.updateUserBusinessRole({ id: input.id, businessRole: "pm" });
  assert.equal(brUpdated!.businessRole, "pm");

  const pwUpdated = await repo!.updateUserPasswordHash({ id: input.id, passwordHash: "$2a$10$new-hash" });
  assert.equal(pwUpdated!.passwordHash, "$2a$10$new-hash");

  assert.equal(await repo!.updateUserRole({ id: randomUUID(), role: "user" }), null);
  assert.equal(await repo!.updateUserBusinessRole({ id: randomUUID(), businessRole: "pm" }), null);
  assert.equal(await repo!.updateUserPasswordHash({ id: randomUUID(), passwordHash: "x" }), null);
});

test("touchLastLogin 以 DB 时钟更新最后登录时间", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  const created = await repo!.createUser(input);
  repo!.resetUsersCache();

  const touched = await repo!.touchLastLogin({ id: input.id });
  assert.ok(touched);
  const before = new Date(created.user.lastLoginAt).getTime();
  const afterTs = new Date(touched!.lastLoginAt).getTime();
  assert.ok(afterTs >= before, "lastLoginAt 必须不早于创建时刻");
  assert.equal(await repo!.touchLastLogin({ id: randomUUID() }), null);
});

// ─── 写穿缓存 ───────────────────────────────────────────────

test("缓存命中：DB 被旁路篡改后读路径仍返回缓存值", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  await repo!.createUser(input);
  repo!.resetUsersCache();

  // 冷加载预热缓存
  const warmed = await repo!.findUserById(input.id);
  assert.ok(warmed);

  // 旁路篡改 DB（绕过仓储）→ 缓存命中时不得看见
  await pool!.query("UPDATE users SET status = 'disabled' WHERE username = $1", [input.username]);
  const cached = await repo!.findUserById(input.id);
  assert.equal(cached!.status, "active", "缓存命中必须返回缓存值，证明未发起 DB 查询");

  // listUsers 同样走缓存
  const listed = await repo!.listUsers();
  assert.equal(listed.find((u) => u.id === input.id)!.status, "active");

  // 显式失效后必须回源读到真实状态
  repo!.resetUsersCache();
  const refreshed = await repo!.findUserById(input.id);
  assert.equal(refreshed!.status, "disabled", "缓存失效后必须回源");
});

test("写穿一致性：写后读立即一致且不经回源", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  await repo!.createUser(input);
  repo!.resetUsersCache();
  await repo!.findUserById(input.id); // 预热

  await repo!.updateUserStatus({ id: input.id, status: "disabled" });
  // 旁路把 DB 改回 active：若写后读回源，会看到 active（错误）；写穿缓存应仍是 disabled
  await pool!.query("UPDATE users SET status = 'active' WHERE username = $1", [input.username]);
  const read = await repo!.findUserById(input.id);
  assert.equal(read!.status, "disabled", "写穿后读必须命中缓存中的新值");
});

// ─── 错误边界（范式 #1 / ISS-2026-08-18-004） ───────────────

test("读取失败抛 USERS_STORE_INTERNAL 且不泄露连接串", { skip: !testDatabaseUrl }, async () => {
  const badHost = "postgres://wes:wes@127.0.0.1:59999/wes_no_such_db";
  const brokenRepo = createUsersPgRepository(drizzle(new Pool({ connectionString: badHost, connectionTimeoutMillis: 300 })));
  await assert.rejects(
    () => brokenRepo.listUsers(),
    (err: unknown) => {
      assert.ok(err instanceof UsersStoreError);
      assert.equal((err as UsersStoreError).code, "USERS_STORE_INTERNAL");
      assert.ok(!String((err as Error).message).includes("127.0.0.1"), "错误信息不得含连接细节");
      return true;
    },
  );
  // 读取失败不得静默返回空集合（ISS-2026-08-18-004）
  await assert.rejects(() => brokenRepo.countUsers());
});

// ─── register 事务化（批 2 附带改造项，§4.4） ───────────────

async function seedInviteCode(): Promise<string> {
  const code = trackCode(`WES-T-${randomUUID().slice(0, 8).toUpperCase()}`);
  const authRepo = createAuthPgRepository(repo!.__dbForTest());
  await authRepo.createInviteCode({ code });
  return code;
}

test("registerWithInviteCode：同事务消费邀请码并创建用户", { skip: !testDatabaseUrl }, async () => {
  const code = await seedInviteCode();
  const username = trackUser(`wes-t-reg-${randomUUID().slice(0, 8)}`);

  const result = await repo!.registerWithInviteCode({ username, passwordHash: "$2a$10$hash", inviteCode: code });
  assert.equal(result.outcome, "created");
  assert.ok(result.user);
  assert.equal(result.user!.username, username);
  assert.equal(result.user!.status, "active");

  const dbCode = await readDbInviteCode(code);
  assert.equal(dbCode.status, "used");
  assert.equal(dbCode.used_by_user_id, result.user!.id);
});

test("registerWithInviteCode：用户名冲突回滚，邀请码不被浪费", { skip: !testDatabaseUrl }, async () => {
  const existing = makeUserInput();
  await repo!.createUser(existing);

  const code = await seedInviteCode();
  const result = await repo!.registerWithInviteCode({ username: existing.username, passwordHash: "$2a$10$hash", inviteCode: code });
  assert.equal(result.outcome, "username_exists");

  const dbCode = await readDbInviteCode(code);
  assert.equal(dbCode.status, "active", "用户名冲突必须回滚邀请码消费——消除浪费码窗口");
});

test("registerWithInviteCode：邀请码无效返回 invite_invalid", { skip: !testDatabaseUrl }, async () => {
  const result = await repo!.registerWithInviteCode({
    username: trackUser(`wes-t-noinv-${randomUUID().slice(0, 8)}`),
    passwordHash: "$2a$10$hash",
    inviteCode: `WES-T-NOEXIST-${randomUUID().slice(0, 8).toUpperCase()}`,
  });
  assert.equal(result.outcome, "invite_invalid");
});

test("registerWithInviteCode 并发：8 路同码恰好 1 赢家", { skip: !testDatabaseUrl }, async () => {
  const code = await seedInviteCode();
  const attempts = Array.from({ length: 8 }, (_, i) =>
    repo!.registerWithInviteCode({
      username: trackUser(`wes-t-race-${randomUUID().slice(0, 8)}-${i}`),
      passwordHash: "$2a$10$hash",
      inviteCode: code,
    }),
  );
  const results = await Promise.all(attempts);
  const winners = results.filter((r) => r.outcome === "created");
  const losers = results.filter((r) => r.outcome === "invite_invalid");
  assert.equal(winners.length, 1, "并发注册同码必须恰好 1 赢家");
  assert.equal(losers.length, 7);

  const dbCode = await readDbInviteCode(code);
  assert.equal(dbCode.status, "used");
  assert.equal(dbCode.used_by_user_id, winners[0].user!.id);
});

// ─── 并发状态修改（范式 #3） ────────────────────────────────

test("并发修改同一用户状态：最终收敛、无撕裂、无丢失", { skip: !testDatabaseUrl }, async () => {
  const input = makeUserInput();
  await repo!.createUser(input);

  const attempts = Array.from({ length: 8 }, (_, i) =>
    repo!.updateUserStatus({ id: input.id, status: i % 2 === 0 ? "disabled" : "active" }),
  );
  const results = await Promise.all(attempts);
  assert.equal(results.filter((r) => r === null).length, 0, "全部条件 UPDATE 必须命中同一行");

  const dbUser = await readDbUser(input.username);
  assert.ok(dbUser.status === "active" || dbUser.status === "disabled", "最终状态必须收敛为合法值");

  repo!.resetUsersCache();
  const reread = await repo!.findUserById(input.id);
  assert.equal(reread!.status, dbUser.status, "回源后缓存必须与 DB 一致");
});
