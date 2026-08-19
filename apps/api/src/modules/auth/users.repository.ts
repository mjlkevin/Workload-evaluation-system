// ============================================================
// Users 域仓储（阶段 2 批 2 · 登录热路径）
// ============================================================
// 批 1 试点结论复用：整存 load→改→save 无法表达幂等插入（范式 #2）与
// 条件 UPDATE CAS（范式 #3），接口收敛为行级操作。JSON 实现为既有
// loadUsersStore/saveUsersStore 的行级封装（遗留语义原样保留，包括整存
// RMW 的丢失更新窗口——切换观察期结束、第 4 步删除 JSON 路径后消解）。
//
// 选择器落本文件而非 module barrel：middleware/auth.ts 反向引用本文件，
// 放 barrel 会形成 CJS 循环依赖（批 1 教训）。

import { AuthUser, BusinessRole, UsersStore } from "../../types";
import { createUsersPgRepository } from "./users-pg.repository";

// ============================================================
// 输入类型
// ============================================================

export type CreateUserInput = {
  /** 幂等键（调用方生成 uuid） */
  id: string;
  username: string;
  passwordHash: string;
  role: AuthUser["role"];
  businessRole?: BusinessRole;
  /** 仅供测试注入确定性时钟；生产不传（DB 时钟，范式 #4） */
  now?: Date;
};

export type UpdateUserStatusInput = { id: string; status: "active" | "disabled"; now?: Date };
export type UpdateUserRoleInput = { id: string; role: AuthUser["role"]; now?: Date };
export type UpdateUserBusinessRoleInput = { id: string; businessRole: BusinessRole; now?: Date };
export type UpdateUserPasswordHashInput = { id: string; passwordHash: string; now?: Date };
export type TouchLastLoginInput = { id: string; now?: Date };

export type RegisterWithInviteCodeInput = {
  username: string;
  passwordHash: string;
  /** 大写归一化后的邀请码（事务内 CAS 消费） */
  inviteCode: string;
  now?: Date;
};

export type RegisterWithInviteCodeResult =
  /** 成功：邀请码消费与用户插入同事务提交 */
  | { outcome: "created"; user: AuthUser }
  /** 邀请码不存在/已使用 */
  | { outcome: "invite_invalid" }
  /** 用户名冲突：事务回滚，邀请码未被消费（消除浪费码窗口，§4.4） */
  | { outcome: "username_exists" };

// ============================================================
// 仓储接口（行级）
// ============================================================

export interface UsersStoreRepository {
  listUsers(): Promise<AuthUser[]>;
  findUserById(id: string): Promise<AuthUser | null>;
  /** 大小写不敏感 */
  findUserByUsername(username: string): Promise<AuthUser | null>;
  countUsers(): Promise<number>;
  /** 幂等插入：同 id 或 username 冲突重放返回原记录（created=false） */
  createUser(input: CreateUserInput): Promise<{ created: boolean; user: AuthUser }>;
  /** 行级更新：用户存在返回更新后记录；不存在返回 null */
  updateUserStatus(input: UpdateUserStatusInput): Promise<AuthUser | null>;
  updateUserRole(input: UpdateUserRoleInput): Promise<AuthUser | null>;
  updateUserBusinessRole(input: UpdateUserBusinessRoleInput): Promise<AuthUser | null>;
  updateUserPasswordHash(input: UpdateUserPasswordHashInput): Promise<AuthUser | null>;
  touchLastLogin(input: TouchLastLoginInput): Promise<AuthUser | null>;
  /**
   * 批 2 附带改造项（§4.4）：邀请码 CAS + 用户插入同事务。
   * 仅 PG 实现提供（JSON 无法跨文件事务）；调用方以能力探测分流。
   */
  registerWithInviteCode?(input: RegisterWithInviteCodeInput): Promise<RegisterWithInviteCodeResult>;
}

// ============================================================
// JSON 实现（遗留语义原样：整存 RMW；§5.1 遗留模式，勿复制）
// ============================================================

/**
 * 惰性引用 middleware/auth.ts 的 load/save accessor，避免模块顶层
 * 循环依赖（middleware/auth.ts 导入本文件的选择器）。
 */
function authMiddleware() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../middleware/auth") as typeof import("../../middleware/auth");
}

function normalizeRole(role: string): AuthUser["role"] {
  return role === "admin" || role === "sub_admin" ? role : "user";
}

export function createUsersJsonRepository(): UsersStoreRepository {
  return {
    async listUsers() {
      const store = await authMiddleware().loadUsersStore();
      return store.users;
    },

    async findUserById(id) {
      const store = await authMiddleware().loadUsersStore();
      return store.users.find((user) => user.id === id) ?? null;
    },

    async findUserByUsername(username) {
      const store = await authMiddleware().loadUsersStore();
      const normalized = username.toLowerCase();
      return store.users.find((user) => user.username.toLowerCase() === normalized) ?? null;
    },

    async countUsers() {
      const store = await authMiddleware().loadUsersStore();
      return store.users.length;
    },

    async createUser(input) {
      const { loadUsersStore, saveUsersStore } = authMiddleware();
      const store = await loadUsersStore();
      const existing =
        store.users.find((user) => user.id === input.id) ??
        store.users.find((user) => user.username.toLowerCase() === input.username.toLowerCase());
      if (existing) {
        return { created: false, user: existing };
      }
      const nowIso = (input.now ?? new Date()).toISOString();
      const user: AuthUser = {
        id: input.id,
        username: input.username,
        passwordHash: input.passwordHash,
        role: normalizeRole(input.role),
        businessRole: input.businessRole,
        status: "active",
        createdAt: nowIso,
        lastLoginAt: nowIso,
      };
      store.users.push(user);
      await saveUsersStore(store);
      return { created: true, user };
    },

    async updateUserStatus(input) {
      return mutateUser(input.id, (user) => {
        user.status = input.status;
      });
    },

    async updateUserRole(input) {
      return mutateUser(input.id, (user) => {
        user.role = input.role;
      });
    },

    async updateUserBusinessRole(input) {
      return mutateUser(input.id, (user) => {
        user.businessRole = input.businessRole;
      });
    },

    async updateUserPasswordHash(input) {
      return mutateUser(input.id, (user) => {
        user.passwordHash = input.passwordHash;
      });
    },

    async touchLastLogin(input) {
      return mutateUser(input.id, (user) => {
        user.lastLoginAt = (input.now ?? new Date()).toISOString();
      });
    },
  };

  async function mutateUser(id: string, mutate: (user: AuthUser) => void): Promise<AuthUser | null> {
    const { loadUsersStore, saveUsersStore } = authMiddleware();
    const store = await loadUsersStore();
    const target = store.users.find((user) => user.id === id);
    if (!target) return null;
    mutate(target);
    await saveUsersStore(store);
    return target;
  }
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: UsersStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getUsersRepository(): UsersStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_USERS_PG === "true"
        ? createUsersPgRepository()
        : createUsersJsonRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetUsersRepositoryForTest(): void {
  defaultRepo = null;
}

export type { UsersStore };
