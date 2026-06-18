// ============================================================
// history_projects 表 - 历史项目库（P2-4）
// ============================================================
// 项目结案后数据回流到知识库，新商机时查询行业+规模相似的历史项目。
// 覆盖 v2 §10 US-19：老客户二期继承起点，只问增量部分。

import { pgTable, uuid, text, jsonb, timestamp, index, integer } from "drizzle-orm/pg-core";

export const historyProjects = pgTable(
  "history_projects",
  {
    historyProjectId: uuid("history_project_id").primaryKey(),
    /** 行业 */
    industry: text("industry").notNull(),
    /** 规模描述 */
    scale: text("scale").notNull(),
    /** 模块清单 */
    modules: jsonb("modules").notNull().default([]),
    /** 评估人天 */
    estimatedDays: integer("estimated_days").notNull(),
    /** 实际人天 */
    actualDays: integer("actual_days"),
    /** 评估金额（元） */
    estimatedCost: integer("estimated_cost"),
    /** 实际金额（元） */
    actualCost: integer("actual_cost"),
    /** 延期主因 */
    delayReason: text("delay_reason"),
    /** 风险标签 */
    riskTags: jsonb("risk_tags").notNull().default([]),
    /** 来源评估版本 ID（软引用） */
    sourceAssessmentVersionId: uuid("source_assessment_version_id"),
    /** 来源封版基线 ID（软引用） */
    sourceSealedBaselineId: uuid("source_sealed_baseline_id"),
    /** 结案时间 */
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    industryIdx: index("history_projects_industry_idx").on(table.industry),
    scaleIdx: index("history_projects_scale_idx").on(table.scale),
  }),
);

export type HistoryProjectRow = typeof historyProjects.$inferSelect;
export type HistoryProjectInsert = typeof historyProjects.$inferInsert;
