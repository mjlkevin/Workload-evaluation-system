// ============================================================
// RP-030 · Trace Repository（JSON 文件存储）
// ============================================================
// 纯数据访问层：基于 JSON 文件的 trace 读写。
// 不涉及业务逻辑，不包含权限校验。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TraceQueryFilter, TraceQueryResult, TraceRecord, TraceStore } from "./trace.types";

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

/** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function insertTraceRecord(record: TraceRecord, storePath?: string): Promise<TraceRecord> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  store.traces.unshift(record); // 最新的在前
  writeStore(path, store);
  return record;
}

/** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function updateTraceRecord(traceId: string, patch: Partial<TraceRecord>, storePath?: string): Promise<TraceRecord | null> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  const idx = store.traces.findIndex((t) => t.traceId === traceId);
  if (idx < 0) return null;
  store.traces[idx] = { ...store.traces[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(path, store);
  return store.traces[idx];
}

// ─── 查询 ────────────────────────────────────────────────────

/** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync），阶段 2 替换实现。 */
export async function findTraceById(traceId: string, storePath?: string): Promise<TraceRecord | null> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  return store.traces.find((t) => t.traceId === traceId) ?? null;
}

/** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync），阶段 2 替换实现。 */
export async function queryTraces(filter: TraceQueryFilter, storePath?: string): Promise<TraceQueryResult> {
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

/** 阶段 1 批 7：签名改 async（含内部 queryTraces 级联），实现不动（仍为 readFileSync），阶段 2 替换实现。 */
export async function listTracesForOwner(ownerUserId: string, opts?: { limit?: number; offset?: number }, storePath?: string): Promise<TraceRecord[]> {
  const result = await queryTraces({ ownerUserId, ...opts }, storePath);
  return result.traces;
}

// ─── 清理（retention） ───────────────────────────────────────

/** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function purgeTracesOlderThan(isoDate: string, storePath?: string): Promise<number> {
  const path = storePath ?? resolveStorePath();
  const store = readStore(path);
  const cutoff = new Date(isoDate).getTime();
  const before = store.traces.length;
  store.traces = store.traces.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
  const removed = before - store.traces.length;
  if (removed > 0) writeStore(path, store);
  return removed;
}
