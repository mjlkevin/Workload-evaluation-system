// ============================================================
// users 表 - 用户认证（v1 迁移）
// ============================================================
// v1 JSON store 迁移到 PG，保持密码哈希兼容。

import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "sub_admin", "user"] }).notNull().default("user"),
  businessRole: text("business_role").notNull().default("pre_sales"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
