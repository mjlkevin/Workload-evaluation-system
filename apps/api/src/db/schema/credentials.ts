// ============================================================
// 凭据域 — ISS-2026-08-05-001
// ============================================================
// API 密钥加密落库 + 变更审计。作为第二个 DB-backed 域接入 PostgreSQL。
// KEK 来自环境变量 CREDENTIAL_KEK（base64 编码 32 字节），密文格式 v1:<iv>:<tag>:<ciphertext>。

import { sql } from "drizzle-orm";
import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** 凭据存储：每个 scope 一行，密文 + 版本 */
export const credentials = pgTable("credentials", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  scope: text("scope").notNull().unique(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 凭据变更审计：每次 set/rotate/clear/import 写一行 */
export const credentialAudit = pgTable("credential_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  scope: text("scope").notNull(),
  action: text("action", { enum: ["set", "rotate", "clear", "import"] }).notNull(),
  actor: text("actor"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  meta: jsonb("meta").default({}).notNull(),
});

export type CredentialRow = typeof credentials.$inferSelect;
export type CredentialAuditRow = typeof credentialAudit.$inferSelect;
