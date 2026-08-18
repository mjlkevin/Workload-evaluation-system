import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveRootDir } from "../../utils/file";
import { TeamAuditLog, TeamRecord, TeamStore } from "./team.types";

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

/**
 * 阶段 1 批 6：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。
 */
export async function loadTeamStore(): Promise<TeamStore> {
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

/**
 * 阶段 1 批 6：签名改 async，实现不动（仍为 writeFileSync），阶段 2 替换实现。
 */
export async function saveTeamStore(store: TeamStore): Promise<void> {
  const filePath = teamStorePath();
  writeJsonAtomic(filePath, store);
}

/**
 * 阶段 1 批 6：签名改 async（含内部 loadTeamStore 级联），实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。
 * 乐观并发语义：读取版本与写入之间为同步顺序执行（readFileSync + writeFileSync），
 * 补 await 不在二者之间插入新的让出点——loadTeamStore 仍是同步文件读（仅签名包 Promise）。
 */
export async function saveTeamStoreWithExpectedVersion(
  store: TeamStore,
  expectedVersion: number
): Promise<{ ok: true; savedVersion: number } | { ok: false; currentVersion: number }> {
  const filePath = teamStorePath();
  const current = await loadTeamStore();
  if (current.version !== expectedVersion) {
    return { ok: false, currentVersion: current.version };
  }
  const nextVersion = expectedVersion + 1;
  writeJsonAtomic(filePath, { ...store, version: nextVersion });
  return { ok: true, savedVersion: nextVersion };
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
