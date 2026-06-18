// ============================================================
// change_submissions 表 - 变更提报（P2-3）
// ============================================================
// D-4 决策落地：Skill 与 Web UI 不实时同步，每次变更形成独立 ChangeSubmission。
// 销售口述变更 → AI 解析 diff → PM 审阅/合并/驳回。
//
// 字段级 diff 结构（diff_result）：
//   { added: [{field, value}], removed: [{field, oldValue}], modified: [{field, before, after}] }

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const changeSubmissions = pgTable(
  "change_submissions",
  {
    changeSubmissionId: uuid("change_submission_id").primaryKey(),
    /** 父实体类型 */
    parentEntityType: text("parent_entity_type", {
      enum: ["opportunity_brief", "requirement_pack", "assessment_version"],
    }).notNull(),
    /** 父实体 ID */
    parentEntityId: uuid("parent_entity_id").notNull(),
    /** 变更描述（销售口述原文） */
    changeDescription: text("change_description").notNull(),
    /** 字段级 diff 结果 {added, removed, modified} */
    diffResult: jsonb("diff_result"),
    /** 重新计算后的新估算（AI 解析后的结构化结果） */
    newEstimate: jsonb("new_estimate"),
    /** 提交人 */
    submittedByUserId: text("submitted_by_user_id"),
    /** 提交时间 */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    /** 状态：submitted / reviewed / merged / rejected */
    status: text("status", {
      enum: ["submitted", "reviewed", "merged", "rejected"],
    }).notNull().default("submitted"),
    /** 审阅人 */
    reviewedByUserId: text("reviewed_by_user_id"),
    /** 审阅时间 */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** 合并到的版本 ID */
    mergedToVersionId: uuid("merged_to_version_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    parentEntityIdx: index("change_submissions_parent_entity_idx").on(
      table.parentEntityType,
      table.parentEntityId,
    ),
    statusIdx: index("change_submissions_status_idx").on(table.status),
    submittedByIdx: index("change_submissions_submitted_by_idx").on(table.submittedByUserId),
  }),
);

export type ChangeSubmissionRow = typeof changeSubmissions.$inferSelect;
export type ChangeSubmissionInsert = typeof changeSubmissions.$inferInsert;
