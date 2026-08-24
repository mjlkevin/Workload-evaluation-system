// ============================================================
// Knowledge 域表（阶段 2 批 9 · 第 1–3 步）
// ============================================================
// knowledge_entries 替换 config/knowledge/store.json 的 entries 数组，
// 字段与 KnowledgeEntry 1:1（tags 用 jsonb，与批 8 json_runtime 口径一致）。
//
// - status 支持 draft / active / archived 三态：现存 24 条 JSON 条目
//   均无 status 字段（读取时归一化为 active），建表仍须支持 archived
//   （批 9 指令；JSON 实现的 update 守卫「已归档不可修改」依赖该状态）。
// - 零数据迁移（D17）：24 条历史条目不迁，PG 空库启动；
//   空库不产生功能故障（knowledge.retrieval docCount === 0 返回空数组）。

import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull().default("general"),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    statusIdx: index("knowledge_entries_status_idx").on(table.status),
  }),
);
