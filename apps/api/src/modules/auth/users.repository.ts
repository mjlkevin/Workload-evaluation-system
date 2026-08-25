// ============================================================
// Users 域仓储（阶段 2 批 2 · 登录热路径）
// ============================================================
// 批 1 试点结论复用：整存 load→改→save 无法表达幂等插入（范式 #2）与
// 条件 UPDATE CAS（范式 #3），接口收敛为行级操作。
//
// S1（2026-08-25，阶段 2 第 4 步）：JSON 实现与选择器 JSON 分支已删除——
// users 域恒 PG（WES_STORE_USERS_PG 开关保留至 S7 统一退役）。
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
// 选择器（S1 后恒 PG；开关保留至 S7 统一退役）
// ============================================================

let defaultRepo: UsersStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getUsersRepository(): UsersStoreRepository {
  if (!defaultRepo) {
    defaultRepo = createUsersPgRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetUsersRepositoryForTest(): void {
  defaultRepo = null;
}

export type { UsersStore };
