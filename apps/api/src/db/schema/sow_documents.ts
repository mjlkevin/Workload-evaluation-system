// ============================================================
// sow_documents 表 - 客户可见范围承诺（SOW）
// ============================================================
// 与 v2 实体 SOWDocument 1:1 对应。
// SOW 条目与评估条目双向映射；SOW 变更自动触发评估影响分析。
// 每条 = 一个 SOW 条目（cloudProduct × module × category 的粒度）。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const sowDocuments = pgTable(
  "sow_documents",
  {
    sowDocumentId: uuid("sow_document_id").primaryKey(),
    /** 关联需求包（软引用，P0.2 不加 FK） */
    requirementPackId: uuid("requirement_pack_id"),
    /** 云产品域，如 "金蝶AI星空" */
    cloudProduct: text("cloud_product").notNull(),
    /** 模块名，如 "总账" */
    module: text("module").notNull(),
    /** 分类，如 "标准功能 / 定制开发 / 集成接口" */
    category: text("category"),
    /** 范围描述 */
    description: text("description"),
    /** 定制范围说明 */
    customizationScope: text("customization_scope"),
    /** SOW 版本号（由变更触发升级） */
    version: text("version").notNull().default("1.0"),
    status: text("status", { enum: ["draft", "confirmed", "changed"] }).notNull().default("draft"),
    /** 变更触发评估影响分析时，记录关联的评估版本 */
    linkedAssessmentVersionId: uuid("linked_assessment_version_id"),
    ownerUserId: text("owner_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    requirementPackIdx: index("sow_documents_requirement_pack_id_idx").on(table.requirementPackId),
    statusIdx: index("sow_documents_status_idx").on(table.status),
    cloudProductIdx: index("sow_documents_cloud_product_idx").on(table.cloudProduct),
  }),
);

export type SowDocumentRow = typeof sowDocuments.$inferSelect;
export type SowDocumentInsert = typeof sowDocuments.$inferInsert;
