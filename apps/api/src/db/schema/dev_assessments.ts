// ============================================================
// dev_assessments 表 - 开发评估（P2-2）
// ============================================================
// 开发顾问独立工作面；可被合并进总评估；可单签合同。
//
// 设计决策（D-11）：
//   - contract_mode：embedded（嵌入总包）/ separate（单独签约）
//   - delivery_mode 继承自 assessment_version，不重复存储
//   - items 数组用 jsonb，每条目包含：domain/module/description/devType/codingDays
//   - deploy_ops_items 仅 private_cloud 场景下非空
//   - total_days 由 service 层自动计算（items + deploy_ops_items 的 totalDays 汇总）

import { pgTable, uuid, text, jsonb, timestamp, real, index } from "drizzle-orm/pg-core";

export const devAssessments = pgTable(
  "dev_assessments",
  {
    devAssessmentId: uuid("dev_assessment_id").primaryKey(),
    /** 关联总评估版本（软引用，可为空表示独立评估） */
    assessmentVersionId: uuid("assessment_version_id"),
    /** 合同模式：embedded = 嵌入总包；separate = 单独签约 */
    contractMode: text("contract_mode", { enum: ["embedded", "separate"] }).notNull().default("embedded"),
    /** 状态 */
    status: text("status", {
      enum: ["draft", "in_progress", "review_pending", "confirmed", "merged"],
    }).notNull().default("draft"),
    /** 开发条目清单 [{ domain, module, brief, description, devType, basis, codingDays, planningDays, testingDays, totalDays }] */
    items: jsonb("items").notNull().default([]),
    /** 部署运维条目清单（私有云场景） */
    deployOpsItems: jsonb("deploy_ops_items").default([]),
    /** 总人天（自动计算） */
    totalDays: real("total_days").notNull().default(0),
    /** 分配者（实施顾问 / PM） */
    assignedByUserId: text("assigned_by_user_id"),
    /** 开发顾问 */
    assessedByUserId: text("assessed_by_user_id"),
    /** 需求上下文快照（证据、SOW、需求包摘要） */
    contextSnapshot: jsonb("context_snapshot").notNull().default({}),
    /** 备注 */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index("dev_assessments_version_id_idx").on(table.assessmentVersionId),
    statusIdx: index("dev_assessments_status_idx").on(table.status),
    assessedByIdx: index("dev_assessments_assessed_by_idx").on(table.assessedByUserId),
  }),
);

export type DevAssessmentRow = typeof devAssessments.$inferSelect;
export type DevAssessmentInsert = typeof devAssessments.$inferInsert;

// ------------------------------------------------------------------
// 类型定义（供 service / route 使用）
// ------------------------------------------------------------------

export interface DevAssessmentItem {
  /** 条目 ID（前端生成，可选） */
  itemId?: string;
  /** 业务领域（如：滚动生产计划） */
  domain: string;
  /** 模块名称 */
  module: string;
  /** 模块简述 */
  brief?: string;
  /** 功能说明（必填） */
  description: string;
  /** 开发类型 */
  devType: "feature" | "report" | "integration";
  /** 估算依据 */
  basis?: string;
  /** 编码人天（基准，必须 > 0） */
  codingDays: number;
  /** 需求规划人天（自动计算：codingDays * 0.2） */
  planningDays: number;
  /** 功能测试人天（自动计算：codingDays * 0.4） */
  testingDays: number;
  /** 合计（自动计算） */
  totalDays: number;
}

export interface DevAssessmentDeployOpsItem {
  itemId?: string;
  /** 运维项描述 */
  description: string;
  /** 人天 */
  days: number;
  /** 依据 */
  basis?: string;
}
