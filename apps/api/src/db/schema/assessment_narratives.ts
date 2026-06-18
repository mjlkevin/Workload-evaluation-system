// ============================================================
// assessment_narratives 表 - 评估叙事（五段式）
// ============================================================
// P1-3 核心实体：PM 工作台的 Narrative 生成与编辑。
// 五段式：组织模块 / 数据治理 / 特殊场景 / 验收范围 / 周期成本
// 支持模板化生成 + PM 人工编辑确认。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const assessmentNarratives = pgTable(
  "assessment_narratives",
  {
    narrativeId: uuid("narrative_id").primaryKey(),
    /** 关联评估版本 */
    assessmentVersionId: uuid("assessment_version_id"),
    /** 使用的模板 ID（支持按行业/组织定制） */
    templateId: uuid("template_id"),
    /** 段落 1：组织与模块 */
    orgAndModules: text("org_and_modules"),
    /** 段落 2：数据治理 */
    dataGovernance: text("data_governance"),
    /** 段落 3：特殊场景 */
    specialScenarios: text("special_scenarios"),
    /** 段落 4：验收范围 */
    acceptanceScope: text("acceptance_scope"),
    /** 段落 5：周期与成本 */
    timelineAndCost: text("timeline_and_cost"),
    /** 结构化元数据（用于生成和 diff） */
    metadata: jsonb("metadata").notNull().default({}),
    /** 生成来源：ai / template / manual */
    generatedFrom: text("generated_from", { enum: ["ai", "template", "manual"] }).notNull().default("template"),
    /** 状态：draft / confirmed */
    status: text("status", { enum: ["draft", "confirmed"] }).notNull().default("draft"),
    /** 最后编辑者 */
    lastEditedByUserId: text("last_edited_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("assessment_narratives_version_idx").on(table.assessmentVersionId),
    statusIdx: index("assessment_narratives_status_idx").on(table.status),
  }),
);

export type AssessmentNarrativeRow = typeof assessmentNarratives.$inferSelect;
export type AssessmentNarrativeInsert = typeof assessmentNarratives.$inferInsert;
