// ============================================================
// initial_estimates 表 - 初估交接包
// ============================================================
// 与 v2 实体 InitialEstimate 1:1 对应。
// 售前顾问 owns，实施顾问 review；是售前 → 实施顾问的正式交接物之一。
// confidence_scores 存 4 维度：组织规模 / 模块复杂度 / 定制比例 / 交付周期。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const initialEstimates = pgTable(
  "initial_estimates",
  {
    initialEstimateId: uuid("initial_estimate_id").primaryKey(),
    /** 关联需求包（软引用） */
    requirementPackId: uuid("requirement_pack_id"),
    /** 人天估算明细 [{ module, days, basis }] */
    effortEstimate: jsonb("effort_estimate").notNull().default([]),
    /** 风险标签，如 ["多组织", "接口复杂", "私有云"] */
    riskTags: jsonb("risk_tags").notNull().default([]),
    /** 假设清单 [{ assumption, rationale, riskIfInvalid }] */
    assumptions: jsonb("assumptions").notNull().default([]),
    /** 4 维置信度 { orgScale, moduleComplexity, customRatio, deliveryCycle } */
    confidenceScores: jsonb("confidence_scores"),
    /** 分期方案 [{ phase, modules, estimatedDays, milestone }] */
    phaseProposal: jsonb("phase_proposal").notNull().default([]),
    status: text("status", { enum: ["draft", "reviewed", "handed_off", "deprecated"] }).notNull().default("draft"),
    ownerUserId: text("owner_user_id"),
    reviewedByUserId: text("reviewed_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    requirementPackIdx: index("initial_estimates_requirement_pack_id_idx").on(table.requirementPackId),
    statusIdx: index("initial_estimates_status_idx").on(table.status),
  }),
);

export type InitialEstimateRow = typeof initialEstimates.$inferSelect;
export type InitialEstimateInsert = typeof initialEstimates.$inferInsert;
