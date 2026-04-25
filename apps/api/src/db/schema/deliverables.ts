// ============================================================
// deliverables 表 - 4大交付物
// ============================================================
// P1-3 核心实体：从 AssessmentVersion 派生的标准交付物。
// 类型：effort_table / resource_cost / variance_analysis / wbs
// 变更时联动重算。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const deliverables = pgTable(
  "deliverables",
  {
    deliverableId: uuid("deliverable_id").primaryKey(),
    /** 关联评估版本 */
    assessmentVersionId: uuid("assessment_version_id"),
    /** 交付物类型 */
    deliverableType: text("deliverable_type", {
      enum: ["effort_table", "resource_cost", "variance_analysis", "wbs"],
    }).notNull(),
    /** 交付物内容（结构化 JSON，便于前端渲染和导出） */
    content: jsonb("content").notNull().default({}),
    /** 生成来源：auto / manual */
    generatedFrom: text("generated_from", { enum: ["auto", "manual"] }).notNull().default("auto"),
    /** 状态：draft / confirmed */
    status: text("status", { enum: ["draft", "confirmed"] }).notNull().default("draft"),
    /** 差异分析基线来源 */
    varianceBaseline: text("variance_baseline", {
      enum: ["initial_estimate", "bid_baseline", "historical_avg", "customer_budget"],
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("deliverables_version_idx").on(table.assessmentVersionId),
    typeIdx: index("deliverables_type_idx").on(table.deliverableType),
    statusIdx: index("deliverables_status_idx").on(table.status),
  }),
);

export type DeliverableRow = typeof deliverables.$inferSelect;
export type DeliverableInsert = typeof deliverables.$inferInsert;
