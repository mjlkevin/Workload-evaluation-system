import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { InviteCodeRecord, InviteCodesStore, PasswordResetTokenRecord, PasswordResetTokensStore } from "../../types";
import { inviteCodesStorePath, passwordResetTokensStorePath } from "../../utils";
import { createAuthPgRepository } from "./auth-pg.repository";

// ============================================================
// 仓储接口（阶段 2 批 1 · 试点确立的行级范式）
// ============================================================
// 试点结论：整存 load→改→save 无法表达幂等插入（范式 #2）与条件 UPDATE
// CAS（范式 #3），故接口收敛为行级操作；JSON/PG 双实现同构，选择器切换。
// now? 参数仅供测试注入确定性时钟，生产路径不传（对齐 harness input.now 口径）。

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
// JSON 遗留 accessor（阶段 1 批 3 异步化签名；阶段 2 批 1 起被选择器隔离）
// ============================================================
// 【遗留模式，勿复制】读取失败/结构非法时静默返回空库——该模式在 PG 实现
// 中被 ISS-2026-08-18-004 禁止（读取失败必须抛错）。保留仅为回滚路径。

/**
 * 阶段 1 批 3：签名改 async（Promise<InviteCodesStore>），函数体一字未动。
 */
export async function loadInviteCodesStore(): Promise<InviteCodesStore> {
  const filePath = inviteCodesStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: InviteCodesStore = { codes: [] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as InviteCodesStore;
    if (!parsed || !Array.isArray(parsed.codes)) {
      return { codes: [] };
    }
    return { codes: parsed.codes };
  } catch {
    return { codes: [] };
  }
}

/**
 * 阶段 1 批 3：签名改 async（Promise<void>），函数体一字未动。
 */
export async function saveInviteCodesStore(store: InviteCodesStore): Promise<void> {
  const filePath = inviteCodesStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * 阶段 1 批 3：签名改 async（Promise<PasswordResetTokensStore>），函数体一字未动。
 */
export async function loadPasswordResetTokensStore(): Promise<PasswordResetTokensStore> {
  const filePath = passwordResetTokensStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: PasswordResetTokensStore = { tokens: [] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PasswordResetTokensStore;
    if (!parsed || !Array.isArray(parsed.tokens)) {
      return { tokens: [] };
    }
    return { tokens: parsed.tokens };
  } catch {
    return { tokens: [] };
  }
}

/**
 * 阶段 1 批 3：签名改 async（Promise<void>），函数体一字未动。
 */
export async function savePasswordResetTokensStore(store: PasswordResetTokensStore): Promise<void> {
  const filePath = passwordResetTokensStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

// ============================================================
// JSON 实现（回滚路径：包装既有整存 accessor，行为与切换前对等）
// ============================================================
// 说明：JSON 侧无行级原子性，CAS 类方法以「先查后改」尽力模拟（与切换前
// 的无锁 RMW 语义一致，竞争窗口原样保留）；真正的并发安全由 PG 实现提供。

function cloneInviteCode(record: InviteCodeRecord): InviteCodeRecord {
  return { ...record };
}

function cloneResetToken(record: PasswordResetTokenRecord): PasswordResetTokenRecord {
  return { ...record };
}

export function createAuthJsonRepository(): AuthStoreRepository {
  return {
    async listInviteCodes() {
      const store = await loadInviteCodesStore();
      return store.codes.map(cloneInviteCode);
    },

    async findInviteCode(code) {
      const store = await loadInviteCodesStore();
      const hit = store.codes.find((item) => item.code.toUpperCase() === code.toUpperCase());
      return hit ? cloneInviteCode(hit) : null;
    },

    async createInviteCode(input) {
      const store = await loadInviteCodesStore();
      const existing = store.codes.find((item) => item.code.toUpperCase() === input.code.toUpperCase());
      if (existing) {
        return { created: false, record: cloneInviteCode(existing) };
      }
      const now = input.now ?? new Date();
      const record: InviteCodeRecord = {
        code: input.code,
        status: "active",
        createdAt: now.toISOString(),
      };
      store.codes.push(record);
      await saveInviteCodesStore(store);
      return { created: true, record: cloneInviteCode(record) };
    },

    async markInviteCodeUsed(input) {
      const store = await loadInviteCodesStore();
      const target = store.codes.find(
        (item) => item.code.toUpperCase() === input.code.toUpperCase() && item.status === "active",
      );
      if (!target) return null;
      const now = input.now ?? new Date();
      target.status = "used";
      target.usedAt = now.toISOString();
      target.usedByUserId = input.usedByUserId;
      target.usedByUsername = input.usedByUsername;
      await saveInviteCodesStore(store);
      return cloneInviteCode(target);
    },

    async findResetTokenByHash(tokenHash) {
      const store = await loadPasswordResetTokensStore();
      const hit = store.tokens.find((item) => item.tokenHash === tokenHash);
      return hit ? cloneResetToken(hit) : null;
    },

    async deactivateActiveResetTokens(input) {
      const store = await loadPasswordResetTokensStore();
      const now = input.now ?? new Date();
      let count = 0;
      for (const item of store.tokens) {
        if (item.userId === input.userId && item.status === "active") {
          item.status = "used";
          item.usedAt = now.toISOString();
          count += 1;
        }
      }
      if (count > 0) await savePasswordResetTokensStore(store);
      return count;
    },

    async createResetToken(input) {
      const store = await loadPasswordResetTokensStore();
      const tokenId = input.tokenId ?? randomUUID();
      const existing = store.tokens.find((item) => item.id === tokenId);
      if (existing) {
        return { created: false, record: cloneResetToken(existing) };
      }
      const now = input.now ?? new Date();
      const record: PasswordResetTokenRecord = {
        id: tokenId,
        userId: input.userId,
        username: input.username,
        tokenHash: input.tokenHash,
        status: "active",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
      };
      store.tokens.push(record);
      await savePasswordResetTokensStore(store);
      return { created: true, record: cloneResetToken(record) };
    },

    async consumeResetToken(input) {
      const store = await loadPasswordResetTokensStore();
      const now = input.now ?? new Date();
      const target = store.tokens.find((item) => item.id === input.tokenId);
      if (!target || target.status !== "active" || Number(new Date(target.expiresAt)) <= now.getTime()) {
        return null;
      }
      target.status = "used";
      target.usedAt = now.toISOString();
      await savePasswordResetTokensStore(store);
      return cloneResetToken(target);
    },
  };
}

// ============================================================
// 选择器开关（阶段 2 §3 范式）
// ============================================================
// WES_STORE_AUTH_PG 严格 === "true" 走 PG，缺省 JSON；进程内只读一次。
// 位置说明（试点登记）：计划 §3 示意 selector 位于 <域>.module.ts；auth 域
// handler 为裸函数、module 仅 barrel，若放 barrel 会形成 CJS 循环依赖
// （module → controller → usecase → module），故落 repository 文件，
// 语义（严格 "true"、记忆化单例、调用点经 getAuthRepository() 消费）不变。

let defaultRepo: AuthStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用） */
export function getAuthRepository(): AuthStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_AUTH_PG === "true" ? createAuthPgRepository() : createAuthJsonRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例（选择器用例切换 env 后重新装配） */
export function _resetAuthRepositoryForTest(): void {
  defaultRepo = null;
}
