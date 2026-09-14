// ============================================================
// 批次 10b · 产品主数据 PG 仓储
// ============================================================
// 范式同 industry-pg.repository.ts：稳定错误码、DB 时钟、结构挡重复、
// 禁止硬删；新增「派生模板元数据」与「(产品,SKU,模块) 关联」读写。

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import {
  productLineSkuLinks,
  productLines,
  productModules,
  productSkuModuleAssignments,
  productSkus,
  productTemplates,
} from "../../db/schema";
import { MasterDataError } from "./industry-pg.repository";
import type {
  CreateAssignmentInput,
  CreateProductLineInput,
  CreateProductModuleInput,
  CreateProductSkuInput,
  MasterDataErrorCode,
  ProductLine,
  ProductMasterDataPatch,
  ProductModule,
  ProductSku,
  ProductSkuModuleAssignment,
  ProductTemplateMeta,
  UpdateAssignmentInput,
} from "./product-master-data.types";

function toSafeError(err: unknown): MasterDataError {
  if (err instanceof MasterDataError) return err;
  return new MasterDataError("MASTER_DATA_STORE_INTERNAL", "product master data persistence failed");
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = (err as { code?: string; cause?: { code?: string } } | null);
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

type DbLike = Pick<Database, "select" | "insert" | "update" | "execute">;

function normalizeName(raw: unknown, label: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new MasterDataError("MASTER_DATA_INVALID", `${label}名称不能为空`);
  return name;
}

function normalizeSortOrder(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new MasterDataError("MASTER_DATA_INVALID", "排序值必须是非负整数");
  }
  return n;
}

function normalizeStandardDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new MasterDataError("MASTER_DATA_INVALID", "标准人天必须是大于等于 0 的数值");
  }
  return Math.round(n * 10) / 10;
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function parseStatus(value: unknown): "active" | "inactive" {
  if (value === "active" || value === "inactive") return value;
  throw new MasterDataError("MASTER_DATA_INVALID", `非法状态: ${String(value)}`);
}

function rowToProductLine(row: typeof productLines.$inferSelect): ProductLine {
  return {
    id: row.id,
    name: row.name,
    status: row.status as "active" | "inactive",
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToProductSku(row: typeof productSkus.$inferSelect): ProductSku {
  return rowToProductLine(row) as ProductSku;
}

function rowToProductModule(row: typeof productModules.$inferSelect): ProductModule {
  return rowToProductLine(row) as ProductModule;
}

function rowToAssignment(
  row: typeof productSkuModuleAssignments.$inferSelect,
  names: { productName: string; skuName: string; moduleName: string },
): ProductSkuModuleAssignment {
  return {
    id: row.id,
    productId: row.productId,
    productName: names.productName,
    skuId: row.skuId,
    skuName: names.skuName,
    moduleId: row.moduleId,
    moduleName: names.moduleName,
    templateItemId: row.templateItemId,
    groupId: row.groupId,
    groupName: row.groupName,
    itemName: row.itemName,
    sheetName: row.sheetName ?? undefined,
    appGroup: row.appGroup ?? undefined,
    defaultIncluded: row.defaultIncluded ?? false,
    deliveryPoint: row.deliveryPoint ?? undefined,
    deliveryDesc: row.deliveryDesc ?? undefined,
    evalDesc: row.evalDesc ?? undefined,
    standardDays: row.standardDays,
    status: row.status as "active" | "inactive",
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const productOrder = [asc(productLines.sortOrder), asc(productLines.createdAt), asc(productLines.id)];
const skuOrder = [asc(productSkus.sortOrder), asc(productSkus.createdAt), asc(productSkus.id)];
const moduleOrder = [asc(productModules.sortOrder), asc(productModules.createdAt), asc(productModules.id)];
const assignmentOrder = [
  asc(productSkuModuleAssignments.sortOrder),
  asc(productSkuModuleAssignments.createdAt),
  asc(productSkuModuleAssignments.id),
];

export function createProductMasterDataPgRepository(dbInstance: Database = db) {
  async function ensureNameFree(
    tx: DbLike,
    table: typeof productLines | typeof productSkus | typeof productModules,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const conditions = [eq(table.name, name)];
    if (exceptId) conditions.push(ne(table.id, exceptId));
    const hits = await tx.select({ id: table.id }).from(table).where(and(...conditions)).limit(1);
    if (hits.length > 0) {
      throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `名称已存在: ${name}`);
    }
  }

  async function lockEntityRow(
    tx: DbLike,
    table: typeof productLines | typeof productSkus | typeof productModules,
    id: string,
  ): Promise<(typeof productLines.$inferSelect) | null> {
    const result = await tx.execute(sql`SELECT * FROM ${table} WHERE id = ${id} FOR UPDATE`);
    return (result.rows as (typeof productLines.$inferSelect)[])[0] ?? null;
  }

  async function lockAssignmentRow(tx: DbLike, id: string): Promise<(typeof productSkuModuleAssignments.$inferSelect) | null> {
    const result = await tx.execute(
      sql`SELECT * FROM ${productSkuModuleAssignments} WHERE id = ${id} FOR UPDATE`,
    );
    return (result.rows as (typeof productSkuModuleAssignments.$inferSelect)[])[0] ?? null;
  }

  async function resolveAssignmentNames(
    tx: DbLike,
    assignment: typeof productSkuModuleAssignments.$inferSelect,
  ): Promise<{ productName: string; skuName: string; moduleName: string }> {
    const [product, sku, module] = await Promise.all([
      tx.select({ name: productLines.name }).from(productLines).where(eq(productLines.id, assignment.productId)).limit(1),
      tx.select({ name: productSkus.name }).from(productSkus).where(eq(productSkus.id, assignment.skuId)).limit(1),
      // 模块可空（套件类 SKU 无模块层级）：为空时不查名，直接给空结果
      assignment.moduleId
        ? tx.select({ name: productModules.name }).from(productModules).where(eq(productModules.id, assignment.moduleId)).limit(1)
        : Promise.resolve([] as Array<{ name: string }>),
    ]);
    return {
      productName: product[0]?.name ?? "",
      skuName: sku[0]?.name ?? "",
      moduleName: module[0]?.name ?? "",
    };
  }

  async function getAssignment(id: string): Promise<ProductSkuModuleAssignment | null> {
    try {
      const rows = await dbInstance
        .select()
        .from(productSkuModuleAssignments)
        .where(eq(productSkuModuleAssignments.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const names = await resolveAssignmentNames(dbInstance, row);
      return rowToAssignment(row, names);
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function listAssignments(): Promise<ProductSkuModuleAssignment[]> {
    try {
      const rows = await dbInstance
        .select()
        .from(productSkuModuleAssignments)
        .orderBy(...assignmentOrder);
      const result: ProductSkuModuleAssignment[] = [];
      for (const row of rows) {
        const names = await resolveAssignmentNames(dbInstance, row);
        result.push(rowToAssignment(row, names));
      }
      return result;
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function listActiveAssignments(): Promise<ProductSkuModuleAssignment[]> {
    try {
      const rows = await dbInstance
        .select()
        .from(productSkuModuleAssignments)
        .where(eq(productSkuModuleAssignments.status, "active"))
        .orderBy(...assignmentOrder);
      const result: ProductSkuModuleAssignment[] = [];
      for (const row of rows) {
        const names = await resolveAssignmentNames(dbInstance, row);
        result.push(rowToAssignment(row, names));
      }
      return result;
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function listProductLines(): Promise<ProductLine[]> {
    try {
      const rows = await dbInstance.select().from(productLines).orderBy(...productOrder);
      return rows.map(rowToProductLine);
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function listProductSkus(): Promise<ProductSku[]> {
    try {
      const rows = await dbInstance.select().from(productSkus).orderBy(...skuOrder);
      return rows.map(rowToProductSku);
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function listProductModules(): Promise<ProductModule[]> {
    try {
      const rows = await dbInstance.select().from(productModules).orderBy(...moduleOrder);
      return rows.map(rowToProductModule);
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function createProductLine(input: CreateProductLineInput): Promise<ProductLine> {
    const name = normalizeName(input.name, "产品");
    const sortOrder = normalizeSortOrder(input.sortOrder);
    try {
      return await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const id = input.id?.trim() || newId("product-line");
        await ensureNameFree(tx, productLines, name, null);
        const rows = await tx
          .insert(productLines)
          .values({ id, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
          .returning();
        return rowToProductLine(rows[0]);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `产品名称已存在: ${name}`);
      throw toSafeError(err);
    }
  }

  async function createProductSku(input: CreateProductSkuInput): Promise<ProductSku> {
    const name = normalizeName(input.name, "SKU");
    const sortOrder = normalizeSortOrder(input.sortOrder);
    try {
      return await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const id = input.id?.trim() || newId("product-sku");
        await ensureNameFree(tx, productSkus, name, null);
        const rows = await tx
          .insert(productSkus)
          .values({ id, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
          .returning();
        return rowToProductSku(rows[0]);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `SKU 名称已存在: ${name}`);
      throw toSafeError(err);
    }
  }

  async function createProductModule(input: CreateProductModuleInput): Promise<ProductModule> {
    const name = normalizeName(input.name, "模块");
    const sortOrder = normalizeSortOrder(input.sortOrder);
    try {
      return await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const id = input.id?.trim() || newId("product-module");
        await ensureNameFree(tx, productModules, name, null);
        const rows = await tx
          .insert(productModules)
          .values({ id, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
          .returning();
        return rowToProductModule(rows[0]);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `模块名称已存在: ${name}`);
      throw toSafeError(err);
    }
  }

  async function ensureLinkExists(tx: DbLike, productId: string, skuId: string): Promise<void> {
    const existing = await tx
      .select()
      .from(productLineSkuLinks)
      .where(and(eq(productLineSkuLinks.productId, productId), eq(productLineSkuLinks.skuId, skuId)))
      .limit(1);
    if (existing.length === 0) {
      const now = await readDbNow(tx);
      await tx
        .insert(productLineSkuLinks)
        .values({ productId, skuId, status: "active", sortOrder: 0, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
    }
  }

  async function createAssignment(input: CreateAssignmentInput): Promise<ProductSkuModuleAssignment> {
    const productId = typeof input.productId === "string" ? input.productId.trim() : "";
    const skuId = typeof input.skuId === "string" ? input.skuId.trim() : "";
    // 模块是可选层级（2026-09-14 业务澄清）：套件类 SKU 本身即模块组合，其下直接挂交付要点。
    // 空串一律归一成 null，避免 "" 与 null 两种「没有模块」的表示混用——唯一约束按 NULL 判等。
    const moduleIdRaw = typeof input.moduleId === "string" ? input.moduleId.trim() : "";
    const moduleId = moduleIdRaw || null;
    if (!productId || !skuId) {
      throw new MasterDataError("MASTER_DATA_INVALID", "产品、SKU 不能为空");
    }
    const standardDays = normalizeStandardDays(input.standardDays);
    const sortOrder = normalizeSortOrder(input.sortOrder);
    try {
      return await dbInstance.transaction(async (tx) => {
        const [product, sku, module] = await Promise.all([
          tx.select({ name: productLines.name }).from(productLines).where(eq(productLines.id, productId)).limit(1),
          tx.select({ name: productSkus.name }).from(productSkus).where(eq(productSkus.id, skuId)).limit(1),
          // 模块可空：不传模块就不查、也不报「模块不存在」
          moduleId
            ? tx.select({ name: productModules.name }).from(productModules).where(eq(productModules.id, moduleId)).limit(1)
            : Promise.resolve([] as Array<{ name: string }>),
        ]);
        if (!product[0]) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `产品不存在: ${productId}`);
        if (!sku[0]) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `SKU 不存在: ${skuId}`);
        if (moduleId && !module[0]) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `模块不存在: ${moduleId}`);

        await ensureLinkExists(tx, productId, skuId);

        const now = await readDbNow(tx);
        const groupName = input.groupName?.trim() || sku[0].name || product[0].name || "未分组";
        const itemName = input.itemName?.trim() || input.deliveryPoint?.trim() || module[0]?.name || groupName;
        const groupId = input.groupId?.trim() || `grp-${product[0].name}-${sku[0].name}`;
        const templateItemId = input.templateItemId?.trim() || newId("item");

        // 行项必须归属某份模板：取当前生效的那份（管理页新增即挂在生效模板下）
        const activeTpl = await tx
          .select({ templateId: productTemplates.templateId })
          .from(productTemplates)
          .where(eq(productTemplates.isActive, true))
          .limit(1);
        if (!activeTpl[0]) throw new MasterDataError("MASTER_DATA_NOT_FOUND", "没有生效的模板，无法新增行项");
        const rows = await tx
          .insert(productSkuModuleAssignments)
          .values({
            id: newId("assignment"),
            templateId: activeTpl[0].templateId,
            productId,
            skuId,
            moduleId,
            templateItemId,
            groupId,
            groupName,
            itemName,
            sheetName: input.sheetName?.trim() || null,
            appGroup: input.appGroup?.trim() || null,
            defaultIncluded: input.defaultIncluded ?? false,
            deliveryPoint: input.deliveryPoint?.trim() || null,
            deliveryDesc: input.deliveryDesc?.trim() || null,
            evalDesc: input.evalDesc?.trim() || null,
            standardDays,
            status: "active",
            sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return rowToAssignment(rows[0], {
          productName: product[0].name,
          skuName: sku[0].name,
          moduleName: module[0]?.name,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new MasterDataError(
          "MASTER_DATA_NAME_EXISTS",
          "该产品 + SKU + 模块组合已存在（标准人天冲突请走编辑）",
        );
      }
      throw toSafeError(err);
    }
  }

  async function updateAssignment(id: string, patch: UpdateAssignmentInput): Promise<ProductSkuModuleAssignment> {
    try {
      return await dbInstance.transaction(async (tx) => {
        const current = await lockAssignmentRow(tx, id);
        if (!current) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `关联不存在: ${id}`);

        const set: Partial<typeof productSkuModuleAssignments.$inferInsert> = { updatedAt: await readDbNow(tx) };
        if (patch.standardDays !== undefined) set.standardDays = normalizeStandardDays(patch.standardDays);
        if (patch.deliveryPoint !== undefined) set.deliveryPoint = patch.deliveryPoint.trim() || null;
        if (patch.deliveryDesc !== undefined) set.deliveryDesc = patch.deliveryDesc.trim() || null;
        if (patch.evalDesc !== undefined) set.evalDesc = patch.evalDesc.trim() || null;
        if (patch.itemName !== undefined) set.itemName = patch.itemName.trim() || current.itemName;
        if (patch.sheetName !== undefined) set.sheetName = patch.sheetName.trim() || null;
        if (patch.appGroup !== undefined) set.appGroup = patch.appGroup.trim() || null;
        if (patch.defaultIncluded !== undefined) set.defaultIncluded = patch.defaultIncluded;
        if (patch.groupName !== undefined) set.groupName = patch.groupName.trim() || current.groupName;
        if (patch.sortOrder !== undefined) set.sortOrder = normalizeSortOrder(patch.sortOrder);

        const rows = await tx
          .update(productSkuModuleAssignments)
          .set(set)
          .where(eq(productSkuModuleAssignments.id, id))
          .returning();
        const names = await resolveAssignmentNames(tx, rows[0]);
        return rowToAssignment(rows[0], names);
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function setAssignmentStatus(id: string, status: "active" | "inactive"): Promise<ProductSkuModuleAssignment> {
    parseStatus(status);
    try {
      return await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const rows = await tx
          .update(productSkuModuleAssignments)
          .set({ status, updatedAt: now })
          .where(eq(productSkuModuleAssignments.id, id))
          .returning();
        if (!rows[0]) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `关联不存在: ${id}`);
        const names = await resolveAssignmentNames(tx, rows[0]);
        return rowToAssignment(rows[0], names);
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function updateEntity(
    table: typeof productLines | typeof productSkus | typeof productModules,
    id: string,
    patch: ProductMasterDataPatch,
    label: string,
  ): Promise<ProductLine> {
    try {
      return await dbInstance.transaction(async (tx) => {
        const current = await lockEntityRow(tx, table, id);
        if (!current) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `${label}不存在: ${id}`);
        const nextName = patch.name === undefined ? current.name : normalizeName(patch.name, label);
        const nextSortOrder = patch.sortOrder === undefined ? current.sortOrder : normalizeSortOrder(patch.sortOrder);
        if (nextName !== current.name) {
          await ensureNameFree(tx, table, nextName, id);
        }
        const now = await readDbNow(tx);
        const rows = await tx.update(table).set({ name: nextName, sortOrder: nextSortOrder, updatedAt: now }).where(eq(table.id, id)).returning();
        return rowToProductLine(rows[0]);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `${label}名称已存在`);
      throw toSafeError(err);
    }
  }

  async function setEntityStatus(
    table: typeof productLines | typeof productSkus | typeof productModules,
    id: string,
    status: "active" | "inactive",
    label: string,
  ): Promise<ProductLine> {
    parseStatus(status);
    try {
      return await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const rows = await tx.update(table).set({ status, updatedAt: now }).where(eq(table.id, id)).returning();
        if (!rows[0]) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `${label}不存在: ${id}`);
        return rowToProductLine(rows[0]);
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function getActiveTemplateMeta(): Promise<ProductTemplateMeta | null> {
    try {
      const rows = await dbInstance
        .select()
        .from(productTemplates)
        .where(eq(productTemplates.isActive, true))
        .orderBy(asc(productTemplates.updatedAt), asc(productTemplates.templateId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        templateName: row.templateName,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function setActiveTemplateMeta(meta: Omit<ProductTemplateMeta, "createdAt" | "updatedAt">): Promise<void> {
    try {
      await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        await tx.update(productTemplates).set({ isActive: false }).where(eq(productTemplates.isActive, true));
        await tx
          .insert(productTemplates)
          .values({
            templateId: meta.templateId,
            templateVersion: meta.templateVersion,
            templateName: meta.templateName,
            isActive: meta.isActive,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: productTemplates.templateId,
            set: {
              templateVersion: meta.templateVersion,
              templateName: meta.templateName,
              isActive: true,
              updatedAt: now,
            },
          });
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  return {
    __dbForTest() {
      return dbInstance;
    },
    listAssignments,
    listActiveAssignments,
    listProductLines,
    listProductSkus,
    listProductModules,
    getAssignment,
    createProductLine,
    createProductSku,
    createProductModule,
    createAssignment,
    updateAssignment,
    setAssignmentStatus,
    updateProductLine: (id: string, patch: ProductMasterDataPatch) => updateEntity(productLines, id, patch, "产品"),
    updateProductSku: (id: string, patch: ProductMasterDataPatch) => updateEntity(productSkus, id, patch, "SKU"),
    updateProductModule: (id: string, patch: ProductMasterDataPatch) => updateEntity(productModules, id, patch, "模块"),
    setProductLineStatus: (id: string, status: "active" | "inactive") => setEntityStatus(productLines, id, status, "产品"),
    setProductSkuStatus: (id: string, status: "active" | "inactive") => setEntityStatus(productSkus, id, status, "SKU"),
    setProductModuleStatus: (id: string, status: "active" | "inactive") => setEntityStatus(productModules, id, status, "模块"),
    getActiveTemplateMeta,
    setActiveTemplateMeta,
  };
}

export type ProductMasterDataPgRepository = ReturnType<typeof createProductMasterDataPgRepository>;
