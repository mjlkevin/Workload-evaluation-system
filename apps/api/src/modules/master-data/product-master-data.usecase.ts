// ============================================================
// 批次 10b · 产品主数据用例
// ============================================================
// 纯函数：列表排序、树/选项组装、快照构建。

import type {
  ProductLine,
  ProductModule,
  ProductSku,
  ProductSkuModuleAssignment,
} from "./product-master-data.types";

/**
 * 确定性排序：sort_order → 创建时间 → id。
 * 与 industry.usecase.sortMasterData 同口径：按录入顺序稳定呈现。
 */
export function sortMasterData<T extends { sortOrder: number; createdAt: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return (a.createdAt < b.createdAt ? -1 : 1);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 按产品→SKU→模块三级组装树（管理页展示用）。 */
export function buildProductMasterDataTree(
  assignments: ProductSkuModuleAssignment[],
): Array<{
  id: string;
  name: string;
  status: "active" | "inactive";
  children: Array<{
    id: string;
    name: string;
    status: "active" | "inactive";
    children: ProductSkuModuleAssignment[];
  }>;
}> {
  const byProduct = new Map<string, { product: ProductLine | null; skus: Map<string, ProductSku | null>; items: ProductSkuModuleAssignment[] }>();

  for (const item of assignments) {
    let bucket = byProduct.get(item.productId);
    if (!bucket) {
      bucket = { product: null, skus: new Map(), items: [] };
      byProduct.set(item.productId, bucket);
    }
    bucket.items.push(item);
    if (!bucket.product) {
      bucket.product = {
        id: item.productId,
        name: item.productName,
        status: item.status,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }
    if (!bucket.skus.has(item.skuId)) {
      bucket.skus.set(item.skuId, {
        id: item.skuId,
        name: item.skuName,
        status: item.status,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    }
  }

  const tree: ReturnType<typeof buildProductMasterDataTree> = [];
  for (const bucket of byProduct.values()) {
    const skuNodes: Array<NonNullable<ReturnType<typeof buildProductMasterDataTree>[number]["children"][number]>> = [];
    for (const [skuId, sku] of bucket.skus) {
      const skuItems = sortMasterData(bucket.items.filter((it) => it.skuId === skuId));
      skuNodes.push({ id: skuId, name: sku?.name ?? "", status: sku?.status ?? "active", children: skuItems });
    }
    tree.push({
      id: bucket.product?.id ?? "",
      name: bucket.product?.name ?? "",
      status: bucket.product?.status ?? "active",
      children: skuNodes,
    });
  }
  return tree;
}

/** 生成新建单据/管理页表单的选项：只含启用项，value 为 id。 */
export function buildProductOptions(products: ProductLine[]): Array<{ value: string; label: string }> {
  return sortMasterData(products)
    .filter((p) => p.status === "active")
    .map((p) => ({ value: p.id, label: p.name }));
}

export function buildSkuOptions(skus: ProductSku[]): Array<{ value: string; label: string }> {
  return sortMasterData(skus)
    .filter((s) => s.status === "active")
    .map((s) => ({ value: s.id, label: s.name }));
}

export function buildModuleOptions(modules: ProductModule[]): Array<{ value: string; label: string }> {
  return sortMasterData(modules)
    .filter((m) => m.status === "active")
    .map((m) => ({ value: m.id, label: m.name }));
}

/**
 * 构建产品主数据快照。
 * 用于 dev_assessments.context_snapshot / assessment_versions.payload，
 * 保证「当时是多少就是多少」。
 */
export function buildProductMasterSnapshot(assignments: ProductSkuModuleAssignment[]): Record<string, unknown> {
  return {
    capturedAt: new Date().toISOString(),
    assignments: sortMasterData(assignments).map((a) => ({
      productId: a.productId,
      productName: a.productName,
      skuId: a.skuId,
      skuName: a.skuName,
      moduleId: a.moduleId,
      moduleName: a.moduleName,
      standardDays: a.standardDays,
      deliveryPoint: a.deliveryPoint,
      deliveryDesc: a.deliveryDesc,
      evalDesc: a.evalDesc,
      templateItemId: a.templateItemId,
    })),
  };
}
