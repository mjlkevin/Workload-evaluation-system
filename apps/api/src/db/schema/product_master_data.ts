// ============================================================
// 批次 10b · 产品主数据（产品 / SKU / 模块 / 行项）
// ============================================================
// 裁决一：本组表是产品主数据的**事实源**；loadTemplate() 从这里派生 Template，
// 原 templates 单行 jsonb 退化为派生投影。
//
// 层级（2026-09-14 业务澄清）：产品 → SKU →〔模块〕→ 交付要点。
// **模块是可选层级**：套件类 SKU（如「星空旗舰版基础套件」）本身就是模块组合，
// 其下直接挂交付要点，不再按模块细分。实测 585 条里有 53 条属此类。
//
// 产品↔SKU、SKU↔模块都是多对多（实测 39 个 SKU 跨产品、79 个模块跨 SKU），
// 故不建父子外键，改由行项表（product_sku_module_assignments）承载全部组合关系。

import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, unique } from "drizzle-orm/pg-core";

export const PRODUCT_MASTER_DATA_STATUSES = ["active", "inactive"] as const;

/** 产品线（原 TemplateItem.cloudProduct） */
export const productLines = pgTable(
  "product_lines",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: PRODUCT_MASTER_DATA_STATUSES }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    nameUniq: unique("product_lines_name_key").on(table.name),
    statusIdx: index("product_lines_status_idx").on(table.status),
  }),
);

/** SKU（原 TemplateItem.skuName） */
export const productSkus = pgTable(
  "product_skus",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: PRODUCT_MASTER_DATA_STATUSES }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    nameUniq: unique("product_skus_name_key").on(table.name),
    statusIdx: index("product_skus_status_idx").on(table.status),
  }),
);

/** 交付模块（原 TemplateItem.deliveryModule）——可选层级，套件类 SKU 不用 */
export const productModules = pgTable(
  "product_modules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: PRODUCT_MASTER_DATA_STATUSES }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    nameUniq: unique("product_modules_name_key").on(table.name),
    statusIdx: index("product_modules_status_idx").on(table.status),
  }),
);

/** 产品↔SKU 多对多（实测 39 个 SKU 跨产品，故不能做成父子） */
export const productLineSkuLinks = pgTable(
  "product_line_sku_links",
  {
    productId: text("product_id")
      .notNull()
      .references(() => productLines.id, { onDelete: "restrict" }),
    skuId: text("sku_id")
      .notNull()
      .references(() => productSkus.id, { onDelete: "restrict" }),
    status: text("status", { enum: PRODUCT_MASTER_DATA_STATUSES }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: unique("product_line_sku_links_pkey").on(table.productId, table.skuId),
    productIdx: index("product_line_sku_links_product_idx").on(table.productId),
    skuIdx: index("product_line_sku_links_sku_idx").on(table.skuId),
    statusIdx: index("product_line_sku_links_status_idx").on(table.status),
  }),
);

/** 派生模板元数据：loadTemplate() 从这里取 templateId / version / name 与 groups/sheets 快照。 */
export const productTemplates = pgTable(
  "product_templates",
  {
    templateId: text("template_id").primaryKey(),
    templateVersion: text("template_version").notNull(),
    templateName: text("template_name").notNull(),
    groupsSnapshot: jsonb("groups_snapshot").$type<Array<{ groupId: string; groupName: string }>>().default([]),
    sheetsSnapshot: jsonb("sheets_snapshot").$type<Array<{ sheetId: string; sheetName: string }>>().default([]),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    activeIdx: index("product_templates_active_idx").on(table.isActive),
  }),
);

/**
 * 行项：估算表上的一行 =（产品, SKU, 可选模块, 交付要点）及其标准人天。
 * 裁决二（项目负责人 2026-09-13）：标准人天挂在**行项**上，不挂在模块实体上——
 * 实测 332 个模块里有 9 个同名不同人天（如「合并报表」10/24），那是真实业务差异。
 */
export const productSkuModuleAssignments = pgTable(
  "product_sku_module_assignments",
  {
    id: text("id").primaryKey(),
    /**
     * 所属模板版本。没有它，「这一行属于哪份模板」就只能靠 status 标志推断——
     * 实测会串味：两份模板的 templateItemId 撞名时，onConflict 会把别家的行改写并重新激活，
     * 派生出来的 Template 于是混着另一份模板的条目（往返用例读回了真实夹具数据而非自己存的）。
     */
    templateId: text("template_id")
      .notNull()
      .references(() => productTemplates.templateId, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => productLines.id, { onDelete: "restrict" }),
    skuId: text("sku_id")
      .notNull()
      .references(() => productSkus.id, { onDelete: "restrict" }),
    /**
     * 模块是**可选层级**（2026-09-14 业务澄清）：套件类 SKU 本身即模块组合，其下直接挂
     * 交付要点。为空即表示「该 SKU 不按模块细分」，不得用占位模块顶替。
     */
    moduleId: text("module_id").references(() => productModules.id, { onDelete: "restrict" }),
    /** 原 TemplateItem.templateItemId；CalculateRequest 用它勾选与计量 */
    templateItemId: text("template_item_id").notNull(),
    groupId: text("group_id").notNull(),
    /** 原分组展示名 = appGroup || skuName || productName */
    groupName: text("group_name").notNull(),
    /** 原 itemName = deliveryPoint || deliveryModule || appGroup || skuName || productName */
    itemName: text("item_name").notNull(),
    sheetName: text("sheet_name"),
    appGroup: text("app_group"),
    defaultIncluded: boolean("default_included").default(false),
    /** 交付颗粒 */
    deliveryPoint: text("delivery_point"),
    /** 交付说明 */
    deliveryDesc: text("delivery_desc"),
    /** 评估说明 */
    evalDesc: text("eval_desc"),
    /** 标准实施人天 —— 裁决二：挂在行项上 */
    standardDays: real("standard_days").notNull(),
    status: text("status", { enum: PRODUCT_MASTER_DATA_STATUSES }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    /**
     * 唯一性由结构挡住，粒度是 **templateItemId**——即估算表上的一行。
     *
     * 两次修正，都是测试逼出来的，不是设计时想到的：
     *  · 最初是 (产品, SKU, 模块) 三元组。模块可空后，套件类 SKU 下的多条交付要点共用
     *    (产品, SKU, NULL)，实测把 53 行压成 7 行。
     *  · 改成加上交付要点的四元组仍不对：实测 585 条的 templateItemId **全部唯一**，
     *    而其中 140 条分属 68 个同名四元组（如「质量云｜质量追溯｜质量追溯｜质量追溯」下的
     *    item-110 与 item-489，各 1 人天）。它们不是重复数据，是各自可勾选、各自计入
     *    工作量的独立行；按四元组去重会丢 402 人天、让 74 个 templateItemId 消失，
     *    CalculateRequest 随即引用到不存在的条目。
     *
     * 所以业务主键是行本身。(产品, SKU, 模块, 交付要点) 降为普通索引，只用于查询。
     */
    templateItemUniq: unique("product_sku_module_assignments_template_item_key").on(table.templateId, table.templateItemId),
    grainIdx: index("product_sku_module_assignments_grain_idx").on(
      table.productId,
      table.skuId,
      table.moduleId,
      table.deliveryPoint,
    ),
    productIdx: index("product_sku_module_assignments_product_idx").on(table.productId),
    skuIdx: index("product_sku_module_assignments_sku_idx").on(table.skuId),
    moduleIdx: index("product_sku_module_assignments_module_idx").on(table.moduleId),
    statusIdx: index("product_sku_module_assignments_status_idx").on(table.status),
  }),
);

