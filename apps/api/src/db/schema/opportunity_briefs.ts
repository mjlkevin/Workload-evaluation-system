// ============================================================
// opportunity_briefs 表 - 商机档案 v0
// ============================================================
// P1-2 核心实体：销售快报 Skill 的持久化层。
// 销售 owns；记录客户画像、模糊需求、区间报价、分期方案。
// parentProjectId 预留老客户继承（P2-4 历史项目库）。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const opportunityBriefs = pgTable(
  "opportunity_briefs",
  {
    opportunityBriefId: uuid("opportunity_brief_id").primaryKey(),
    /** 客户名称 */
    customerName: text("customer_name").notNull(),
    /** 客户画像（行业、规模、IT现状等） */
    customerProfile: jsonb("customer_profile").notNull().default({}),
    /** 模糊需求（销售口述/对话记录） */
    vagueRequirements: text("vague_requirements"),
    /** 结构化信号（AI 从对话中提取的关键信号） */
    extractedSignals: jsonb("extracted_signals").notNull().default([]),
    /** 区间报价 { min, max, confidence, basis } */
    priceRange: jsonb("price_range"),
    /** 分期方案 [{ phase, scope, estimatedDays, estimatedCost, milestone }] */
    phaseProposal: jsonb("phase_proposal").notNull().default([]),
    /** 老客户继承：指向历史项目 ID（P2-4 启用） */
    parentProjectId: uuid("parent_project_id"),
    /** 关联需求包（销售快报 → 售前深析的升级路径） */
    linkedRequirementPackId: uuid("linked_requirement_pack_id"),
    /** 状态：open / converted / abandoned */
    status: text("status", { enum: ["open", "converted", "abandoned"] }).notNull().default("open"),
    /** 销售 owner */
    ownerUserId: text("owner_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index("opportunity_briefs_owner_user_id_idx").on(table.ownerUserId),
    statusIdx: index("opportunity_briefs_status_idx").on(table.status),
    customerNameIdx: index("opportunity_briefs_customer_name_idx").on(table.customerName),
  }),
);

export type OpportunityBriefRow = typeof opportunityBriefs.$inferSelect;
export type OpportunityBriefInsert = typeof opportunityBriefs.$inferInsert;
