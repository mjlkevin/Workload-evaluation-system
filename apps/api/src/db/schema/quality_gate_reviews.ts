// ============================================================
// quality_gate_reviews 表 - PMO 质量门审核
// ============================================================
// P1-3 核心实体：PMO 对评估包的审核记录。
// 审核范围：交付物齐全性 + 方法论七阶段 + RateCard 正确性。
// PMO 不能否决整个评估，只能驳回补件。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const qualityGateReviews = pgTable(
  "quality_gate_reviews",
  {
    reviewId: uuid("review_id").primaryKey(),
    /** 关联评估版本 */
    assessmentVersionId: uuid("assessment_version_id"),
    /** 审核人 */
    reviewerUserId: text("reviewer_user_id"),
    /** 审核清单结果 */
    checklist: jsonb("checklist").notNull().default({
      deliverablesComplete: false,
      methodologySevenPhases: false,
      rateCardCorrect: false,
      narrativeComplete: false,
      assumptionsDocumented: false,
    }),
    /** 裁决：pass / reject */
    verdict: text("verdict", { enum: ["pass", "reject"] }),
    /** 驳回理由（按字段逐条） */
    rejectionReasons: jsonb("rejection_reasons").notNull().default([]),
    /** 审核备注 */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("quality_gate_reviews_version_idx").on(table.assessmentVersionId),
    verdictIdx: index("quality_gate_reviews_verdict_idx").on(table.verdict),
  }),
);

export type QualityGateReviewRow = typeof qualityGateReviews.$inferSelect;
export type QualityGateReviewInsert = typeof qualityGateReviews.$inferInsert;
