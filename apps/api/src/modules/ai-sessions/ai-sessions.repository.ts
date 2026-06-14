import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { aiSessionsStorePath } from "../../utils";
import type { AiSessionsStore } from "./ai-sessions.types";

function emptyStore(): AiSessionsStore {
  return { sessions: [] };
}

export function loadAiSessionsStore(): AiSessionsStore {
  const filePath = aiSessionsStorePath();
  if (!existsSync(filePath)) {
    return emptyStore();
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AiSessionsStore>;
  return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
}

export function saveAiSessionsStore(store: AiSessionsStore): void {
  const filePath = aiSessionsStorePath();
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tempPath, filePath);
}
