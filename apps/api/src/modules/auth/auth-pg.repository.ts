// ============================================================
// Auth 域 PG 仓储（阶段 2 批 1 · 试点，harness 范式基准实现）
// ============================================================
// 五条硬性范式落实（供后续 8 个域复用）：
//  1. 错误边界：AuthStoreError（稳定 code），每个公开方法 try/catch 后经
//     toSafeError 收敛；pg/drizzle 原始错误（可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：onConflictDoNothing().returning() + 空结果时按主键重查消歧。
//  3. 并发控制：条件 UPDATE ... RETURNING（status/过期谓词），空结果即竞争失败。
//  4. 时间：一律 readDbNow(tx)（DB 时钟），禁止 Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错，禁止返回空集合。

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { inviteCodes, passwordResetTokens } from "../../db/schema";
import { InviteCodeRecord, PasswordResetTokenRecord } from "../../types";
import type {
  AuthStoreRepository,
  ConsumeResetTokenInput,
  CreateInviteCodeInput,
  CreateResetTokenInput,
  DeactivateResetTokensInput,
  MarkInviteCodeUsedInput,
} from "./auth.repository";

// ============================================================
// 安全错误
// ============================================================

export class AuthStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): AuthStoreError {
  if (err instanceof AuthStoreError) return err;
  return new AuthStoreError("AUTH_STORE_INTERNAL", "auth store persistence failed");
}

// ============================================================
// 行 ↔ 记录映射（PG 行时间列为 timestamptz，接口契约统一 ISO 字符串）
// ============================================================

type InviteCodeRow = typeof inviteCodes.$inferSelect;
type ResetTokenRow = typeof passwordResetTokens.$inferSelect;

function toInviteCodeRecord(row: InviteCodeRow): InviteCodeRecord {
  return {
    code: row.code,
    status: row.status as InviteCodeRecord["status"],
    createdAt: row.createdAt.toISOString(),
    usedAt: row.usedAt?.toISOString(),
    usedByUserId: row.usedByUserId ?? undefined,
    usedByUsername: row.usedByUsername ?? undefined,
  };
}

function toResetTokenRecord(row: ResetTokenRow): PasswordResetTokenRecord {
  return {
    id: row.tokenId,
    userId: row.userId,
    username: row.username,
    tokenHash: row.tokenHash,
    status: row.status as PasswordResetTokenRecord["status"],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString(),
  };
}

// ============================================================
// 工厂与接口
// ============================================================

export interface AuthPgRepository extends AuthStoreRepository {
  /** 测试钩子：暴露注入的 db 实例供用例做行级清理 */
  __dbForTest(): Database;
}

export function createAuthPgRepository(dbInstance: Database = db): AuthPgRepository {
  return {
    __dbForTest() {
      return dbInstance;
    },

    async listInviteCodes() {
      try {
        const rows = await dbInstance.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt));
        return rows.map(toInviteCodeRecord);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findInviteCode(code) {
      try {
        const rows = await dbInstance
          .select()
          .from(inviteCodes)
          .where(sql`upper(${inviteCodes.code}) = ${code.toUpperCase()}`);
        return rows[0] ? toInviteCodeRecord(rows[0]) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async createInviteCode(input: CreateInviteCodeInput) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const inserted = await tx
            .insert(inviteCodes)
            .values({ code: input.code, status: "active", createdAt: now })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            return { created: true, record: toInviteCodeRecord(inserted[0]) };
          }
          // 幂等消歧：插入被跳过 → 按主键重查返回原记录
          const [existing] = await tx.select().from(inviteCodes).where(eq(inviteCodes.code, input.code));
          if (existing) {
            return { created: false, record: toInviteCodeRecord(existing) };
          }
          throw new AuthStoreError("AUTH_STORE_INTERNAL", "invite code insert conflict unresolved");
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async markInviteCodeUsed(input: MarkInviteCodeUsedInput) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const rows = await tx
            .update(inviteCodes)
            .set({
              status: "used",
              usedAt: now,
              usedByUserId: input.usedByUserId,
              usedByUsername: input.usedByUsername,
            })
            .where(and(sql`upper(${inviteCodes.code}) = ${input.code.toUpperCase()}`, eq(inviteCodes.status, "active")))
            .returning();
          return rows[0] ? toInviteCodeRecord(rows[0]) : null;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findResetTokenByHash(tokenHash) {
      try {
        const rows = await dbInstance
          .select()
          .from(passwordResetTokens)
          .where(eq(passwordResetTokens.tokenHash, tokenHash));
        return rows[0] ? toResetTokenRecord(rows[0]) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async deactivateActiveResetTokens(input: DeactivateResetTokensInput) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const rows = await tx
            .update(passwordResetTokens)
            .set({ status: "used", usedAt: now })
            .where(and(eq(passwordResetTokens.userId, input.userId), eq(passwordResetTokens.status, "active")))
            .returning();
          return rows.length;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async createResetToken(input: CreateResetTokenInput) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const tokenId = input.tokenId ?? randomUUID();
          const inserted = await tx
            .insert(passwordResetTokens)
            .values({
              tokenId,
              userId: input.userId,
              username: input.username,
              tokenHash: input.tokenHash,
              status: "active",
              createdAt: now,
              expiresAt: new Date(now.getTime() + input.ttlMs),
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            return { created: true, record: toResetTokenRecord(inserted[0]) };
          }
          // 幂等消歧：按主键重查（token_hash 唯一索引冲突同样落此分支）
          const [existing] = await tx
            .select()
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenId, tokenId));
          if (existing) {
            return { created: false, record: toResetTokenRecord(existing) };
          }
          throw new AuthStoreError("AUTH_STORE_INTERNAL", "reset token insert conflict unresolved");
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async consumeResetToken(input: ConsumeResetTokenInput) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const rows = await tx
            .update(passwordResetTokens)
            .set({ status: "used", usedAt: now })
            .where(
              and(
                eq(passwordResetTokens.tokenId, input.tokenId),
                eq(passwordResetTokens.status, "active"),
                gt(passwordResetTokens.expiresAt, now),
              ),
            )
            .returning();
          return rows[0] ? toResetTokenRecord(rows[0]) : null;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
