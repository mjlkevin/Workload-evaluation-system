// ============================================================
// 批次 10b · 产品主数据 in-memory 替身（路由测试用）
// ============================================================
// 仅实现路由测试所需的最小集合；不碰 PG，故相关路由测试文件不进串行组。

import { MasterDataError } from "../modules/master-data/industry-pg.repository";
import type {
  CreateAssignmentInput,
  CreateProductLineInput,
  CreateProductModuleInput,
  CreateProductSkuInput,
  ProductLine,
  ProductMasterDataPatch,
  ProductModule,
  ProductSku,
  ProductSkuModuleAssignment,
  ProductTemplateMeta,
  UpdateAssignmentInput,
} from "../modules/master-data/product-master-data.types";

export function createProductMasterDataInMemoryRepository() {
  const lines: ProductLine[] = [];
  const skus: ProductSku[] = [];
  const modules: ProductModule[] = [];
  const assignments: ProductSkuModuleAssignment[] = [];

  return {
    listAssignments: async () => assignments,
    listActiveAssignments: async () => assignments.filter((a) => a.status === "active"),
    listProductLines: async () => lines,
    listProductSkus: async () => skus,
    listProductModules: async () => modules,
    getAssignment: async (id: string) => assignments.find((a) => a.id === id) ?? null,
    createProductLine: async (input: CreateProductLineInput) => {
      const name = input.name.trim();
      if (!name) throw new MasterDataError("MASTER_DATA_INVALID", "产品名称不能为空");
      if (lines.some((l) => l.name === name)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `产品名称已存在: ${name}`);
      const row: ProductLine = {
        id: input.id || `product-line-${lines.length + 1}`,
        name,
        status: "active",
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      lines.push(row);
      return row;
    },
    createProductSku: async (input: CreateProductSkuInput) => {
      const name = input.name.trim();
      if (!name) throw new MasterDataError("MASTER_DATA_INVALID", "SKU 名称不能为空");
      if (skus.some((s) => s.name === name)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `SKU 名称已存在: ${name}`);
      const row: ProductSku = {
        id: input.id || `product-sku-${skus.length + 1}`,
        name,
        status: "active",
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      skus.push(row);
      return row;
    },
    createProductModule: async (input: CreateProductModuleInput) => {
      const name = input.name.trim();
      if (!name) throw new MasterDataError("MASTER_DATA_INVALID", "模块名称不能为空");
      if (modules.some((m) => m.name === name)) throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `模块名称已存在: ${name}`);
      const row: ProductModule = {
        id: input.id || `product-module-${modules.length + 1}`,
        name,
        status: "active",
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      modules.push(row);
      return row;
    },
    createAssignment: async (input: CreateAssignmentInput) => {
      const product = lines.find((l) => l.id === input.productId);
      const sku = skus.find((s) => s.id === input.skuId);
      const module = modules.find((m) => m.id === input.moduleId);
      if (!product || !sku || !module) throw new MasterDataError("MASTER_DATA_NOT_FOUND", "实体不存在");
      if (assignments.some((a) => a.productId === input.productId && a.skuId === input.skuId && a.moduleId === input.moduleId)) {
        throw new MasterDataError("MASTER_DATA_NAME_EXISTS", "该产品 + SKU + 模块组合已存在");
      }
      const row: ProductSkuModuleAssignment = {
        id: `assignment-${assignments.length + 1}`,
        productId: input.productId,
        productName: product.name,
        skuId: input.skuId,
        skuName: sku.name,
        moduleId: input.moduleId ?? null,
        moduleName: module?.name ?? null,
        templateItemId: input.templateItemId || `item-${assignments.length + 1}`,
        groupId: input.groupId || `grp-${product.name}-${sku.name}`,
        groupName: input.groupName || sku.name || product.name || "未分组",
        itemName: input.itemName || input.deliveryPoint || module.name || sku.name || product.name,
        sheetName: input.sheetName,
        appGroup: input.appGroup,
        defaultIncluded: input.defaultIncluded ?? false,
        deliveryPoint: input.deliveryPoint,
        deliveryDesc: input.deliveryDesc,
        evalDesc: input.evalDesc,
        standardDays: input.standardDays,
        status: "active",
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      assignments.push(row);
      return row;
    },
    updateAssignment: async (id: string, patch: UpdateAssignmentInput) => {
      const idx = assignments.findIndex((a) => a.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `关联不存在: ${id}`);
      assignments[idx] = { ...assignments[idx], ...patch, updatedAt: new Date().toISOString() };
      return assignments[idx];
    },
    updateProductLine: async (id: string, patch: ProductMasterDataPatch) => {
      const idx = lines.findIndex((l) => l.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `产品不存在: ${id}`);
      if (patch.name) lines[idx].name = patch.name.trim();
      if (patch.sortOrder !== undefined) lines[idx].sortOrder = Number(patch.sortOrder);
      lines[idx].updatedAt = new Date().toISOString();
      return lines[idx];
    },
    updateProductSku: async (id: string, patch: ProductMasterDataPatch) => {
      const idx = skus.findIndex((s) => s.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `SKU 不存在: ${id}`);
      if (patch.name) skus[idx].name = patch.name.trim();
      if (patch.sortOrder !== undefined) skus[idx].sortOrder = Number(patch.sortOrder);
      skus[idx].updatedAt = new Date().toISOString();
      return skus[idx];
    },
    updateProductModule: async (id: string, patch: ProductMasterDataPatch) => {
      const idx = modules.findIndex((m) => m.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `模块不存在: ${id}`);
      if (patch.name) modules[idx].name = patch.name.trim();
      if (patch.sortOrder !== undefined) modules[idx].sortOrder = Number(patch.sortOrder);
      modules[idx].updatedAt = new Date().toISOString();
      return modules[idx];
    },
    setAssignmentStatus: async (id: string, status: "active" | "inactive") => {
      const idx = assignments.findIndex((a) => a.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `关联不存在: ${id}`);
      assignments[idx].status = status;
      assignments[idx].updatedAt = new Date().toISOString();
      return assignments[idx];
    },
    setProductLineStatus: async (id: string, status: "active" | "inactive") => {
      const idx = lines.findIndex((l) => l.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `产品不存在: ${id}`);
      lines[idx].status = status;
      lines[idx].updatedAt = new Date().toISOString();
      return lines[idx];
    },
    setProductSkuStatus: async (id: string, status: "active" | "inactive") => {
      const idx = skus.findIndex((s) => s.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `SKU 不存在: ${id}`);
      skus[idx].status = status;
      skus[idx].updatedAt = new Date().toISOString();
      return skus[idx];
    },
    setProductModuleStatus: async (id: string, status: "active" | "inactive") => {
      const idx = modules.findIndex((m) => m.id === id);
      if (idx < 0) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `模块不存在: ${id}`);
      modules[idx].status = status;
      modules[idx].updatedAt = new Date().toISOString();
      return modules[idx];
    },
    getActiveTemplateMeta: async () => null,
    setActiveTemplateMeta: async () => { /* no-op */ },
  };
}
