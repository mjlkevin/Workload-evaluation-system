// ============================================================
// sealed_baselines 表 - 封版基线
// ============================================================
// P1-3 核心实体：成交后锁定评估基线，后续变更强制走新版本或变更单。
// 封版后向下游合同系统推送（单向事件）。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const sealedBaselines = pgTable(
  "sealed_baselines",
  {
    sealedBaselineId: uuid("sealed_baseline_id").primaryKey(),
    /** 关联评估版本 */
    assessmentVersionId: uuid("assessment_version_id").notNull(),
    /** 封版人 */
    sealedByUserId: text("sealed_by_user_id"),
    /** 全部交付物快照 */
    artifactsSnapshot: jsonb("artifacts_snapshot").notNull().default({}),
    /** 下游合同流程 ID */
    contractFlowId: text("contract_flow_id"),
    /** 封版原因 */
    sealReason: text("seal_reason"),
    /** 状态：sealed / superseded（被新版本取代） */
    status: text("status", { enum: ["sealed", "superseded"] }).notNull().default("sealed"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("sealed_baselines_version_idx").on(table.assessmentVersionId),
    statusIdx: index("sealed_baselines_status_idx").on(table.status),
  }),
);

export type SealedBaselineRow = typeof sealedBaselines.$inferSelect;
export type SealedBaselineInsert = typeof sealedBaselines.$inferInsert;
