// ============================================================
// 测试基建：users 域 PG 测试用户池（S1 后统一注入/清理模式）
// ============================================================
// 阶段 2 S1（2026-08-25）删除 JSON 路径后，测试不再能向 users.json 注入
// 临时用户（loadUsersStore/saveUsersStore 已删除），统一改为
// getUsersRepository().createUser() 注入 PostgreSQL，after 按 username
// 条件 DELETE（数据集隔离 C5；wes- 前缀防误删真实用户）。每个测试文件
// 使用独立前缀（wes-<file>-），node:test 按文件分进程，互不干扰。
//
// 用法：
//   before(async () => { admin = await createTestUser("wes-foo-admin", { role: "admin" }); });
//   after(async () => { await cleanupTestUsers("wes-foo"); });
//
// 无 DB 环境（本地未设 TEST_DATABASE_URL）：调用方按 §4.6/C4 诚实 skip
// 模板先检查 testDatabaseUrl，本 helper 不自行吞错（createUser 抛错即测试
// 装配失败，不允许静默空跑）。

import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";

import { getUsersRepository } from "../modules/auth/users.repository";
import type { UsersPgRepository } from "../modules/auth/users-pg.repository";
import { users } from "../db/schema";
import type { AuthUser } from "../types";

/** 注入测试用户；随机 username 保证幂等（同 id/username 冲突重放返回原记录）。
 * 注意：PG users.user_id 是 uuid 列，id 必须为合法 UUID——默认即 randomUUID；
 * overrides.id 仅在调用方保证 uuid 合法时使用（如固定用户场景），
 * username 可为任意文本（text 列），需配合 cleanupOneTestUser 先清后建。 */
export async function createTestUser(
  prefix: string,
  overrides: Partial<AuthUser> = {},
): Promise<AuthUser> {
  const uniqueId = randomUUID();
  const repo = getUsersRepository();
  const result = await repo.createUser({
    id: overrides.id ?? uniqueId,
    username: overrides.username ?? `${prefix}-${uniqueId}`,
    passwordHash: overrides.passwordHash ?? "",
    role: overrides.role ?? "user",
    ...(overrides.businessRole ? { businessRole: overrides.businessRole } : {}),
  });
  return result.user;
}

/** 清理单个确定性 username 的测试用户（跨用例固定用户名场景） */
export async function cleanupOneTestUser(username: string): Promise<void> {
  const repo = getUsersRepository() as UsersPgRepository;
  await repo.__dbForTest().delete(users).where(eq(users.username, username));
  repo.resetUsersCache();
}

/** 按前缀清理测试用户池（after 中调用）；条件删除不触碰真实用户 */
export async function cleanupTestUsers(prefix: string): Promise<void> {
  const repo = getUsersRepository() as UsersPgRepository;
  await repo.__dbForTest().delete(users).where(like(users.username, `${prefix}-%`));
  repo.resetUsersCache();
}
