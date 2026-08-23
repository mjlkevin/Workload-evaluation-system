// ============================================================
// Teams 域仓储（阶段 2 批 7 · 第 1–3 步）
// ============================================================
// 纯数据访问层：JSON 文件实现（既有语义原样保留，第 4 步删除）+
// PG 实现（team-pg.repository.ts，五范式）+ 选择器路由。
// 不涉及业务逻辑，不包含权限校验。
//
// 公开函数签名不变（调用点零改动）：选择器透明委托
// （WES_STORE_TEAMS_PG 严格 === "true" 切 PG，缺省 JSON）。
// team.usecase.ts 的整存 RMW 调用链（load → 内存改写 →
// saveTeamStoreWithExpectedVersion）在两种实现下语义一致：
// JSON 侧「读版本 → 比较 → 写」三步，PG 侧整体下沉进单条条件
// UPDATE CAS（§4.6 规则，见 team-pg.repository.ts 头部）。
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveRootDir } from "../../utils/file";
import { createTeamPgRepository, type TeamStoreRepository } from "./team-pg.repository";
import { TeamAuditLog, TeamRecord, TeamStore } from "./team.types";

export type { TeamStoreRepository, TeamsPgRepository } from "./team-pg.repository";
export { TeamStoreError, createTeamPgRepository, cleanupTeamRowsByPrefix } from "./team-pg.repository";

// ============================================================
// 遗留 JSON 实现（§5.1 遗留模式：读失败静默空库、缺文件建默认写回；
// 勿复制到新实现；第 4 步删除）
// ============================================================

function teamStorePath(): string {
  return path.resolve(resolveRootDir(), "config/teams/store.json");
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

async function loadTeamStoreJson(): Promise<TeamStore> {
  const filePath = teamStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: TeamStore = {
      version: 0,
      teams: [],
      reviews: [],
      comments: [],
      planBindings: [],
      auditLogs: []
    };
    writeJsonAtomic(filePath, initStore);
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as TeamStore;
    return {
      version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 0,
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      planBindings: Array.isArray(parsed.planBindings) ? parsed.planBindings : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : []
    };
  } catch {
    return { version: 0, teams: [], reviews: [], comments: [], planBindings: [], auditLogs: [] };
  }
}

async function saveTeamStoreJson(store: TeamStore): Promise<void> {
  writeJsonAtomic(teamStorePath(), store);
}

async function saveTeamStoreWithExpectedVersionJson(
  store: TeamStore,
  expectedVersion: number
): Promise<{ ok: true; savedVersion: number } | { ok: false; currentVersion: number }> {
  // 乐观并发语义：读取版本与写入之间为同步顺序执行（readFileSync + writeFileSync），
  // 补 await 不在二者之间插入新的让出点——load 仍是同步文件读（仅签名包 Promise）。
  const current = await loadTeamStoreJson();
  if (current.version !== expectedVersion) {
    return { ok: false, currentVersion: current.version };
  }
  const nextVersion = expectedVersion + 1;
  writeJsonAtomic(teamStorePath(), { ...store, version: nextVersion });
  return { ok: true, savedVersion: nextVersion };
}

function createTeamJsonRepository(): TeamStoreRepository {
  return {
    loadStore: loadTeamStoreJson,
    saveStore: saveTeamStoreJson,
    saveStoreWithExpectedVersion: saveTeamStoreWithExpectedVersionJson
  };
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: TeamStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getTeamRepository(): TeamStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_TEAMS_PG === "true" ? createTeamPgRepository() : createTeamJsonRepository();
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
 * 阶段 2 批 7：实现改经选择器（缺省 JSON / WES_STORE_TEAMS_PG=true 切 PG）。
 */
export async function loadTeamStore(): Promise<TeamStore> {
  return getTeamRepository().loadStore();
}

/**
 * 阶段 2 批 7：实现改经选择器（缺省 JSON / WES_STORE_TEAMS_PG=true 切 PG）。
 */
export async function saveTeamStore(store: TeamStore): Promise<void> {
  return getTeamRepository().saveStore(store);
}

/**
 * 阶段 2 批 7：实现改经选择器（缺省 JSON / WES_STORE_TEAMS_PG=true 切 PG）。
 * 乐观并发语义两种实现一致：JSON 侧「读→比→写」同步三步；
 * PG 侧单条条件 UPDATE CAS（比较+递增原子完成，冲突事务回滚）。
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
