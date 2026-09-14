// ============================================================
// 批次 10b · Template 从产品主数据表派生
// ============================================================
// 裁决一：新表是事实源，loadTemplate() 保持签名与返回形状不变，
// 内部从新表拼出 Template。
//
// 本模块提供：
//   - deriveTemplateFromProductTables(db) → Template
//   - persistTemplateToProductTables(db, template) → void
//
// 导入口径（2026-09-14 业务澄清后）：模块是**可选层级**——套件类 SKU 本身即模块组合，
// 其下直接挂交付要点。模块名为空的条目照常导入、模块位留空，既不丢弃也不用占位模块顶替。
// 去重粒度为 (产品, SKU, 模块, 交付要点) 四元组。真正不导入的只有 Excel 小计行与
// 产品/SKU 名缺失而无法成行的条目，两者都带 reason 进 skippedRows。

import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { Database } from "../../db/client";

type DbLike = Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;
import { readDbNow } from "../../db/now";
import {
  productLineSkuLinks,
  productLines,
  productModules,
  productSkuModuleAssignments,
  productSkus,
  productTemplates,
  templates,
} from "../../db/schema";
import type { Template, TemplateItem } from "../../types";

/** Excel 残留的小计行：产品名形如「产品实施工作量小计(人天):」，不是业务数据，不导入 */
function isExcelSubtotalRow(cloudProduct: string): boolean {
  return /小计/.test(cloudProduct);
}

export type ProductTemplateMigrationResult = {
  importedAssignments: number;
  /** 无模块层级的条目（套件类 SKU 直接挂交付要点）——已正常导入，模块位为空 */
  moduleLessAssignments: number;
  /** 已导入但形态可疑的条目（如 Excel 小计残留）——供管理页提示人工清理，**不代表未导入** */
  dataQualityFlags: Array<{
    templateItemId: string;
    cloudProduct: string;
    skuName: string;
    standardDays: number;
    reason: "excel_subtotal";
  }>;
  /** 真正未导入的条目：产品/SKU 名缺失而无法成行 */
  skippedRows: Array<{
    cloudProduct: string;
    skuName: string;
    standardDays: number;
    sheetName?: string;
    reason: "missing_product_or_sku";
  }>;
};

/**
 * 由名称生成稳定 id。
 *
 * 教训（2026-09-14 实测）：原实现是 `name.replace(/[^a-z0-9\-_]/g, "")`，把非 ASCII 全部剥掉——
 * 于是「AutoCAD集成」与「AutoCAD导入」都塌成 `autocad`，插入时被 onConflictDoNothing 静默跳过，
 * 后续条目指向了**别人的**实体；纯中文名则退化成 randomUUID，导致同一份数据每次迁移出不同 id。
 * 实测后果：产品 33→32、SKU 180→172、模块 332→316，往返丢 571 人天（3106.3→2535.0）。
 *
 * 现改为「可读前缀 + 全名 sha1 前 12 位」：既保留可读性，又对任意 Unicode 名称稳定且不碰撞，
 * 且同名永远得到同一 id（迁移可重放）。
 */
function slugId(prefix: string, name: string): string {
  const readable = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .slice(0, 24);
  const digest = createHash("sha1").update(name.trim()).digest("hex").slice(0, 12);
  return readable ? `${prefix}-${readable}-${digest}` : `${prefix}-${digest}`;
}

/** 从 product 主数据表派生 Template。 */
export async function deriveTemplateFromProductTables(dbInstance: DbLike): Promise<Template> {
  const metaRows = await dbInstance
    .select()
    .from(productTemplates)
    .where(eq(productTemplates.isActive, true))
    // 取**最近**生效的那份：asc 会选到最旧的活动行
    .orderBy(desc(productTemplates.updatedAt), asc(productTemplates.templateId))
    .limit(1);
  const meta = metaRows[0];
  if (!meta) {
    throw new Error("PRODUCT_TEMPLATE_META_MISSING");
  }

  const rows = await dbInstance
    .select({
      assignment: productSkuModuleAssignments,
      productName: productLines.name,
      skuName: productSkus.name,
      moduleName: productModules.name,
    })
    .from(productSkuModuleAssignments)
    .leftJoin(productLines, eq(productSkuModuleAssignments.productId, productLines.id))
    .leftJoin(productSkus, eq(productSkuModuleAssignments.skuId, productSkus.id))
    .leftJoin(productModules, eq(productSkuModuleAssignments.moduleId, productModules.id))
    // 按所属模板过滤：status 只表达「是否停用」，不负责回答「属于哪份模板」
    .where(and(eq(productSkuModuleAssignments.templateId, meta.templateId), eq(productSkuModuleAssignments.status, "active")))
    .orderBy(
      asc(productSkuModuleAssignments.sortOrder),
      asc(productSkuModuleAssignments.createdAt),
      asc(productSkuModuleAssignments.id),
    );

  if (rows.length === 0) {
    throw new Error("PRODUCT_TEMPLATE_ASSIGNMENTS_EMPTY");
  }

  const items: TemplateItem[] = [];

  for (const r of rows) {
    const a = r.assignment;
    items.push({
      templateItemId: a.templateItemId,
      groupId: a.groupId,
      itemName: a.itemName,
      standardDays: a.standardDays,
      sheetName: a.sheetName ?? undefined,
      cloudProduct: r.productName || undefined,
      skuName: r.skuName || undefined,
      appGroup: a.appGroup ?? undefined,
      deliveryModule: r.moduleName || undefined,
      deliveryPoint: a.deliveryPoint ?? undefined,
      deliveryDesc: a.deliveryDesc ?? undefined,
      evalDesc: a.evalDesc ?? undefined,
      defaultIncluded: a.defaultIncluded ?? undefined,
    });
  }

  return {
    templateId: meta.templateId,
    templateVersion: meta.templateVersion,
    templateName: meta.templateName,
    groups: meta.groupsSnapshot ?? [],
    items,
    sheets: meta.sheetsSnapshot ?? [],
  };
}

/** 将 Template 持久化到 product 主数据表（作为事实源）。 */
export async function persistTemplateToProductTables(
  dbInstance: DbLike,
  template: Template,
): Promise<ProductTemplateMigrationResult> {
  return dbInstance.transaction(async (tx) => {
    const now = await readDbNow(tx);
    const skippedRows: ProductTemplateMigrationResult["skippedRows"] = [];
    const dataQualityFlags: ProductTemplateMigrationResult["dataQualityFlags"] = [];
    let moduleLessAssignments = 0;

    const groupNameByGroupId = new Map<string, string>();
    for (const g of template.groups ?? []) {
      groupNameByGroupId.set(g.groupId, g.groupName);
    }

    // 1. 置旧 meta 与非活跃关联为非活跃，写入新 meta（groups/sheets 快照保证派生 Template 与原文档逐字段等价）
    await tx.update(productTemplates).set({ isActive: false }).where(eq(productTemplates.isActive, true));
    // 整文档替换语义：事务内**删掉本模板的全部旧行**再插新的。
    // 不能只置 inactive 后按行 upsert——那样两个并发写会各自插各自的行、合并成一份
    // 谁也没提交过的混合文档（「并发写同 templateId 应收敛为某一完整输入」正是钉这条）。
    // 删除范围严格限本 templateId，别的模板不受牵连。
    await tx
      .delete(productSkuModuleAssignments)
      .where(eq(productSkuModuleAssignments.templateId, template.templateId));
    await tx
      .insert(productTemplates)
      .values({
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        templateName: template.templateName,
        groupsSnapshot: template.groups ?? [],
        sheetsSnapshot: template.sheets ?? [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: productTemplates.templateId,
        set: {
          templateVersion: template.templateVersion,
          templateName: template.templateName,
          groupsSnapshot: template.groups ?? [],
          sheetsSnapshot: template.sheets ?? [],
          isActive: true,
          updatedAt: now,
        },
      });

    const productNameToId = new Map<string, string>();
    const skuNameToId = new Map<string, string>();
    const moduleNameToId = new Map<string, string>();

    // 辅助：按 name 取或创建实体
    async function getOrCreateProduct(name: string): Promise<string> {
      if (!name) return "";
      if (productNameToId.has(name)) return productNameToId.get(name)!;
      const existing = await tx.select({ id: productLines.id }).from(productLines).where(eq(productLines.name, name)).limit(1);
      let id: string;
      if (existing[0]) {
        id = existing[0].id;
      } else {
        id = slugId("product-line", name);
        await tx.insert(productLines).values({ id, name, status: "active", sortOrder: 0, createdAt: now, updatedAt: now }).onConflictDoNothing();
      }
      productNameToId.set(name, id);
      return id;
    }

    async function getOrCreateSku(name: string): Promise<string> {
      if (!name) return "";
      if (skuNameToId.has(name)) return skuNameToId.get(name)!;
      const existing = await tx.select({ id: productSkus.id }).from(productSkus).where(eq(productSkus.name, name)).limit(1);
      let id: string;
      if (existing[0]) {
        id = existing[0].id;
      } else {
        id = slugId("product-sku", name);
        await tx.insert(productSkus).values({ id, name, status: "active", sortOrder: 0, createdAt: now, updatedAt: now }).onConflictDoNothing();
      }
      skuNameToId.set(name, id);
      return id;
    }

    async function getOrCreateModule(name: string): Promise<string> {
      if (!name) return "";
      if (moduleNameToId.has(name)) return moduleNameToId.get(name)!;
      const existing = await tx.select({ id: productModules.id }).from(productModules).where(eq(productModules.name, name)).limit(1);
      let id: string;
      if (existing[0]) {
        id = existing[0].id;
      } else {
        id = slugId("product-module", name);
        await tx.insert(productModules).values({ id, name, status: "active", sortOrder: 0, createdAt: now, updatedAt: now }).onConflictDoNothing();
      }
      moduleNameToId.set(name, id);
      return id;
    }

    let importedAssignments = 0;

    for (const [index, item] of template.items.entries()) {
      // 注意：**迁移不做数据清洗**。Excel 小计行这类脏数据照常导入，只在结果里标出来。
      // 理由：裁决一要求 loadTemplate() 是模板文档的忠实投影；投影层一旦偷偷丢行，
      // 既破坏往返等价，也会让引用了这些 templateItemId 的 CalculateRequest 直接失败
      // （实测就是这么炸的）。脏数据该在源头清，由管理页按 dataQualityFlags 提示人工处理。
      if (isExcelSubtotalRow(item.cloudProduct || "")) {
        dataQualityFlags.push({
          templateItemId: item.templateItemId,
          cloudProduct: item.cloudProduct || "",
          skuName: item.skuName || "",
          standardDays: item.standardDays,
          reason: "excel_subtotal",
        });
      }

      const productId = await getOrCreateProduct(item.cloudProduct || "");
      const skuId = await getOrCreateSku(item.skuName || "");
      // 模块是可选层级：套件类 SKU 下直接挂交付要点，模块位留空，不用占位模块顶替
      const moduleName = (item.deliveryModule || "").trim();
      const moduleId = moduleName ? await getOrCreateModule(moduleName) : null;
      if (!productId || !skuId || (moduleName && !moduleId)) {
        skippedRows.push({
          cloudProduct: item.cloudProduct || "",
          skuName: item.skuName || "",
          standardDays: item.standardDays,
          sheetName: item.sheetName,
          reason: "missing_product_or_sku",
        });
        continue;
      }
      if (!moduleId) moduleLessAssignments += 1;

      // 先确保 product-sku 链路存在
      await tx
        .insert(productLineSkuLinks)
        .values({ productId, skuId, status: "active", sortOrder: 0, createdAt: now, updatedAt: now })
        .onConflictDoNothing();

      // 插入或更新关联；唯一键 templateItemId 冲突时更新现有行
      const groupName = groupNameByGroupId.get(item.groupId)
        ?? item.appGroup
        ?? item.skuName
        ?? item.cloudProduct
        ?? "未分组";
      const itemName = item.itemName || item.deliveryPoint || moduleName || groupName;
      await tx
        .insert(productSkuModuleAssignments)
        .values({
          id: slugId("assignment", `${template.templateId}-${item.templateItemId}`),
          templateId: template.templateId,
          productId,
          skuId,
          moduleId,
          templateItemId: item.templateItemId,
          groupId: item.groupId,
          groupName,
          itemName,
          sheetName: item.sheetName || null,
          appGroup: item.appGroup || null,
          defaultIncluded: item.defaultIncluded ?? false,
          deliveryPoint: item.deliveryPoint || null,
          deliveryDesc: item.deliveryDesc || null,
          evalDesc: item.evalDesc || null,
          standardDays: item.standardDays,
          status: "active",
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          // 冲突目标 = 唯一约束粒度 = (templateId, templateItemId)
          target: [productSkuModuleAssignments.templateId, productSkuModuleAssignments.templateItemId],
          set: {
            templateItemId: item.templateItemId,
            groupId: item.groupId,
            groupName,
            itemName,
            sheetName: item.sheetName || null,
            appGroup: item.appGroup || null,
            defaultIncluded: item.defaultIncluded ?? false,
            deliveryPoint: item.deliveryPoint || null,
            deliveryDesc: item.deliveryDesc || null,
            evalDesc: item.evalDesc || null,
            standardDays: item.standardDays,
            status: "active",
            sortOrder: index,
            updatedAt: now,
          },
        });

      importedAssignments += 1;
    }

    return { importedAssignments, moduleLessAssignments, dataQualityFlags, skippedRows };
  });
}

/** 从 templates 表读取最近活动行并迁移到 product 主数据表。 */
export async function migrateActiveTemplateRowToProductTables(
  dbInstance: Database,
): Promise<ProductTemplateMigrationResult & { templateId: string; templateName: string }> {
  const rows = await dbInstance
    .select()
    .from(templates)
    .orderBy(desc(templates.updatedAt), desc(templates.templateId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("NO_ACTIVE_TEMPLATE_ROW");
  }
  const template: Template = {
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateName: row.templateName,
    groups: row.groups as Template["groups"],
    items: row.items as Template["items"],
    sheets: (row.sheets ?? []) as Template["sheets"],
  };
  const result = await persistTemplateToProductTables(dbInstance, template);
  return { ...result, templateId: template.templateId, templateName: template.templateName };
}

