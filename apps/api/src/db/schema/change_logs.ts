// ============================================================
// change_logs 表 - 单字段覆盖审计
// ============================================================
// TBD-P0-T5-01 裁决：不存全量快照、不存 JSON Patch，存"字段级
// old/new 二元组"。每行 = 一次 manual 覆盖（也支持 ai → manual 切换）。
// 与 evidences.history（jsonb 列）形成双写：history 用于 UI 快速回溯，
// change_logs 用于跨证据的批量审计查询。
//
// 不加 FK 到 evidences：evidence 在测试场景下可能 ROLLBACK，FK 会让
// change_logs 回退；保留软引用（evidence_id + extraction_id 文本字段）。

import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

export const changeLogs = pgTable(
  "change_logs",
  {
    changeLogId: uuid("change_log_id").primaryKey(),
    evidenceId: uuid("evidence_id").notNull(),
    /** 冗余 extraction_id 便于按 ExtractionResult 维度批量审计 */
    extractionId: uuid("extraction_id"),
    fieldPath: text("field_path").notNull(),
    /** 覆盖前的值；首次插入证据时 oldValue 为 NULL */
    oldValue: text("old_value"),
    newValue: text("new_value").notNull(),
    oldMethod: text("old_method"),
    newMethod: text("new_method", {
      enum: ["rule", "ai", "manual", "default"],
    }).notNull(),
    changedByUserId: text("changed_by_user_id"),
    /** 可空：旧 ai.service 把"覆盖原因"留作必填，但 P0 自由填，T7 RBAC 再约束 */
    reason: text("reason"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    evidenceIdx: index("change_logs_evidence_id_idx").on(table.evidenceId),
    extractionIdx: index("change_logs_extraction_id_idx").on(table.extractionId),
    changedAtIdx: index("change_logs_changed_at_idx").on(table.changedAt),
  }),
);

export type ChangeLogRow = typeof changeLogs.$inferSelect;
export type ChangeLogInsert = typeof changeLogs.$inferInsert;
