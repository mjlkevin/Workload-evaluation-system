// ============================================================
// Auth 域 JSON 仓储（回滚路径）+ 选择器开关测试（阶段 2 批 1 · 试点）
// ============================================================
// 口径：JSON 实现必须与既有文件行为对等（保证翻回开关后回落路径可用），
// 选择器 WES_STORE_AUTH_PG 严格 === "true" 才走 PG，缺省 JSON。
// 通过 chdir 到临时目录隔离 config/auth 文件，不污染真实 store。

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  createAuthJsonRepository,
  getAuthRepository,
  _resetAuthRepositoryForTest,
  loadInviteCodesStore,
  loadPasswordResetTokensStore,
  savePasswordResetTokensStore,
} from "./auth.repository";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-auth-store-"));
  fs.mkdirSync(path.join(tmpDir, "config/auth"), { recursive: true });
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _resetAuthRepositoryForTest();
});

// ─── JSON 实现行为对等 ───────────────────────────────────────

test("JSON 仓储写邀请码后落盘为既有 { codes: [] } 结构", async () => {
  const repo = createAuthJsonRepository();
  const code = `TST-${randomUUID()}`;
  const { created, record } = await repo.createInviteCode({ code });
  assert.equal(created, true);
  assert.equal(record.status, "active");

  const store = await loadInviteCodesStore();
  assert.equal(store.codes.length, 1, "必须落盘为旧结构，保证回退兼容");
  assert.equal(store.codes[0].code, code);
});

test("JSON 仓储 markInviteCodeUsed：active 可标记，重放 null", async () => {
  const repo = createAuthJsonRepository();
  const code = `TST-${randomUUID()}`;
  await repo.createInviteCode({ code });

  const used = await repo.markInviteCodeUsed({ code, usedByUserId: "u1", usedByUsername: "alice" });
  assert.ok(used);
  assert.equal(used!.status, "used");
  const replay = await repo.markInviteCodeUsed({ code, usedByUserId: "u2", usedByUsername: "bob" });
  assert.equal(replay, null);
});

test("JSON 仓储重置令牌：deactivate 仅 active、consume 含过期校验", async () => {
  const repo = createAuthJsonRepository();
  const userId = `user-${randomUUID()}`;
  const t1 = await repo.createResetToken({ userId, username: "a", tokenHash: "h1", ttlMs: 1_800_000 });
  const t2 = await repo.createResetToken({ userId, username: "a", tokenHash: "h2", ttlMs: 1_800_000 });

  const count = await repo.deactivateActiveResetTokens({ userId });
  assert.equal(count, 2);

  // t1/t2 已被 deactivate；新建一条用于过期校验
  const t3 = await repo.createResetToken({ userId, username: "a", tokenHash: "h3", ttlMs: 1_800_000 });
  const consumed = await repo.consumeResetToken({ tokenId: t3.record.id });
  assert.ok(consumed, "active 未过期令牌必须可消费");
  const replay = await repo.consumeResetToken({ tokenId: t3.record.id });
  assert.equal(replay, null);

  // 过期令牌：把 expiresAt 改到过去并落盘后再消费
  const store = await loadPasswordResetTokensStore();
  const target = store.tokens.find((t) => t.id === t1.record.id)!;
  target.status = "active";
  target.expiresAt = new Date(Date.now() - 60_000).toISOString();
  await savePasswordResetTokensStore(store);
  const expiredConsume = await repo.consumeResetToken({ tokenId: t1.record.id });
  assert.equal(expiredConsume, null, "过期令牌消费必须失败");
  assert.equal(t2.record.status, "active", "创建时的记录对象不受后续 deactivate 影响（值拷贝语义）");
});

test("JSON 仓储 findInviteCode 大小写不敏感", async () => {
  const repo = createAuthJsonRepository();
  const code = `TST-${randomUUID()}`;
  await repo.createInviteCode({ code });
  const hit = await repo.findInviteCode(code.toLowerCase());
  assert.ok(hit);
});

// ─── 选择器开关 ─────────────────────────────────────────────

test("选择器：缺省走 JSON 实现", () => {
  delete process.env.WES_STORE_AUTH_PG;
  _resetAuthRepositoryForTest();
  const repo = getAuthRepository();
  assert.equal(typeof repo.createInviteCode, "function");
  // 通过构造来源断言：JSON 单例不应带 PG 仓储的 __dbForTest 钩子
  assert.equal("__dbForTest" in repo, false, "缺省必须是 JSON 实现");
});

test("选择器：严格 === \"true\" 才走 PG；\"1\"/\"yes\" 一律缺省 JSON", () => {
  for (const value of ["1", "yes", "TRUE", ""]) {
    process.env.WES_STORE_AUTH_PG = value;
    _resetAuthRepositoryForTest();
    const repo = getAuthRepository();
    assert.equal("__dbForTest" in repo, false, `取值 "${value}" 必须回落 JSON`);
  }
  delete process.env.WES_STORE_AUTH_PG;
});

test("选择器：WES_STORE_AUTH_PG=true 走 PG 实现且进程内单例记忆化", () => {
  process.env.WES_STORE_AUTH_PG = "true";
  _resetAuthRepositoryForTest();
  try {
    const repo1 = getAuthRepository();
    assert.equal("__dbForTest" in repo1, true, "true 必须走 PG 实现");
    const repo2 = getAuthRepository();
    assert.equal(repo1, repo2, "必须记忆化单例");
  } finally {
    delete process.env.WES_STORE_AUTH_PG;
  }
});
