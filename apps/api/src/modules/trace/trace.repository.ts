// ============================================================
// RP-030 · Trace Repository（阶段 2 S3 终态：PG-only）
// ============================================================
// 纯数据访问层：PG 实现（trace-pg.repository.ts，五范式）+ 进程内单例选择器。
// 不涉及业务逻辑，不包含权限校验。
//
// S3（2026-08-30）删除批 5 的 JSON 读写路径（六个 *Json 函数 +
// createTraceJsonRepository + resolveStorePath/ensureStoreDir/readStore/
// writeStore），并退役 WES_STORE_TRACES_PG（commit C）——选择器恒装配 PG，
// 与本阶段其余「第 4 步已完成」域（templates/rule_sets/knowledge S6、
// ai-sessions S2b-2）同形态。
//
// 与 JSON 路径一并删除的还有各公开函数尾部的 `storePath?: string`：它从
// 「测试注入钩子」退化为「强制走 JSON 的唯一开关」，JSON 实现下线后没有任何
// 语义可承载（全仓实取：*Json 函数与 storePath 形参的外部调用点为 0）。
// 其余签名不变，调用点零改动。
//
// traces 无 seed 源：它是运行态观测数据，`data/traces/trace-store.json`
// 从未被 git 跟踪（.gitignore 整目录忽略 data/），删读写路径不丢版本库资产。

import type { TraceQueryFilter, TraceQueryResult, TraceRecord } from "./trace.types";
import { createTracePgRepository, type TraceStoreRepository } from "./trace-pg.repository";

// ============================================================
// 选择器（S3 后恒 PG，无开关分流；单例语义保留）
// ============================================================

let defaultRepo: TraceStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；S3 后恒 PG 实现 */
export function getTraceRepository(): TraceStoreRepository {
  if (!defaultRepo) defaultRepo = createTracePgRepository();
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetTraceRepositoryForTest(): void {
  defaultRepo = null;
}

// ============================================================
// 公开函数（原导出名，调用点零改动；S3 后恒经 PG）
// ============================================================

export async function insertTraceRecord(record: TraceRecord): Promise<TraceRecord> {
  return getTraceRepository().insertTrace(record);
}

export async function updateTraceRecord(traceId: string, patch: Partial<TraceRecord>): Promise<TraceRecord | null> {
  return getTraceRepository().updateTraceRecord(traceId, patch);
}

export async function findTraceById(traceId: string): Promise<TraceRecord | null> {
  return getTraceRepository().findTraceById(traceId);
}

export async function queryTraces(filter: TraceQueryFilter): Promise<TraceQueryResult> {
  return getTraceRepository().queryTraces(filter);
}

export async function listTracesForOwner(ownerUserId: string, opts?: { limit?: number; offset?: number }): Promise<TraceRecord[]> {
  return getTraceRepository().listTracesForOwner(ownerUserId, opts);
}

export async function purgeTracesOlderThan(isoDate: string): Promise<number> {
  return getTraceRepository().purgeOlderThan(isoDate);
}
