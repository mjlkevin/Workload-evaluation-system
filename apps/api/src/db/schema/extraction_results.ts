// ============================================================
// extraction_results 表 - 抽取头记录
// ============================================================
// 与 src/ai/evidence/types.ts 的 ExtractionResult 1:1 对应（不含 evidences[]，
// 后者通过 evidences.extraction_id 反向关联）。
// status 走 text + check 约束（drizzle-orm 0.45 不直接支持 enum 表生成，
// 用 text + 应用层枚举更稳妥；P0.2 再考虑切真 enum）。

import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const extractionResults = pgTable(
  "extraction_results",
  {
    extractionId: uuid("extraction_id").primaryKey(),
    sourceRef: text("source_ref").notNull(),
    versionId: text("version_id"),
    status: text("status", { enum: ["success", "partial", "failed"] }).notNull(),
    /** ExtractionWarning[]，见 types.ts */
    warnings: jsonb("warnings").notNull().default([]),
    /** ExtractionFallback[]，见 types.ts */
    fallbacks: jsonb("fallbacks").notNull().default([]),
    durationMs: integer("duration_ms").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
    extractedByUserId: text("extracted_by_user_id"),
    extractorVersion: text("extractor_version"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceRefIdx: index("extraction_results_source_ref_idx").on(table.sourceRef),
    extractedAtIdx: index("extraction_results_extracted_at_idx").on(table.extractedAt),
  }),
);

export type ExtractionResultRow = typeof extractionResults.$inferSelect;
export type ExtractionResultInsert = typeof extractionResults.$inferInsert;
