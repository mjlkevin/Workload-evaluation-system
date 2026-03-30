import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveRootDir } from "../../utils/file";
import { TeamAuditLog, TeamStore } from "./team.types";

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

export function loadTeamStore(): TeamStore {
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

export function saveTeamStore(store: TeamStore): void {
  const filePath = teamStorePath();
  writeJsonAtomic(filePath, store);
}

export function saveTeamStoreWithExpectedVersion(
  store: TeamStore,
  expectedVersion: number
): { ok: true; savedVersion: number } | { ok: false; currentVersion: number } {
  const filePath = teamStorePath();
  const current = loadTeamStore();
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
