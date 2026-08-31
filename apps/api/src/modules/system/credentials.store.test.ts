// ============================================================
// 凭据域 DB 化测试 — ISS-2026-08-05-001
// ============================================================
// 验证 AES-256-GCM 加密/解密、DB 持久化、变更审计。
// 纯加密测试无需 DB；DB 测试需要 TEST_DATABASE_URL，缺失时跳过。
// S7（2026-08-31，台账 B7）：「导入幂等」面随 `importApiKeyIfAbsent` 一并退役
// ——文件密钥一次性导入的唯一生产调用点已随 S3 删除，保留它只会给
// 「还有一条从文件导入凭据的在用通道」的错印象（历史形态见 git 历史）。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

import {
  encryptCredential,
  decryptCredential,
  resolveKek,
  getApiKey,
  setApiKey,
  rotateApiKey,
  clearApiKey,
  getAuditLog,
  resetCredentialCache,
} from "./credentials.store";

// -------------------- 纯加密测试（无需 DB） --------------------

test("encrypt/decrypt round-trip: 解密后与明文一致", () => {
  const kek = randomBytes(32);
  const plaintext = "sk-test-key-for-round-trip-12345";
  const encrypted = encryptCredential(plaintext, kek);
  const decrypted = decryptCredential(encrypted, kek);
  assert.equal(decrypted, plaintext);
});

test("encrypted format: 以 v1: 前缀开头且不含明文", () => {
  const kek = randomBytes(32);
  const plaintext = "sk-my-secret-key-67890";
  const encrypted = encryptCredential(plaintext, kek);
  assert.ok(encrypted.startsWith("v1:"), "密文应以 v1: 开头");
  assert.ok(!encrypted.includes(plaintext), "密文不得包含明文");
  // v1:<iv>:<tag>:<ciphertext> — 至少 4 段
  const parts = encrypted.split(":");
  assert.ok(parts.length >= 4, "密文应至少 4 段（v1:iv:tag:ciphertext）");
});

test("encrypt 产生不同密文: 同一明文每次加密结果不同（IV 随机性）", () => {
  const kek = randomBytes(32);
  const plaintext = "sk-same-plaintext-for-iv-test";
  const enc1 = encryptCredential(plaintext, kek);
  const enc2 = encryptCredential(plaintext, kek);
  assert.notEqual(enc1, enc2, "不同加密应产生不同密文（IV 随机）");
  // 但两者解密后应一致
  assert.equal(decryptCredential(enc1, kek), plaintext);
  assert.equal(decryptCredential(enc2, kek), plaintext);
});

test("decrypt with wrong KEK: 解密失败抛错", () => {
  const kek1 = randomBytes(32);
  const kek2 = randomBytes(32);
  const plaintext = "sk-wrong-kek-test-key";
  const encrypted = encryptCredential(plaintext, kek1);
  assert.throws(() => decryptCredential(encrypted, kek2), /decrypt|auth|tag/i);
});

// -------------------- resolveKek 测试（ISS-2026-08-10-006） --------------------

test("resolveKek: 环境变量未配置时返回 null 且 dev 环境输出警告", () => {
  const savedKek = process.env.CREDENTIAL_KEK;
  const savedNodeEnv = process.env.NODE_ENV;
  delete process.env.CREDENTIAL_KEK;
  delete process.env.NODE_ENV; // 非 production → dev 路径

  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warns.push(msg);

  try {
    const result = resolveKek();
    assert.equal(result, null, "KEK 未配置时应返回 null");
    assert.ok(warns.length > 0, "dev 环境应输出警告");
    assert.ok(
      warns[0].includes("CREDENTIAL_KEK"),
      "警告信息应包含 CREDENTIAL_KEK",
    );
  } finally {
    if (savedKek) process.env.CREDENTIAL_KEK = savedKek;
    if (savedNodeEnv) process.env.NODE_ENV = savedNodeEnv;
    console.warn = originalWarn;
  }
});

test("resolveKek: 非 32 字节的 KEK 抛出格式错误", () => {
  const savedKek = process.env.CREDENTIAL_KEK;
  // "short" base64 解码后只有 5 字节，不等于 32
  process.env.CREDENTIAL_KEK = "short";
  try {
    assert.throws(
      () => resolveKek(),
      /CREDENTIAL_KEK must be base64-encoded 32 bytes/,
    );
  } finally {
    if (savedKek) process.env.CREDENTIAL_KEK = savedKek;
    else delete process.env.CREDENTIAL_KEK;
  }
});

test("resolveKek: 正确的 32 字节 base64 KEK 返回 Buffer", () => {
  const savedKek = process.env.CREDENTIAL_KEK;
  process.env.CREDENTIAL_KEK = randomBytes(32).toString("base64");
  try {
    const result = resolveKek();
    assert.ok(Buffer.isBuffer(result), "应返回 Buffer");
    assert.equal(result!.length, 32, "应为 32 字节");
  } finally {
    if (savedKek) process.env.CREDENTIAL_KEK = savedKek;
    else delete process.env.CREDENTIAL_KEK;
  }
});

// -------------------- DB 持久化测试（需要 TEST_DATABASE_URL） --------------------

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
const testScope = "kimi-test-" + Date.now().toString(36);

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  // 清理可能的残留
  await pool.query("DELETE FROM credential_audit WHERE scope = $1", [testScope]);
  await pool.query("DELETE FROM credentials WHERE scope = $1", [testScope]);
});

after(async () => {
  if (pool) {
    await pool.query("DELETE FROM credential_audit WHERE scope = $1", [testScope]);
    await pool.query("DELETE FROM credentials WHERE scope = $1", [testScope]);
    await pool.end();
  }
});

afterEach(async () => {
  if (!pool) return;
  await pool.query("DELETE FROM credential_audit WHERE scope = $1", [testScope]);
  await pool.query("DELETE FROM credentials WHERE scope = $1", [testScope]);
  resetCredentialCache();
});

test("DB set+get: 写入密钥后读取一致", { skip: !testDatabaseUrl }, async () => {
  const plaintext = "sk-db-roundtrip-key-001";
  await setApiKey(testScope, plaintext, "test-actor", pool!);

  const result = await getApiKey(testScope, pool!);
  assert.equal(result.apiKey, plaintext);
  assert.equal(result.source, "db");
});

test("DB set 后密文以 v1: 开头且审计存在 action=set", { skip: !testDatabaseUrl }, async () => {
  const plaintext = "sk-audit-test-key-002";
  await setApiKey(testScope, plaintext, "test-actor", pool!);

  // 直接查询 DB 行验证密文格式
  const row = await pool!.query(
    "SELECT api_key_encrypted FROM credentials WHERE scope = $1",
    [testScope],
  );
  assert.equal(row.rows.length, 1);
  assert.ok(row.rows[0].api_key_encrypted.startsWith("v1:"), "DB 中密文应以 v1: 开头");
  assert.ok(!row.rows[0].api_key_encrypted.includes(plaintext), "密文不得含明文");

  // 验证审计记录
  const audit = await getAuditLog(testScope, pool!);
  assert.ok(audit.length >= 1, "应存在至少一条审计记录");
  const setAction = audit.find((a) => a.action === "set");
  assert.ok(setAction, "应存在 action='set' 审计行");
  assert.equal(setAction!.actor, "test-actor");
  // 审计 meta 不得包含密钥明文或密文
  const metaStr = JSON.stringify(setAction!.meta || {});
  assert.ok(!metaStr.includes(plaintext), "审计 meta 不得含密钥明文");
});

test("DB rotate: key_version 递增且审计存在 action=rotate", { skip: !testDatabaseUrl }, async () => {
  const key1 = "sk-rotate-original-003";
  const key2 = "sk-rotate-new-004";
  await setApiKey(testScope, key1, "test-actor", pool!);

  const before = await getApiKey(testScope, pool!);
  assert.equal(before.apiKey, key1);

  await rotateApiKey(testScope, key2, "test-actor", pool!);

  const after = await getApiKey(testScope, pool!);
  assert.equal(after.apiKey, key2);
  assert.ok(after.keyVersion > before.keyVersion, "key_version 应递增");

  const audit = await getAuditLog(testScope, pool!);
  const rotateAction = audit.find((a) => a.action === "rotate");
  assert.ok(rotateAction, "应存在 action='rotate' 审计行");
});

// S7（2026-08-31，台账 B7）：原「DB import 幂等: 首次导入成功，二次不覆盖」用例
// 随 `importApiKeyIfAbsent` 删除。本文件不属任何 test:* 脚本（台账 B4 的 14 个
// 孤儿测试文件之一），故本批不影响六套件计数。

test("重启留存: set 后清缓存再读取，密钥仍可解密一致", { skip: !testDatabaseUrl }, async () => {
  const plaintext = "sk-restart-persistence-007";
  await setApiKey(testScope, plaintext, "test-actor", pool!);

  // 模拟重启：清除内存缓存
  resetCredentialCache();

  // 重新从 DB 读取
  const result = await getApiKey(testScope, pool!);
  assert.equal(result.apiKey, plaintext, "重启后应从 DB 恢复相同密钥");
  assert.equal(result.source, "db");
});
