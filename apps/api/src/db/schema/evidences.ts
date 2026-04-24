// ============================================================
// evidences 表 - 证据链原子事实
// ============================================================
// 与 src/ai/evidence/types.ts 的 Evidence 类型 1:1 对应。
// 列命名走 snake_case；jsonb 存放联合类型 source / aiMeta / history。
//
// FK 策略：
//   extraction_id 将在 T5 追加 extraction_results 表时补 FK 约束；
//   当前表单独存在即可，不做向后引用。

import { pgTable, uuid, text, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const evidences = pgTable(
  "evidences",
  {
    evidenceId: uuid("evidence_id").primaryKey(),
    extractionId: uuid("extraction_id"),
    fieldPath: text("field_path").notNull(),
    value: text("value").notNull(),
    rawText: text("raw_text"),
    method: text("method", { enum: ["rule", "ai", "manual", "default"] }).notNull(),
    confidence: real("confidence").notNull(),
    /** EvidenceSource 联合类型，见 types.ts */
    source: jsonb("source").notNull(),
    /** AI 抽取元数据 { provider, model, attempts, finishReason } */
    aiMeta: jsonb("ai_meta"),
    /** 历史修改轨迹（manual 覆盖时追加） */
    history: jsonb("history"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: text("created_by_user_id"),
  },
  (table) => ({
    fieldPathIdx: index("evidences_field_path_idx").on(table.fieldPath),
    extractionIdx: index("evidences_extraction_id_idx").on(table.extractionId),
  }),
);

export type EvidenceRow = typeof evidences.$inferSelect;
export type EvidenceInsert = typeof evidences.$inferInsert;
