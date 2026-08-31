// ============================================================
// Teams 域仓储（阶段 2 批 7 建立 · 第 4 步 S5 收敛为恒 PG）
// ============================================================
// 纯数据访问层：本文件不再自带实现，只做单例转发与纯内存 helper
// （PG 实现在 team-pg.repository.ts，五范式）。
// 不涉及业务逻辑，不包含权限校验。
//
// 阶段 2 S5（2026-08-30）：JSON 文件读写路径（loadTeamStoreJson /
// saveTeamStoreJson / saveTeamStoreWithExpectedVersionJson /
// writeJsonAtomic / createTeamJsonRepository）连同 config/teams/store.json
// 一并删除，选择器不再有分流分支（WES_STORE_TEAMS_PG 在本批后续提交里
// 从 ci.yml / .env / 测试开关清单退役；自本提交起它已无可影响的路由分支）。
// 删除理由：九存储域已全部跑在 PostgreSQL 上，JSON 侧只剩「并发写静默丢数据」
// 的历史形态，保留只会提供第二条可达写路径（阶段 2 立项根因）。
//
// 公开函数签名不变（调用点零改动）：team.usecase.ts 的整存 RMW 调用链
// （load → 内存改写 → saveTeamStoreWithExpectedVersion）无需改造；
// 「读版本 → 比较 → 递增」整体下沉进单条条件 UPDATE CAS（§4.6 规则，
// 见 team-pg.repository.ts 头部）。
// ============================================================

import { randomUUID } from "node:crypto";

import { createTeamPgRepository, type TeamStoreRepository } from "./team-pg.repository";
import { TeamAuditLog, TeamRecord, TeamStore } from "./team.types";

export type { TeamStoreRepository, TeamsPgRepository } from "./team-pg.repository";
export { TeamStoreError, createTeamPgRepository, cleanupTeamRowsByPrefix } from "./team-pg.repository";

// ============================================================
// 默认仓储（阶段 2 第 4 步 S5：恒 PG，选择器已无分流分支）
// ============================================================

let defaultRepo: TeamStoreRepository | null = null;

/** 进程内默认 repository 单例（恒 PG）；S5 前依 WES_STORE_TEAMS_PG 分流，现已退役 */
export function getTeamRepository(): TeamStoreRepository {
  if (!defaultRepo) {
    defaultRepo = createTeamPgRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetTeamRepositoryForTest(): void {
  defaultRepo = null;
}

// ============================================================
// 公开 accessor（签名不变，经选择器分流）
// ============================================================

/**
 * 阶段 2 第 4 步 S5：实现恒走 PG 仓储（team-pg.repository.ts）。
 */
export async function loadTeamStore(): Promise<TeamStore> {
  return getTeamRepository().loadStore();
}

/**
 * 阶段 2 第 4 步 S5：实现恒走 PG 仓储；无版本校验的整存替换
 * （六表 TRUNCATE + 全量 INSERT），不触碰 store_versions 版本行。
 */
export async function saveTeamStore(store: TeamStore): Promise<void> {
  return getTeamRepository().saveStore(store);
}

/**
 * 阶段 2 第 4 步 S5：实现恒走 PG 仓储。
 * 乐观并发语义：「读版本 → 比较 → 递增」整体下沉进单条条件 UPDATE CAS，
 * 冲突时事务回滚、结构化返回 {ok:false}（40909 契约与切换前一致）。
 */
export async function saveTeamStoreWithExpectedVersion(
  store: TeamStore,
  expectedVersion: number
): Promise<{ ok: true; savedVersion: number } | { ok: false; currentVersion: number }> {
  return getTeamRepository().saveStoreWithExpectedVersion(store, expectedVersion);
}

export function appendTeamAuditLog(
  store: TeamStore,
  payload: Omit<TeamAuditLog, "auditId" | "at">
): void {
  store.auditLogs.push({
    auditId: randomUUID(),
    at: new Date().toISOString(),
    ...payload
  });
}

/** List teams where the user is the owner or a member */
export function listTeamsByUserId(store: TeamStore, userId: string): TeamRecord[] {
  return store.teams.filter(
    (t) => t.ownerUserId === userId || t.members.some((m) => m.userId === userId)
  );
}
