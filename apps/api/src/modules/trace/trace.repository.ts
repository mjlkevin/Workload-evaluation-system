// ============================================================
// RP-030 · Trace Repository（阶段 2 批 5 · 第 1–3 步）
// ============================================================
// 纯数据访问层：JSON 文件实现（既有语义原样保留，第 4 步删除）+
// PG 实现（trace-pg.repository.ts，五范式）+ 选择器路由。
// 不涉及业务逻辑，不包含权限校验。
//
// 公开函数签名不变（调用点零改动）：给定 storePath 强制 JSON 文件
// 路径（既有测试契约，与开关状态无关）；未给定经选择器分流
// （WES_STORE_TRACES_PG 严格 === "true" 切 PG，缺省 JSON）。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TraceQueryFilter, TraceQueryResult, TraceRecord, TraceStore } from "./trace.types";
import { createTracePgRepository, type TraceStoreRepository } from "./trace-pg.repository";

const DEFAULT_STORE: TraceStore = { version: 1, traces: [] };

function resolveStorePath(): string {
  const override = process.env.WES_TRACE_STORE_PATH?.trim();
  if (override) return override;
  // 与 config/ 同级，放在 data/traces/ 下
  const root = process.cwd();
  return join(root, "data", "traces", "trace-store.json");
}

function ensureStoreDir(storePath: string): void {
  const dir = join(storePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readStore(storePath: string): TraceStore {
  if (!existsSync(storePath)) return { ...DEFAULT_STORE, traces: [] };
  try {
    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw) as TraceStore;
    if (!parsed || !Array.isArray(parsed.traces)) return { ...DEFAULT_STORE, traces: [] };
    return parsed;
  } catch {
    return { ...DEFAULT_STORE, traces: [] };
  }
}

function writeStore(storePath: string, store: TraceStore): void {
  ensureStoreDir(storePath);
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}

// ─── 写入 ────────────────────────────────────────────────────

/** JSON 实现（批 5 重命名 *Json 后缀，实现体一字未动；§5.1 遗留模式，勿复制） */
export async function insertTraceRecordJson(record: TraceRecord, storePath?: string): Promise<TraceRecord> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  store.traces.unshift(record); // 最新的在前
  writeStore(path, store);
  return record;
}

/** JSON 实现（批 5 重命名 *Json 后缀，实现体一字未动；§5.1 遗留模式，勿复制） */
export async function updateTraceRecordJson(traceId: string, patch: Partial<TraceRecord>, storePath?: string): Promise<TraceRecord | null> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  const idx = store.traces.findIndex((t) => t.traceId === traceId);
  if (idx < 0) return null;
  store.traces[idx] = { ...store.traces[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(path, store);
  return store.traces[idx];
}

// ─── 查询 ────────────────────────────────────────────────────

/** JSON 实现（批 5 重命名 *Json 后缀，实现体一字未动） */
export async function findTraceByIdJson(traceId: string, storePath?: string): Promise<TraceRecord | null> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  return store.traces.find((t) => t.traceId === traceId) ?? null;
}

/** JSON 实现（批 5 重命名 *Json 后缀，实现体一字未动） */
export async function queryTracesJson(filter: TraceQueryFilter, storePath?: string): Promise<TraceQueryResult> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  const limit = filter.limit ?? 20;
  const offset = filter.offset ?? 0;

  // ownerUserId 为空字符串时跳过 owner 过滤（admin 查全量场景）
  let filtered = filter.ownerUserId
    ? store.traces.filter((t) => t.ownerUserId === filter.ownerUserId)
    : [...store.traces];

  if (filter.sourceDomain) {
    filtered = filtered.filter((t) => t.sourceDomain === filter.sourceDomain);
  }
  if (filter.sourceId) {
    filtered = filtered.filter((t) => t.sourceId === filter.sourceId);
  }
  if (filter.traceId) {
    filtered = filtered.filter((t) => t.traceId === filter.traceId);
  }
  if (filter.hasError === true) {
    filtered = filtered.filter((t) => t.summary.hasError);
  }
  if (filter.hasDegradation === true) {
    filtered = filtered.filter((t) => t.summary.hasDegradation);
  }
  if (filter.fromIso) {
    const from = new Date(filter.fromIso).getTime();
    filtered = filtered.filter((t) => new Date(t.createdAt).getTime() >= from);
  }
  if (filter.toIso) {
    const to = new Date(filter.toIso).getTime();
    filtered = filtered.filter((t) => new Date(t.createdAt).getTime() <= to);
  }
  if (filter.spanType) {
    filtered = filtered.filter((t) => t.spans.some((s) => s.spanType === filter.spanType));
  }

  const total = filtered.length;
  const traces = filtered.slice(offset, offset + limit);

  return { traces, total, limit, offset };
}

/** JSON 实现（批 5 重命名 *Json 后缀，实现体一字未动；内部级联 queryTracesJson） */
export async function listTracesForOwnerJson(ownerUserId: string, opts?: { limit?: number; offset?: number }, storePath?: string): Promise<TraceRecord[]> {
  const result = await queryTracesJson({ ownerUserId, ...opts }, storePath);
  return result.traces;
}

// ─── 清理（retention） ───────────────────────────────────────

/** JSON 实现（批 5 重命名 *Json 后缀，实现体一字未动） */
export async function purgeTracesOlderThanJson(isoDate: string, storePath?: string): Promise<number> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  const cutoff = new Date(isoDate).getTime();
  const before = store.traces.length;
  store.traces = store.traces.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
  const removed = before - store.traces.length;
  if (removed > 0) writeStore(path, store);
  return removed;
}

// ============================================================
// JSON 实现装配（六组 Json 函数原样包装，无逻辑改动）
// ============================================================

export function createTraceJsonRepository(): TraceStoreRepository {
  return {
    insertTrace: (record) => insertTraceRecordJson(record),
    updateTraceRecord: (traceId, patch) => updateTraceRecordJson(traceId, patch),
    findTraceById: (traceId) => findTraceByIdJson(traceId),
    queryTraces: (filter) => queryTracesJson(filter),
    listTracesForOwner: (ownerUserId, opts) => listTracesForOwnerJson(ownerUserId, opts),
    purgeOlderThan: (isoDate) => purgeTracesOlderThanJson(isoDate),
  };
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: TraceStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getTraceRepository(): TraceStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_TRACES_PG === "true"
        ? createTracePgRepository()
        : createTraceJsonRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetTraceRepositoryForTest(): void {
  defaultRepo = null;
}

// ============================================================
// 公开函数（原签名原导出名，调用点零改动）
// 给定 storePath → 强制 JSON 文件路径（既有测试契约）；
// 未给定 → 经选择器分流。
// ============================================================

export async function insertTraceRecord(record: TraceRecord, storePath?: string): Promise<TraceRecord> {
  if (storePath) return insertTraceRecordJson(record, storePath);
  return getTraceRepository().insertTrace(record);
}

export async function updateTraceRecord(traceId: string, patch: Partial<TraceRecord>, storePath?: string): Promise<TraceRecord | null> {
  if (storePath) return updateTraceRecordJson(traceId, patch, storePath);
  return getTraceRepository().updateTraceRecord(traceId, patch);
}

export async function findTraceById(traceId: string, storePath?: string): Promise<TraceRecord | null> {
  if (storePath) return findTraceByIdJson(traceId, storePath);
  return getTraceRepository().findTraceById(traceId);
}

export async function queryTraces(filter: TraceQueryFilter, storePath?: string): Promise<TraceQueryResult> {
  if (storePath) return queryTracesJson(filter, storePath);
  return getTraceRepository().queryTraces(filter);
}

export async function listTracesForOwner(ownerUserId: string, opts?: { limit?: number; offset?: number }, storePath?: string): Promise<TraceRecord[]> {
  if (storePath) return listTracesForOwnerJson(ownerUserId, opts, storePath);
  return getTraceRepository().listTracesForOwner(ownerUserId, opts);
}

export async function purgeTracesOlderThan(isoDate: string, storePath?: string): Promise<number> {
  if (storePath) return purgeTracesOlderThanJson(isoDate, storePath);
  return getTraceRepository().purgeOlderThan(isoDate);
}
