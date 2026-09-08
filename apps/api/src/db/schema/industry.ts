// ============================================================
// 行业主数据域表（批次 10a · 第 10 个存储域）
// ============================================================
// 【基础管理】下第一份主数据：行业 = 业务记录会引用的基础资料，
// 不是「系统怎么运转的配置」（那属系统管理），两者边界见
// 本批交付报告①。
//
// 为什么是两张表而不是一张自引用树表（架构侧采纳执行方建议）：
//   一级 industry_categories / 二级 industry_subcategories 各自成表后，
//   「二级再挂三级」在结构上没有落点——三级无处可挂，
//   不需要一行校验代码去禁止它。结构性约束优于校验代码：
//   校验代码会被后人绕过或漏改，表结构不会。
//   派单原判据「构造尝试三级 → 被拒」据此改为说明结构性不可能。
//
// 禁止硬删的落点（本域要害）：
//   历史记录按**文本值**引用行业（version_records.payload->>'industry'、
//   history_projects.industry 均为自由文本，无外键），不是按主键引用。
//   因此硬删破坏的是「选项治理」而非引用完整性，数据库外键管不到它。
//   处置分三层，全部在数据/契约层，不依赖界面不给按钮：
//     1. 表内没有可表达「已删除」的形态——无 deleted_at 列，
//        status 值域只有 active / inactive 两个成员；
//     2. 仓储的 removeCategory / removeSubcategory 恒抛
//        MASTER_DATA_DELETE_FORBIDDEN（见 industry-pg.repository.ts）；
//     3. HTTP 层显式注册 DELETE 并回 405 同一稳定错误码，
//        而不是让未注册路径碰巧落成 404（见 master-data.routes.ts）。
//   industry_subcategories.category_id 的外键取 ON DELETE RESTRICT：
//   它挡住的是「删掉仍有子节点的一级」，与上面三层互补而非重复。
//
// status 值域口径：沿用全仓既有约定（text + drizzle enum 选项做 TS 约束，
// 不建 PG CHECK 约束——现存 22 份迁移内无任何 CHECK 先例，
// 单为本域破例会让 drizzle 迁移生成脱离 db:generate 口径）。

import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { index } from "drizzle-orm/pg-core";

/** 主数据启用状态：停用（inactive）后新单据选不到，历史记录照常显示。 */
export const MASTER_DATA_STATUSES = ["active", "inactive"] as const;
export type MasterDataStatus = (typeof MASTER_DATA_STATUSES)[number];

/** 一级：行业大类。首批种子仅 `制造业` / `其他` 两条（逐字取自库中真实值）。 */
export const industryCategories = pgTable(
  "industry_categories",
  {
    /** text 主键：seed 行走可读稳定 id（幂等 upsert 依赖其确定性），运行时新建用随机 UUID */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: MASTER_DATA_STATUSES }).notNull().default("active"),
    // 展示顺序对 UI 可见（与 version_code_rules.sort_order 同口径）
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    nameUniq: unique("industry_categories_name_key").on(table.name),
    statusIdx: index("industry_categories_status_idx").on(table.status),
  }),
);

/** 二级：行业细分。只能挂在一级之下（结构上没有第三种节点）。 */
export const industrySubcategories = pgTable(
  "industry_subcategories",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => industryCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status", { enum: MASTER_DATA_STATUSES }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    /** 同名细分可在不同大类下并存（如「离散制造」与「离散装备」不冲突），
     *  但同一大类下的细分名称必须唯一——否则下拉里出现两条无法区分的项。 */
    categoryNameUniq: unique("industry_subcategories_category_name_key").on(table.categoryId, table.name),
    categoryIdx: index("industry_subcategories_category_idx").on(table.categoryId),
    statusIdx: index("industry_subcategories_status_idx").on(table.status),
  }),
);

export type IndustryCategoryRow = typeof industryCategories.$inferSelect;
export type IndustryCategoryInsert = typeof industryCategories.$inferInsert;
export type IndustrySubcategoryRow = typeof industrySubcategories.$inferSelect;
export type IndustrySubcategoryInsert = typeof industrySubcategories.$inferInsert;
