// ============================================================
// collab_workspaces 表 - 评估协同工作区
// ============================================================
// P2-1 核心实体：承载"拉群 → 问答 → 决策"的结构化版本。
// 外部 IM 可并存，但决策回归系统，质询-回复自动沉淀为证据链。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const collabWorkspaces = pgTable(
  "collab_workspaces",
  {
    workspaceId: uuid("workspace_id").primaryKey(),
    /** 工作区名称 */
    name: text("name").notNull(),
    /** 关联评估版本 */
    assessmentVersionId: uuid("assessment_version_id"),
    /** 关联需求包 */
    requirementPackId: uuid("requirement_pack_id"),
    /** 成员列表 [{ userId, role, joinedAt }] */
    members: jsonb("members").notNull().default([]),
    /** 状态：active / archived */
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    /** 创建者 */
    createdByUserId: text("created_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("collab_workspaces_version_idx").on(table.assessmentVersionId),
    statusIdx: index("collab_workspaces_status_idx").on(table.status),
  }),
);

export type CollabWorkspaceRow = typeof collabWorkspaces.$inferSelect;
export type CollabWorkspaceInsert = typeof collabWorkspaces.$inferInsert;
