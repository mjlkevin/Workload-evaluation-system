// ============================================================
// assessment_versions 表 - 评估版本（v2 升级）
// ============================================================
// P0.2-5：将现有 JSON-based versions 模块的语义映射到 PG schema。
// 保留 v1 版本号机制；新增 Correction vs Revision 二元语义（D-12）。
//
// 状态机（v1 兼容 + v2 扩展）：
//   draft → checked_out → checked_in → promoted → sealed
//
// delivery_mode：PublicCloud | PrivateCloud（影响部署运维人天评估）。
// owner_role：记录当前责任角色（IMPL → PM → PMO 接力过程中会变）。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const assessmentVersions = pgTable(
  "assessment_versions",
  {
    assessmentVersionId: uuid("assessment_version_id").primaryKey(),
    /** v1 版本号，如 "V1.0-IA-20250425" */
    versionCode: text("version_code").notNull().unique(),
    /** Correction = 数字修正（交通费合计有误）；Revision = 范围变更（SOW 追加） */
    revisionType: text("revision_type", { enum: ["correction", "revision", "initial"] }).notNull().default("initial"),
    /** 关联 SOW（软引用） */
    linkedSowId: uuid("linked_sow_id"),
    /** 关联 Narrative（软引用，P1 建表后补 FK） */
    linkedNarrativeId: uuid("linked_narrative_id"),
    /** 当前责任角色：IMPL / PM / PMO */
    ownerRole: text("owner_role", { enum: ["IMPL", "PM", "PMO", "ADMIN"] }).notNull().default("IMPL"),
    /** 交付模式：公有云 / 私有云 */
    deliveryMode: text("delivery_mode", { enum: ["public_cloud", "private_cloud", "hybrid"] }).notNull().default("public_cloud"),
    /** 当前持有者用户 ID */
    ownerUserId: text("owner_user_id"),
    /** 检出者（checkout 时锁定） */
    checkedOutByUserId: text("checked_out_by_user_id"),
    /** 版本状态 */
    status: text("status", {
      enum: ["draft", "checked_out", "checked_in", "promoted", "sealed"],
    }).notNull().default("draft"),
    /** 评估内容 payload（v1 兼容：保留 JSON 结构便于渐进迁移） */
    payload: jsonb("payload").notNull().default({}),
    /** 父版本 ID（Revision 时指向上一版；Correction 指向同一基线版） */
    parentVersionId: uuid("parent_version_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionCodeIdx: index("assessment_versions_version_code_idx").on(table.versionCode),
    statusIdx: index("assessment_versions_status_idx").on(table.status),
    ownerRoleIdx: index("assessment_versions_owner_role_idx").on(table.ownerRole),
    linkedSowIdx: index("assessment_versions_linked_sow_id_idx").on(table.linkedSowId),
  }),
);

export type AssessmentVersionRow = typeof assessmentVersions.$inferSelect;
export type AssessmentVersionInsert = typeof assessmentVersions.$inferInsert;
