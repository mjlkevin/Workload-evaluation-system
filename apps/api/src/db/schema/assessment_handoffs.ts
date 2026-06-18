// ============================================================
// assessment_handoffs 表 - 评估接力记录
// ============================================================
// P1-3 核心实体：记录 IMPL → PM → PMO 的显式接力事件。
// 每次接力产生一条记录，携带上下文快照，支持审计追溯。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const assessmentHandoffs = pgTable(
  "assessment_handoffs",
  {
    handoffId: uuid("handoff_id").primaryKey(),
    /** 关联评估版本 */
    assessmentVersionId: uuid("assessment_version_id"),
    /** 交接前责任角色 */
    fromRole: text("from_role", { enum: ["SALES", "PRE_SALES", "IMPL", "PM", "PMO", "ADMIN"] }).notNull(),
    /** 交接后责任角色 */
    toRole: text("to_role", { enum: ["SALES", "PRE_SALES", "IMPL", "PM", "PMO", "ADMIN"] }).notNull(),
    /** 发起人用户 ID */
    initiatedByUserId: text("initiated_by_user_id"),
    /** 接收人用户 ID */
    acceptedByUserId: text("accepted_by_user_id"),
    /** 源版本 ID（如 Revision 时） */
    fromVersionId: uuid("from_version_id"),
    /** 目标版本 ID */
    toVersionId: uuid("to_version_id"),
    /** 交接上下文快照：需求包 ID、初估包 ID、SOW ID 等 */
    contextSnapshot: jsonb("context_snapshot").notNull().default({}),
    /** 接力状态 */
    status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
    /** 备注 */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("assessment_handoffs_version_idx").on(table.assessmentVersionId),
    fromRoleIdx: index("assessment_handoffs_from_role_idx").on(table.fromRole),
    toRoleIdx: index("assessment_handoffs_to_role_idx").on(table.toRole),
    statusIdx: index("assessment_handoffs_status_idx").on(table.status),
  }),
);

export type AssessmentHandoffRow = typeof assessmentHandoffs.$inferSelect;
export type AssessmentHandoffInsert = typeof assessmentHandoffs.$inferInsert;
