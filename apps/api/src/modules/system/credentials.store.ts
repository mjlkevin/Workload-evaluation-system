// ============================================================
// 凭据域存储 — ISS-2026-08-05-001
// ============================================================
// 封装 AES-256-GCM 加密/解密 + DB 持久化 + 变更审计 + 内存缓存。
// KEK 来自环境变量 CREDENTIAL_KEK（base64 编码 32 字节）。
// 密文格式：v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
//
// 安全红线：
//   - 真实 KEK / API 密钥不得进入日志、错误信息、审计 meta
//   - 写入路径无 KEK 必须报错拒绝（不得降级明文）
//   - 审计 meta 仅存非敏感信息（key_version、来源）

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { config } from "../../config/env";

// -------------------- 常量 --------------------

const CIPHER_ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 推荐 12 字节
const TAG_LENGTH = 16; // GCM 默认 16 字节
const VERSION_PREFIX = "v1";
const KIMI_SCOPE = "kimi";

// -------------------- 内存缓存（供同步读取） --------------------

const _credentialCache = new Map<string, string>();

/** 清除内存缓存（测试用，模拟重启） */
export function resetCredentialCache(): void {
  _credentialCache.clear();
}

/** 从缓存读取密钥（同步，供 system.repository.ts 使用） */
export function getCachedApiKey(scope: string): string | null {
  return _credentialCache.get(scope) ?? null;
}

/** 直接设置缓存（供一次性导入时立即填充，不写 DB） */
export function setCachedApiKey(scope: string, plaintext: string): void {
  _credentialCache.set(scope, plaintext);
}

// -------------------- 纯加密函数 --------------------

/** 从环境变量解析 KEK，缺失返回 null（dev 环境输出警告） */
export function resolveKek(): Buffer | null {
  const raw = process.env.CREDENTIAL_KEK || config.credentialKek;
  if (!raw) {
    // dev 环境：输出一次性警告，不阻塞读取路径
    if (process.env.NODE_ENV !== "production") {
      console.warn("[credentials] CREDENTIAL_KEK not configured: credential writes will fail");
    }
    return null;
  }
  const kek = Buffer.from(raw, "base64");
  if (kek.length !== 32) {
    throw new Error("CREDENTIAL_KEK must be base64-encoded 32 bytes");
  }
  return kek;
}

/** 加密明文密钥，返回 v1:<iv>:<tag>:<ciphertext> 格式密文 */
export function encryptCredential(plaintext: string, kek: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGO, kek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** 解密 v1:<iv>:<tag>:<ciphertext> 格式密文，返回明文 */
export function decryptCredential(encrypted: string, kek: Buffer): string {
  const parts = encrypted.split(":");
  if (parts.length < 4 || parts[0] !== VERSION_PREFIX) {
    throw new Error("Invalid credential format: expected v1:<iv>:<tag>:<ciphertext>");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts.slice(3).join(":"), "base64");
  const decipher = createDecipheriv(CIPHER_ALGO, kek, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// -------------------- DB 操作 --------------------

export interface ApiKeyResult {
  apiKey: string;
  keyVersion: number;
  source: "db" | "none";
}

export interface CredentialAuditRecord {
  id: number;
  scope: string;
  action: string;
  actor: string | null;
  at: string;
  meta: Record<string, unknown>;
}

/** 解析 pool 参数：优先使用传入的 pool（测试用），否则用全局 pool */
function resolvePool(override?: Pool): Pool {
  if (override) return override;
  // 延迟导入全局 pool，避免测试环境无 DATABASE_URL 时崩溃
  const { pool } = require("../../db/client");
  return pool as Pool;
}

/** 从 DB 读取并解密密钥 */
export async function getApiKey(scope: string, poolOverride?: Pool): Promise<ApiKeyResult> {
  const pool = resolvePool(poolOverride);
  const result = await pool.query(
    "SELECT api_key_encrypted, key_version FROM credentials WHERE scope = $1",
    [scope],
  );
  if (result.rows.length === 0) {
    return { apiKey: "", keyVersion: 0, source: "none" };
  }
  const row = result.rows[0];
  const kek = resolveKek();
  if (!kek) {
    // KEK 缺失：无法解密，dev 体验允许仅读存量（返回空）
    return { apiKey: "", keyVersion: row.key_version, source: "none" };
  }
  const plaintext = decryptCredential(row.api_key_encrypted, kek);
  // 更新缓存
  _credentialCache.set(scope, plaintext);
  return { apiKey: plaintext, keyVersion: row.key_version, source: "db" };
}

/** 写入密钥（首次或更新），审计 action='set' */
export async function setApiKey(
  scope: string,
  plaintext: string,
  actor: string,
  poolOverride?: Pool,
): Promise<void> {
  const kek = resolveKek();
  if (!kek) {
    throw new Error("CREDENTIAL_KEK not configured: cannot write credentials (refuse to degrade to plaintext)");
  }
  const encrypted = encryptCredential(plaintext, kek);
  const pool = resolvePool(poolOverride);

  // Upsert：首次插入 key_version=1，已存在则更新密文（不递增版本）
  const upsertResult = await pool.query(
    `INSERT INTO credentials (scope, api_key_encrypted, key_version, updated_by, updated_at)
     VALUES ($1, $2, 1, $3, now())
     ON CONFLICT (scope) DO UPDATE
     SET api_key_encrypted = $2, updated_by = $3, updated_at = now()
     RETURNING (xmax = 0) AS inserted, key_version`,
    [scope, encrypted, actor],
  );
  const wasInsert = upsertResult.rows[0]?.inserted;
  const keyVersion = upsertResult.rows[0]?.key_version ?? 1;

  // 写审计
  await pool.query(
    `INSERT INTO credential_audit (scope, action, actor, at, meta)
     VALUES ($1, 'set', $2, now(), $3)`,
    [scope, actor, JSON.stringify({ key_version: keyVersion, first_set: wasInsert })],
  );

  // 更新缓存
  _credentialCache.set(scope, plaintext);
}

/** 轮换密钥（必须已存在），key_version 递增，审计 action='rotate' */
export async function rotateApiKey(
  scope: string,
  plaintext: string,
  actor: string,
  poolOverride?: Pool,
): Promise<void> {
  const kek = resolveKek();
  if (!kek) {
    throw new Error("CREDENTIAL_KEK not configured: cannot rotate credentials");
  }
  const encrypted = encryptCredential(plaintext, kek);
  const pool = resolvePool(poolOverride);

  const result = await pool.query(
    `UPDATE credentials
     SET api_key_encrypted = $2, key_version = key_version + 1, updated_by = $3, updated_at = now()
     WHERE scope = $1
     RETURNING key_version`,
    [scope, encrypted, actor],
  );
  if (result.rows.length === 0) {
    throw new Error(`Cannot rotate: no existing credential for scope '${scope}'`);
  }
  const keyVersion = result.rows[0].key_version;

  await pool.query(
    `INSERT INTO credential_audit (scope, action, actor, at, meta)
     VALUES ($1, 'rotate', $2, now(), $3)`,
    [scope, actor, JSON.stringify({ key_version: keyVersion })],
  );

  _credentialCache.set(scope, plaintext);
}

/** 清除密钥，审计 action='clear' */
export async function clearApiKey(
  scope: string,
  actor: string,
  poolOverride?: Pool,
): Promise<void> {
  const pool = resolvePool(poolOverride);

  await pool.query("DELETE FROM credentials WHERE scope = $1", [scope]);

  await pool.query(
    `INSERT INTO credential_audit (scope, action, actor, at, meta)
     VALUES ($1, 'clear', $2, now(), '{}'::jsonb)`,
    [scope, actor],
  );

  _credentialCache.delete(scope);
}

/** 幂等导入：DB 无此 scope 时导入，已有则不覆盖。返回 true=已导入，false=已存在跳过 */
export async function importApiKeyIfAbsent(
  scope: string,
  plaintext: string,
  actor: string,
  poolOverride?: Pool,
): Promise<boolean> {
  const kek = resolveKek();
  if (!kek) {
    throw new Error("CREDENTIAL_KEK not configured: cannot import credentials");
  }
  const encrypted = encryptCredential(plaintext, kek);
  const pool = resolvePool(poolOverride);

  // INSERT ... ON CONFLICT DO NOTHING：已存在时不覆盖
  const result = await pool.query(
    `INSERT INTO credentials (scope, api_key_encrypted, key_version, updated_by, updated_at)
     VALUES ($1, $2, 1, $3, now())
     ON CONFLICT (scope) DO NOTHING
     RETURNING scope`,
    [scope, encrypted, actor],
  );

  if (result.rows.length === 0) {
    // 已存在，不导入
    return false;
  }

  // 写审计
  await pool.query(
    `INSERT INTO credential_audit (scope, action, actor, at, meta)
     VALUES ($1, 'import', $2, now(), $3)`,
    [scope, actor, JSON.stringify({ key_version: 1, source: "file" })],
  );

  // 更新缓存
  _credentialCache.set(scope, plaintext);
  return true;
}

/** 读取审计日志 */
export async function getAuditLog(
  scope: string,
  poolOverride?: Pool,
  limit: number = 50,
): Promise<CredentialAuditRecord[]> {
  const pool = resolvePool(poolOverride);
  const result = await pool.query(
    `SELECT id, scope, action, actor, at, meta
     FROM credential_audit
     WHERE scope = $1
     ORDER BY at DESC
     LIMIT $2`,
    [scope, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    action: row.action,
    actor: row.actor,
    at: row.at,
    meta: row.meta || {},
  }));
}

/**
 * 启动预热（ISS-2026-08-10-008）：把 DB 中已存在的密钥提前解密填入内存缓存，
 * 避免重启后同步读取链（resolveActiveRequirementKimiApiKey 等）静默回落 env。
 * 单个 scope 失败只跳过不抛错（DB 未就绪/KEK 缺失均不得阻断启动）。
 * 返回成功预热的 scope 列表。
 */
export async function warmCredentialScopes(scopes: string[], poolOverride?: Pool): Promise<string[]> {
  const warmed: string[] = [];
  for (const scope of scopes) {
    try {
      const result = await getApiKey(scope, poolOverride);
      if (result.apiKey) warmed.push(scope);
    } catch {
      /* 降级：预热失败不阻断启动，读取链回落 env 兜底 */
    }
  }
  return warmed;
}

// -------------------- 便捷导出 --------------------

/** Kimi scope 常量，供 system.repository.ts 使用 */
export { KIMI_SCOPE };
