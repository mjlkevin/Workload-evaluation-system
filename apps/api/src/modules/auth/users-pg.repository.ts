// ============================================================
// Users 域 PG 仓储（阶段 2 批 2 · 登录热路径）
// ============================================================
// 五条硬性范式落实（批 1 基准，harness 同源）：
//  1. 错误边界：UsersStoreError（稳定 code），每个公开方法 try/catch 后经
//     toSafeError 收敛；pg/drizzle 原始错误（可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：onConflictDoNothing().returning() + 空结果时按主键/唯一键重查消歧。
//  3. 并发控制：条件 UPDATE ... RETURNING 行级原子更新，空结果即目标不存在；
//     彻底消除 JSON 整存 RMW 的跨用户丢失更新（并发写不同用户互不覆盖）。
//  4. 时间：一律 readDbNow(tx)（DB 时钟），禁止 Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错，禁止返回空集合。
//
// 写穿缓存（性能要求：requireAuth 全 API 热路径不得每请求裸查 PG）：
//  - 范式对齐 modules/system/credentials.store.ts 的写穿缓存（模块级 Map +
//    每次读写后更新）；此处为实例级闭包 Map，生产装配为记忆化单例后语义
//    等价，且测试可持有独立实例互不污染。
//  - 冷启动首次读全表（users 规模 ~40 行）填充；其后全部读路径命中缓存，
//    认证请求零 DB 往返。
//  - 失效时机：任何写路径（状态/角色/业务角色/密码/lastLogin/新增用户）
//    落库成功后立即写穿更新缓存——本副本内不存在失效窗口；
//    resetUsersCache() 供测试与运维强制回源。
//  - 有界 TTL（防御性改造，架构侧 2026-08-19 建议）：缓存满 cacheTtlMs
//    （缺省 60s）后下一次读回源重建。代价为每进程每 TTL 一次全表查询
//    （~40 行，毫秒级），把多副本失效模式从「永久分歧」降级为「短暂陈旧」。
//    TTL 判定用主机时钟（非持久化用途，不违反范式 #4——该范式只约束落库时间）。
//  - 多副本部署：写副本立即一致，其余副本最长滞后一个 TTL（≤60s）后自愈；
//    旧版本无 TTL 时是永久分歧（副本 B 注册的用户在副本 A 永远查不到，
//    直至重启）。部署约束已同步写入 docs/DEPLOYMENT.md。

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { inviteCodes, users } from "../../db/schema";
import { AuthUser, BusinessRole } from "../../types";
import type {
  CreateUserInput,
  RegisterWithInviteCodeInput,
  RegisterWithInviteCodeResult,
  TouchLastLoginInput,
  UpdateUserBusinessRoleInput,
  UpdateUserPasswordHashInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
  UsersStoreRepository,
} from "./users.repository";

// ============================================================
// 安全错误
// ============================================================

export class UsersStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "UsersStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): UsersStoreError {
  if (err instanceof UsersStoreError) return err;
  return new UsersStoreError("USERS_STORE_INTERNAL", "users store persistence failed");
}

// ============================================================
// 行 ↔ 记录映射（PG timestamptz → ISO 字符串契约）
// ============================================================

type UserRow = typeof users.$inferSelect;

function normalizeRole(role: string): AuthUser["role"] {
  return role === "admin" || role === "sub_admin" ? role : "user";
}

function isBusinessRoleValue(value: string): value is BusinessRole {
  return ["sales", "pre_sales", "delivery", "pm", "pmo", "dev", "admin"].includes(value);
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.userId,
    username: row.username,
    passwordHash: row.passwordHash,
    role: normalizeRole(row.role),
    businessRole: isBusinessRoleValue(row.businessRole) ? row.businessRole : undefined,
    status: row.status as AuthUser["status"],
    createdAt: row.createdAt.toISOString(),
    // PG 列可空（历史行），契约要求 string → 回落 createdAt
    lastLoginAt: (row.lastLoginAt ?? row.createdAt).toISOString(),
  };
}

// ============================================================
// 工厂与接口
// ============================================================

export interface UsersPgRepository extends UsersStoreRepository {
  /** 测试钩子：暴露注入的 db 实例供用例做行级清理 */
  __dbForTest(): Database;
  /** 显式失效缓存（测试/运维强制回源） */
  resetUsersCache(): void;
  registerWithInviteCode(input: RegisterWithInviteCodeInput): Promise<RegisterWithInviteCodeResult>;
}

/** 事务内回滚哨兵（用户名冲突），toSafeError 不透传 */
class UsernameConflictSentinel extends Error {
  constructor() {
    super("username_conflict");
    this.name = "UsernameConflictSentinel";
  }
}

/** 缓存 TTL 缺省值：每进程每 60s 最多一次全表回源 */
export const USERS_CACHE_TTL_MS = 60_000;

export function createUsersPgRepository(
  dbInstance: Database = db,
  cacheTtlMs: number = USERS_CACHE_TTL_MS,
  now: () => number = Date.now,
): UsersPgRepository {
  // 写穿缓存：null = 冷（未加载）；非 null = 热（读路径不再回源，直至 TTL 到期）
  let cache: Map<string, AuthUser> | null = null;
  let cacheLoadedAt = 0;

  function writeThrough(user: AuthUser): void {
    cache?.set(user.id, user);
  }

  async function loadAll(): Promise<AuthUser[]> {
    // 范式 #5：读取失败由调用方法统一 toSafeError 抛出，禁止静默空集合
    const rows = await dbInstance.select().from(users);
    const loaded = rows.map(toAuthUser);
    cache = new Map(loaded.map((user) => [user.id, user]));
    cacheLoadedAt = now(); // 主机时钟仅用于 TTL 判定，不落库
    return loaded;
  }

  async function ensureLoaded(): Promise<Map<string, AuthUser>> {
    if (!cache || now() - cacheLoadedAt >= cacheTtlMs) await loadAll();
    return cache!;
  }

  return {
    __dbForTest() {
      return dbInstance;
    },

    resetUsersCache() {
      cache = null;
    },

    async listUsers() {
      try {
        return [...(await ensureLoaded()).values()];
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findUserById(id) {
      try {
        return (await ensureLoaded()).get(id) ?? null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findUserByUsername(username) {
      try {
        const normalized = username.toLowerCase();
        for (const user of (await ensureLoaded()).values()) {
          if (user.username.toLowerCase() === normalized) return user;
        }
        return null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async countUsers() {
      try {
        return (await ensureLoaded()).size;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async createUser(input: CreateUserInput) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const inserted = await tx
            .insert(users)
            .values({
              userId: input.id,
              username: input.username,
              passwordHash: input.passwordHash,
              role: input.role,
              businessRole: input.businessRole ?? "pre_sales",
              status: "active",
              createdAt: now,
              lastLoginAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            const user = toAuthUser(inserted[0]);
            writeThrough(user);
            return { created: true, user };
          }
          // 幂等消歧：插入被跳过（id 或 username 冲突）→ 重查返回原记录
          const [byId] = await tx.select().from(users).where(eq(users.userId, input.id));
          if (byId) {
            const user = toAuthUser(byId);
            writeThrough(user);
            return { created: false, user };
          }
          const [byName] = await tx
            .select()
            .from(users)
            .where(sql`lower(${users.username}) = ${input.username.toLowerCase()}`);
          if (byName) {
            const user = toAuthUser(byName);
            writeThrough(user);
            return { created: false, user };
          }
          throw new UsersStoreError("USERS_STORE_INTERNAL", "user insert conflict unresolved");
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async updateUserStatus(input: UpdateUserStatusInput) {
      return updateRow(input.id, (tx, now) =>
        tx
          .update(users)
          .set({ status: input.status, updatedAt: now })
          .where(eq(users.userId, input.id))
          .returning(),
      );
    },

    async updateUserRole(input: UpdateUserRoleInput) {
      return updateRow(input.id, (tx, now) =>
        tx
          .update(users)
          .set({ role: input.role, updatedAt: now })
          .where(eq(users.userId, input.id))
          .returning(),
      );
    },

    async updateUserBusinessRole(input: UpdateUserBusinessRoleInput) {
      return updateRow(input.id, (tx, now) =>
        tx
          .update(users)
          .set({ businessRole: input.businessRole, updatedAt: now })
          .where(eq(users.userId, input.id))
          .returning(),
      );
    },

    async updateUserPasswordHash(input: UpdateUserPasswordHashInput) {
      return updateRow(input.id, (tx, now) =>
        tx
          .update(users)
          .set({ passwordHash: input.passwordHash, updatedAt: now })
          .where(eq(users.userId, input.id))
          .returning(),
      );
    },

    async touchLastLogin(input: TouchLastLoginInput) {
      return updateRow(input.id, (tx, now) =>
        tx
          .update(users)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(users.userId, input.id))
          .returning(),
      );
    },

    /**
     * 批 2 附带改造项（§4.4）：邀请码 CAS + 用户插入同事务。
     * 用户名冲突 → 抛哨兵回滚整个事务，邀请码消费一并撤销——
     * 消除批 1 CAS-first 混合状态下「浪费一张码」的窗口。
     */
    async registerWithInviteCode(input: RegisterWithInviteCodeInput): Promise<RegisterWithInviteCodeResult> {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const userId = randomUUID();
          const username = input.username;

          // 首个注册用户为 admin（与 JSON 流程同口径；事务内计数一致快照）
          const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
          const role: AuthUser["role"] = Number(countRow?.count ?? 0) === 0 ? "admin" : "user";
          const businessRole: BusinessRole = role === "admin" ? "admin" : "pre_sales";

          // ① 邀请码 CAS：仅 active 可消费（范式 #3）
          const consumed = await tx
            .update(inviteCodes)
            .set({ status: "used", usedAt: now, usedByUserId: userId, usedByUsername: username })
            .where(and(sql`upper(${inviteCodes.code}) = ${input.inviteCode.toUpperCase()}`, eq(inviteCodes.status, "active")))
            .returning();
          if (consumed.length === 0) {
            return { outcome: "invite_invalid" as const };
          }

          // ② 用户插入：username 唯一约束冲突 → 哨兵回滚（邀请码消费一并撤销）
          const inserted = await tx
            .insert(users)
            .values({
              userId,
              username,
              passwordHash: input.passwordHash,
              role,
              businessRole,
              status: "active",
              createdAt: now,
              lastLoginAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length === 0) {
            throw new UsernameConflictSentinel();
          }

          const user = toAuthUser(inserted[0]);
          writeThrough(user);
          return { outcome: "created" as const, user };
        });
      } catch (err) {
        if (err instanceof UsernameConflictSentinel) {
          return { outcome: "username_exists" };
        }
        throw toSafeError(err);
      }
    },
  };

  /** 行级条件 UPDATE RETURNING：空结果即目标不存在（范式 #3）；成功后写穿缓存 */
  async function updateRow(
    id: string,
    run: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0], now: Date) => Promise<UserRow[]>,
  ): Promise<AuthUser | null> {
    try {
      return await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const rows = await run(tx, now);
        if (rows.length === 0) return null;
        const user = toAuthUser(rows[0]);
        writeThrough(user);
        return user;
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }
}
