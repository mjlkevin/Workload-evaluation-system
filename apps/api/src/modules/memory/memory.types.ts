// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.types — 领域类型与校验（纯 TS，无 zod 依赖）
// ============================================================

export const MEMORY_STATUSES = ["draft", "active", "archived"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_SOURCE_TYPES = ["distill", "manual"] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

// ---------- L1 原子事实 ----------

export type MemoryAtom = {
  memoryAtomId: string;
  ownerUserId: string;
  projectId: string;
  harnessRunId: string;
  sourceType: MemorySourceType;
  factText: string;
  factKey: string;
  confidence: number;
  status: MemoryStatus;
  metadata: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
  confirmedAt?: Date | string | null;
  archivedAt?: Date | string | null;
};

// ---------- L2 场景块 ----------

export type MemoryScene = {
  memorySceneId: string;
  ownerUserId: string;
  projectId: string;
  harnessRunId: string;
  sourceType: MemorySourceType;
  sceneTitle: string;
  sceneSummary: string;
  atomIds: string[];
  status: MemoryStatus;
  metadata: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
  confirmedAt?: Date | string | null;
  archivedAt?: Date | string | null;
};

// ---------- 蒸馏输出（Kimi Provider 返回） ----------

export type DistillAtom = {
  factKey: string;
  factText: string;
  confidence?: number;
};

export type DistillScene = {
  sceneTitle: string;
  sceneSummary: string;
  atomKeys: string[];
};

export type DistillOutput = {
  atoms: DistillAtom[];
  scenes: DistillScene[];
};

// ---------- 查询参数 ----------

export type ListMemoryQuery = {
  projectId?: string;
  status?: MemoryStatus;
  sourceType?: MemorySourceType;
  page: number;
  pageSize: number;
};

// ---------- 动作输入 ----------

export type ConfirmMemoryInput = {
  memoryIds: string[];
};

export type ArchiveMemoryInput = {
  memoryIds: string[];
};

// ---------- 记忆上下文块 ----------

export type MemoryContextBlock = {
  scenes: { title: string; summary: string }[];
  atoms: { factKey: string; factText: string }[];
};

// ---------- 简单校验函数（替代 zod safeParse） ----------

export type ValidationResult<T> = { success: true; data: T } | { success: false; error: string };

function isMemoryStatus(v: unknown): v is MemoryStatus {
  return typeof v === "string" && (MEMORY_STATUSES as readonly string[]).includes(v);
}

function isMemorySourceType(v: unknown): v is MemorySourceType {
  return typeof v === "string" && (MEMORY_SOURCE_TYPES as readonly string[]).includes(v);
}

export function validateDistillOutput(raw: unknown): ValidationResult<DistillOutput> {
  if (!raw || typeof raw !== "object") return { success: false, error: "not_an_object" };
  const obj = raw as Record<string, unknown>;
  if (obj.atoms !== undefined && !Array.isArray(obj.atoms)) return { success: false, error: "atoms_not_array" };
  if (obj.scenes !== undefined && !Array.isArray(obj.scenes)) return { success: false, error: "scenes_not_array" };
  const atomsRaw = Array.isArray(obj.atoms) ? obj.atoms : [];
  const scenesRaw = Array.isArray(obj.scenes) ? obj.scenes : [];

  const atoms: DistillAtom[] = [];
  for (const a of atomsRaw.slice(0, 50)) {
    const ar = a as Record<string, unknown>;
    const factKey = typeof ar.factKey === "string" ? ar.factKey : "";
    const factText = typeof ar.factText === "string" ? ar.factText : "";
    if (!factKey || !factText) continue;
    const confidence = typeof ar.confidence === "number" ? Math.max(0, Math.min(100, Math.round(ar.confidence))) : 80;
    atoms.push({ factKey, factText, confidence });
  }

  const scenes: DistillScene[] = [];
  for (const s of scenesRaw.slice(0, 20)) {
    const sr = s as Record<string, unknown>;
    const sceneTitle = typeof sr.sceneTitle === "string" ? sr.sceneTitle : "";
    const sceneSummary = typeof sr.sceneSummary === "string" ? sr.sceneSummary : "";
    if (!sceneTitle || !sceneSummary) continue;
    const atomKeys = Array.isArray(sr.atomKeys) ? sr.atomKeys.filter((k): k is string => typeof k === "string") : [];
    scenes.push({ sceneTitle, sceneSummary, atomKeys });
  }

  return { success: true, data: { atoms, scenes } };
}

export function validateListMemoryQuery(raw: unknown): ValidationResult<ListMemoryQuery> {
  if (!raw || typeof raw !== "object") return { success: false, error: "not_an_object" };
  const obj = raw as Record<string, unknown>;
  const projectId = typeof obj.projectId === "string" && obj.projectId.length > 0 ? obj.projectId : undefined;
  const status = isMemoryStatus(obj.status) ? obj.status : undefined;
  const sourceType = isMemorySourceType(obj.sourceType) ? obj.sourceType : undefined;
  const pageNum = Number(obj.page ?? 1);
  const pageSizeNum = Number(obj.pageSize ?? 20);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
  const pageSize = Number.isFinite(pageSizeNum) && pageSizeNum >= 1 ? Math.min(100, Math.floor(pageSizeNum)) : 20;
  return { success: true, data: { projectId, status, sourceType, page, pageSize } };
}

export function validateMemoryIdsInput(raw: unknown): ValidationResult<ConfirmMemoryInput> {
  if (!raw || typeof raw !== "object") return { success: false, error: "not_an_object" };
  const obj = raw as Record<string, unknown>;
  const memoryIds = Array.isArray(obj.memoryIds) ? obj.memoryIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (memoryIds.length === 0) return { success: false, error: "memoryIds_empty" };
  return { success: true, data: { memoryIds } };
}
