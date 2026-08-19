// ============================================================
// Auth 域 PG 仓储测试（阶段 2 批 1 · 试点）
// ============================================================
// 口径：按 harness 五条硬性范式验证 invite_codes / password_reset_tokens
// 的 PG 实现——幂等插入（onConflictDoNothing + 重查消歧）、条件 UPDATE CAS
// （竞争失败返回 null）、并发单赢家、DB 时钟、安全错误边界。
// 仅读取 TEST_DATABASE_URL；缺失时跳过（与 harness 仓储测试同范式）。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

import { inviteCodes, passwordResetTokens } from "../../db/schema";
import {
  AuthStoreError,
  createAuthPgRepository,
  type AuthPgRepository,
} from "./auth-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let repo: AuthPgRepository | null = null;
const createdCodes: string[] = [];
const createdTokenIds: string[] = [];

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createAuthPgRepository(drizzle(pool));
});

after(async () => {
  if (pool) await pool.end();
});

afterEach(async () => {
  if (!repo) return;
  const dbInstance = repo.__dbForTest();
  for (const code of createdCodes.splice(0)) {
    await dbInstance.delete(inviteCodes).where(eq(inviteCodes.code, code));
  }
  for (const tokenId of createdTokenIds.splice(0)) {
    await dbInstance.delete(passwordResetTokens).where(eq(passwordResetTokens.tokenId, tokenId));
  }
});

function trackCode(code: string): string {
  createdCodes.push(code);
  return code;
}

function trackToken(tokenId: string): string {
  createdTokenIds.push(tokenId);
  return tokenId;
}

// ─── 邀请码 ──────────────────────────────────────────────────

test("createInviteCode 幂等：同码重放返回原记录（created=false）", { skip: !testDatabaseUrl }, async () => {
  const code = trackCode(`TST-${randomUUID()}`);
  const first = await repo!.createInviteCode({ code });
  assert.equal(first.created, true);
  assert.equal(first.record.code, code);
  assert.equal(first.record.status, "active");

  const replay = await repo!.createInviteCode({ code });
  assert.equal(replay.created, false, "重放必须消歧为已存在");
  assert.equal(replay.record.code, code);
});

test("findInviteCode 大小写不敏感", { skip: !testDatabaseUrl }, async () => {
  const code = trackCode(`TST-${randomUUID()}`);
  await repo!.createInviteCode({ code });
  const lower = await repo!.findInviteCode(code.toLowerCase());
  assert.ok(lower, "小写输入必须命中大写存储的邀请码");
  assert.equal(lower!.code, code);
  const missing = await repo!.findInviteCode(`NOPE-${randomUUID()}`);
  assert.equal(missing, null);
});

test("markInviteCodeUsed CAS：仅 active 可标记，重放返回 null", { skip: !testDatabaseUrl }, async () => {
  const code = trackCode(`TST-${randomUUID()}`);
  await repo!.createInviteCode({ code });

  const used = await repo!.markInviteCodeUsed({
    code,
    usedByUserId: "user-1",
    usedByUsername: "alice",
  });
  assert.ok(used, "首次标记必须成功");
  assert.equal(used!.status, "used");
  assert.equal(used!.usedByUserId, "user-1");
  assert.ok(used!.usedAt, "usedAt 必须由 DB 时钟写入");

  const replay = await repo!.markInviteCodeUsed({
    code,
    usedByUserId: "user-2",
    usedByUsername: "bob",
  });
  assert.equal(replay, null, "已 used 的邀请码再次标记必须 CAS 失败");
});

test("并发消费同一邀请码：恰好 1 个赢家（JSON 侧无锁 RMW 的对照修复）", { skip: !testDatabaseUrl }, async () => {
  const code = trackCode(`TST-${randomUUID()}`);
  await repo!.createInviteCode({ code });

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      repo!.markInviteCodeUsed({
        code,
        usedByUserId: `user-${i}`,
        usedByUsername: `racer-${i}`,
      }),
    ),
  );
  const winners = results.filter((r) => r !== null);
  assert.equal(winners.length, 1, `并发 8 路必须恰好 1 个赢家，实际 ${winners.length}`);
});

// ─── 密码重置令牌 ────────────────────────────────────────────

test("deactivateActiveResetTokens：仅作废 active，返回作废数量", { skip: !testDatabaseUrl }, async () => {
  const userId = `user-${randomUUID()}`;
  const t1 = await repo!.createResetToken({
    userId,
    username: "alice",
    tokenHash: `hash-${randomUUID()}`,
    ttlMs: 30 * 60 * 1000,
  });
  const t2 = await repo!.createResetToken({
    userId,
    username: "alice",
    tokenHash: `hash-${randomUUID()}`,
    ttlMs: 30 * 60 * 1000,
  });
  trackToken(t1.record.id);
  trackToken(t2.record.id);

  const count = await repo!.deactivateActiveResetTokens({ userId });
  assert.equal(count, 2, "该用户 2 条 active 令牌必须全部作废");

  const again = await repo!.deactivateActiveResetTokens({ userId });
  assert.equal(again, 0, "已无 active 令牌时重放返回 0");
});

test("createResetToken 幂等：同 id 重放返回原记录", { skip: !testDatabaseUrl }, async () => {
  const input = {
    userId: `user-${randomUUID()}`,
    username: "alice",
    tokenHash: `hash-${randomUUID()}`,
    ttlMs: 30 * 60 * 1000,
  };
  const first = await repo!.createResetToken(input);
  trackToken(first.record.id);
  assert.equal(first.created, true);
  assert.ok(first.record.expiresAt, "expiresAt 必须存在");

  const replay = await repo!.createResetToken({ ...input, tokenId: first.record.id });
  assert.equal(replay.created, false, "同 id 重放必须消歧为已存在");
  assert.equal(replay.record.id, first.record.id);
});

test("consumeResetToken CAS：active 未过期可消费，重放返回 null", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createResetToken({
    userId: `user-${randomUUID()}`,
    username: "alice",
    tokenHash: `hash-${randomUUID()}`,
    ttlMs: 30 * 60 * 1000,
  });
  trackToken(created.record.id);

  const consumed = await repo!.consumeResetToken({ tokenId: created.record.id });
  assert.ok(consumed, "active 未过期令牌必须可消费");
  assert.equal(consumed!.status, "used");
  assert.ok(consumed!.usedAt);

  const replay = await repo!.consumeResetToken({ tokenId: created.record.id });
  assert.equal(replay, null, "已消费令牌重放必须 CAS 失败");
});

test("consumeResetToken：过期令牌不可消费", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createResetToken({
    userId: `user-${randomUUID()}`,
    username: "alice",
    tokenHash: `hash-${randomUUID()}`,
    ttlMs: 30 * 60 * 1000,
  });
  trackToken(created.record.id);
  // 直接把过期时间改到过去，模拟过期（绕过 ttl 正值断言）
  const dbInstance = repo!.__dbForTest();
  await dbInstance
    .update(passwordResetTokens)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(passwordResetTokens.tokenId, created.record.id));

  const consumed = await repo!.consumeResetToken({ tokenId: created.record.id });
  assert.equal(consumed, null, "过期令牌消费必须失败");
});

test("并发消费同一重置令牌：恰好 1 个赢家", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createResetToken({
    userId: `user-${randomUUID()}`,
    username: "alice",
    tokenHash: `hash-${randomUUID()}`,
    ttlMs: 30 * 60 * 1000,
  });
  trackToken(created.record.id);

  const results = await Promise.all(
    Array.from({ length: 8 }, () => repo!.consumeResetToken({ tokenId: created.record.id })),
  );
  const winners = results.filter((r) => r !== null);
  assert.equal(winners.length, 1, `并发 8 路必须恰好 1 个赢家，实际 ${winners.length}`);
});

// ─── 安全错误边界 ────────────────────────────────────────────

test("toSafeError：DB 不可达时抛 AuthStoreError（不泄漏 pg 原始错误细节）", async () => {
  const brokenPool = new Pool({ connectionString: "postgres://invalid:invalid@127.0.0.1:1/none", max: 1 });
  const brokenRepo = createAuthPgRepository(drizzle(brokenPool));
  await assert.rejects(
    () => brokenRepo.listInviteCodes(),
    (err: unknown) => {
      assert.ok(err instanceof AuthStoreError, "必须收敛为域内错误类型");
      assert.equal((err as AuthStoreError).code, "AUTH_STORE_INTERNAL");
      assert.ok(!/127\.0\.0\.1/.test(err.message), "错误消息不得泄漏连接细节");
      return true;
    },
  );
  await brokenPool.end();
});
