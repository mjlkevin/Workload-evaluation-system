// ============================================================
// collab_messages 表 - 协同工作区消息
// ============================================================
// P2-1 核心实体：结构化质询-回复，替代群聊沟通。
// 类型：question(质询) / reply(回复) / decision(决策) / notice(通知)
// 质询-回复自动沉淀为证据链（evidenceId 关联）。

import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const collabMessages = pgTable(
  "collab_messages",
  {
    messageId: uuid("message_id").primaryKey(),
    /** 关联工作区 */
    workspaceId: uuid("workspace_id").notNull(),
    /** 消息类型 */
    messageType: text("message_type", {
      enum: ["question", "reply", "decision", "notice"],
    }).notNull(),
    /** 父消息 ID（reply 时指向 question） */
    parentMessageId: uuid("parent_message_id"),
    /** 发送者用户 ID */
    senderUserId: text("sender_user_id"),
    /** 发送者角色 */
    senderRole: text("sender_role", { enum: ["SALES", "PRE_SALES", "IMPL", "PM", "PMO", "ADMIN"] }),
    /** 内容 */
    content: text("content").notNull(),
    /** 关联字段路径（质询针对哪个评估字段） */
    relatedFieldPath: text("related_field_path"),
    /** 关联证据 ID（自动沉淀时写入） */
    evidenceId: uuid("evidence_id"),
    /** 决策结果（decision 类型时） */
    decisionPayload: jsonb("decision_payload"),
    /** 状态：open / resolved / closed */
    status: text("status", { enum: ["open", "resolved", "closed"] }).notNull().default("open"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index("collab_messages_workspace_idx").on(table.workspaceId),
    typeIdx: index("collab_messages_type_idx").on(table.messageType),
    parentIdx: index("collab_messages_parent_idx").on(table.parentMessageId),
    statusIdx: index("collab_messages_status_idx").on(table.status),
  }),
);

export type CollabMessageRow = typeof collabMessages.$inferSelect;
export type CollabMessageInsert = typeof collabMessages.$inferInsert;
