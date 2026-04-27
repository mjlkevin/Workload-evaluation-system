// ============================================================
// version_code_rules 表 - 版本编码规则（v1 迁移）
// ============================================================
// v1 JSON store 迁移到 PG。

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const versionCodeRules = pgTable("version_code_rules", {
  ruleId: text("rule_id").primaryKey(),
  moduleKey: text("module_key").notNull(),
  moduleName: text("module_name").notNull(),
  moduleCode: text("module_code").notNull(),
  prefix: text("prefix").notNull(),
  format: text("format").notNull(),
  sample: text("sample"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VersionCodeRuleRow = typeof versionCodeRules.$inferSelect;
export type VersionCodeRuleInsert = typeof versionCodeRules.$inferInsert;
