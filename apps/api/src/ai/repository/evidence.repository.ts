// ============================================================
// EvidenceRepository — 证据链持久化层
// ============================================================
// T5 交付物：
//   1. saveExtractionResult：原子写入 ExtractionResult + Evidence[]
//   2. findByExtractionId：按 extractionId 反向组装完整 ExtractionResult
//   3. appendEvidenceHistory：人工覆盖时双写（evidences.history + change_logs）
//
// 设计约束：
//   - 所有写操作走事务（extraction_results ↔ evidences 一致性）
//   - 查询用 Drizzle 原生 select + eq，不引入复杂关系映射
//   - history 追加采用"读取 → 修改 → 写回"（乐观锁简化版，P0 足够）

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { evidences, extractionResults, changeLogs } from "../../db/schema";
import type {
  Evidence,
  ExtractionResult,
  ExtractionMethod,
} from "../evidence/types";

// ------------------------------------------------------------------
// 序列化 / 反序列化 helpers（DB Date ↔ ISO string，jsonb 已自动解析）
// ------------------------------------------------------------------

function toIsoString(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString();
  if (typeof d === "string") return d;
  return d.toISOString();
}

function evidenceFromRow(row: typeof evidences.$inferSelect): Evidence {
  return {
    evidenceId: row.evidenceId,
    fieldPath: row.fieldPath,
    value: row.value,
    rawText: row.rawText ?? undefined,
    method: row.method as ExtractionMethod,
    confidence: row.confidence,
    source: row.source as Evidence["source"],
    extractedAt: toIsoString(row.extractedAt),
    aiMeta: row.aiMeta as Evidence["aiMeta"] ?? undefined,
    history: row.history as Evidence["history"] ?? undefined,
  };
}

function extractionResultFromRow(
  row: typeof extractionResults.$inferSelect,
  evs: Evidence[],
): ExtractionResult {
  return {
    extractionId: row.extractionId,
    sourceRef: row.sourceRef,
    versionId: row.versionId ?? undefined,
    status: row.status as ExtractionResult["status"],
    evidences: evs,
    warnings: (row.warnings ?? []) as ExtractionResult["warnings"],
    fallbacks: (row.fallbacks ?? []) as ExtractionResult["fallbacks"],
    durationMs: row.durationMs,
    extractedAt: toIsoString(row.extractedAt),
    extractedByUserId: row.extractedByUserId ?? undefined,
    extractorVersion: row.extractorVersion ?? undefined,
  };
}

// ------------------------------------------------------------------
// Repository
// ------------------------------------------------------------------

export class EvidenceRepository {
  constructor(private dbInstance: Database = db) {}

  /**
   * 原子保存 ExtractionResult 及其关联的 Evidence 列表。
   * 使用事务保证 extraction_results 与 evidences 的一致性。
   */
  async saveExtractionResult(result: ExtractionResult): Promise<void> {
    await this.dbInstance.transaction(async (tx) => {
      // 1. 写入 extraction_results 头
      await tx.insert(extractionResults).values({
        extractionId: result.extractionId,
        sourceRef: result.sourceRef,
        versionId: result.versionId,
        status: result.status,
        warnings: result.warnings,
        fallbacks: result.fallbacks,
        durationMs: result.durationMs,
        extractedAt: new Date(result.extractedAt),
        extractedByUserId: result.extractedByUserId,
        extractorVersion: result.extractorVersion,
      });

      // 2. 批量写入 evidences
      if (result.evidences.length > 0) {
        await tx.insert(evidences).values(
          result.evidences.map((ev) => ({
            evidenceId: ev.evidenceId,
            extractionId: result.extractionId,
            fieldPath: ev.fieldPath,
            value: ev.value,
            rawText: ev.rawText,
            method: ev.method,
            confidence: ev.confidence,
            source: ev.source,
            aiMeta: ev.aiMeta,
            history: ev.history,
            extractedAt: new Date(ev.extractedAt),
          })),
        );
      }
    });
  }

  /**
   * 按 extractionId 查询完整的 ExtractionResult（含全部 Evidence）。
   * 未找到时返回 null。
   */
  async findByExtractionId(extractionId: string): Promise<ExtractionResult | null> {
    const [header] = await this.dbInstance
      .select()
      .from(extractionResults)
      .where(eq(extractionResults.extractionId, extractionId));

    if (!header) return null;

    const rows = await this.dbInstance
      .select()
      .from(evidences)
      .where(eq(evidences.extractionId, extractionId));

    const evs = rows.map(evidenceFromRow);
    return extractionResultFromRow(header, evs);
  }

  /**
   * 人工覆盖 Evidence 值时：
   * 1. 读取当前 evidence，把旧值追加到 history
   * 2. 更新 evidence 的 value / method / updatedAt
   * 3. 写入 change_logs 审计记录
   *
   * 本操作也走事务，保证 history + change_logs 双写一致。
   */
  async appendEvidenceHistory(params: {
    evidenceId: string;
    newValue: string;
    newMethod: ExtractionMethod;
    changedByUserId?: string;
    reason?: string;
  }): Promise<void> {
    const { evidenceId: evId, newValue, newMethod, changedByUserId, reason } = params;

    await this.dbInstance.transaction(async (tx) => {
      // 1. 读取当前 evidence
      const [current] = await tx
        .select()
        .from(evidences)
        .where(eq(evidences.evidenceId, evId));

      if (!current) {
        throw new Error(`Evidence not found: ${evId}`);
      }

      const now = new Date();
      const nowIso = now.toISOString();

      // 2. 组装 history 条目
      const historyEntry = {
        value: current.value,
        method: current.method as ExtractionMethod,
        changedAt: toIsoString(current.updatedAt ?? current.createdAt),
        changedByUserId: current.createdByUserId ?? undefined,
      };

      const existingHistory = ((current.history ?? []) as Evidence["history"]) ?? [];
      const newHistory = [...existingHistory, historyEntry];

      // 3. 更新 evidence
      await tx
        .update(evidences)
        .set({
          value: newValue,
          method: newMethod,
          history: newHistory,
          updatedAt: now,
        })
        .where(eq(evidences.evidenceId, evId));

      // 4. 写入 change_logs
      await tx.insert(changeLogs).values({
        changeLogId: randomUUID(),
        evidenceId: evId,
        extractionId: current.extractionId,
        fieldPath: current.fieldPath,
        oldValue: current.value,
        newValue,
        oldMethod: current.method,
        newMethod,
        changedByUserId,
        reason,
        changedAt: now,
      });
    });
  }
}

/** 进程级单例（可替换为依赖注入） */
export const evidenceRepository = new EvidenceRepository();
