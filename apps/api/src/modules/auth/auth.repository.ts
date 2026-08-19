import { InviteCodeRecord, PasswordResetTokenRecord } from "../../types";
import { createAuthPgRepository } from "./auth-pg.repository";

// ============================================================
// 仓储接口（阶段 2 批 1 · 试点确立的行级范式）
// ============================================================
// 试点结论：整存 load→改→save 无法表达幂等插入（范式 #2）与条件 UPDATE
// CAS（范式 #3），故接口收敛为行级操作。
// now? 参数仅供测试注入确定性时钟，生产路径不传（对齐 harness input.now 口径）。
//
// 阶段 2 批 1 第 4 步：JSON 读写路径已删除（config/auth/invite-codes.json
// 归档至 99_归档/），PG 为唯一实现，选择器与回滚路径不再保留。

export type CreateInviteCodeInput = { code: string; now?: Date };
export type MarkInviteCodeUsedInput = {
  code: string;
  usedByUserId: string;
  usedByUsername: string;
  now?: Date;
};
export type CreateResetTokenInput = {
  /** 幂等键；缺省由仓储生成 randomUUID */
  tokenId?: string;
  userId: string;
  username: string;
  tokenHash: string;
  /** 有效期（毫秒）；expiresAt = DB 时钟 + ttlMs，禁止调用方传主机时间 */
  ttlMs: number;
  now?: Date;
};
export type DeactivateResetTokensInput = { userId: string; now?: Date };
export type ConsumeResetTokenInput = { tokenId: string; now?: Date };

export interface AuthStoreRepository {
  // ── 邀请码 ──
  listInviteCodes(): Promise<InviteCodeRecord[]>;
  /** 大小写不敏感查找 */
  findInviteCode(code: string): Promise<InviteCodeRecord | null>;
  /** 幂等插入：同码重放返回原记录（created=false） */
  createInviteCode(input: CreateInviteCodeInput): Promise<{ created: boolean; record: InviteCodeRecord }>;
  /** CAS：仅 status='active' 可标记为 used；竞争失败/不存在返回 null */
  markInviteCodeUsed(input: MarkInviteCodeUsedInput): Promise<InviteCodeRecord | null>;
  // ── 密码重置令牌 ──
  findResetTokenByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  /** 作废该用户全部 active 令牌，返回作废条数 */
  deactivateActiveResetTokens(input: DeactivateResetTokensInput): Promise<number>;
  /** 幂等插入：同 tokenId 重放返回原记录（created=false） */
  createResetToken(input: CreateResetTokenInput): Promise<{ created: boolean; record: PasswordResetTokenRecord }>;
  /** CAS：仅 status='active' 且未过期可消费；竞争失败/过期返回 null */
  consumeResetToken(input: ConsumeResetTokenInput): Promise<PasswordResetTokenRecord | null>;
}

// ============================================================
// 默认装配（第 4 步：PG 唯一实现）
// ============================================================

let defaultRepo: AuthStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用） */
export function getAuthRepository(): AuthStoreRepository {
  if (!defaultRepo) {
    defaultRepo = createAuthPgRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetAuthRepositoryForTest(): void {
  defaultRepo = null;
}
