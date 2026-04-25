// ============================================================
// requirement_packs 表 - 需求包 v1
// ============================================================
// 与 v2 实体 RequirementPack 1:1 对应。
// 售前顾问 owns；状态流转：draft → confirmed → deprecated。
// 关联 extraction_results（可选）：若由 AI Extractor 生成，记录来源。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const requirementPacks = pgTable(
  "requirement_packs",
  {
    requirementPackId: uuid("requirement_pack_id").primaryKey(),
    /** 可选：关联到 AI Extractor 的抽取结果 */
    sourceExtractionId: uuid("source_extraction_id"),
    /** 结构化需求（模块、功能点、约束的树形/列表结构） */
    structuredRequirements: jsonb("structured_requirements").notNull().default([]),
    /** 行业标签，如 "制造业 / 食品" */
    industry: text("industry"),
    /** 规模描述，如 "集团型 / 500人 / 10家子公司" */
    scale: text("scale"),
    /** 模块清单（与 SOWDocument 双向映射的基础） */
    modules: jsonb("modules").notNull().default([]),
    /** 约束条件（如交付时间、技术栈限制） */
    constraints: jsonb("constraints").notNull().default([]),
    status: text("status", { enum: ["draft", "confirmed", "deprecated"] }).notNull().default("draft"),
    ownerUserId: text("owner_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("requirement_packs_status_idx").on(table.status),
    ownerIdx: index("requirement_packs_owner_user_id_idx").on(table.ownerUserId),
  }),
);

export type RequirementPackRow = typeof requirementPacks.$inferSelect;
export type RequirementPackInsert = typeof requirementPacks.$inferInsert;
