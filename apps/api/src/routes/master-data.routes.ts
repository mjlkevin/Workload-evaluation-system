// ============================================================
// 批次 10a/10b · 基础管理路由
// ============================================================
// 挂载点 /api/v1/master-data，权限沿用既有能力位口径：
//   读  estimates:read  —— 新建单据要取下拉
//   写  system:manage   —— 主数据维护是 admin 专属

import { Router } from "express";

import { createIndustryHandlers } from "../modules/master-data/industry.controller";
import { createProductMasterDataHandlers } from "../modules/master-data/product-master-data.controller";
import type { IndustryStoreRepository } from "../modules/master-data/industry.repository";
import type { ProductMasterDataStoreRepository } from "../modules/master-data/product-master-data.repository";
import { requireCapability } from "../rbac/middleware";

export interface MasterDataRouterDeps {
  industryRepo: IndustryStoreRepository;
  productRepo: ProductMasterDataStoreRepository;
}

export function createMasterDataRouter({ industryRepo, productRepo }: MasterDataRouterDeps): Router {
  const router = Router();
  const industryHandlers = createIndustryHandlers(industryRepo);
  const productHandlers = createProductMasterDataHandlers(productRepo as any);
  const readGuard = requireCapability("estimates:read");
  const writeGuard = requireCapability("system:manage");

  // 行业：两层树 + 新建单据选项（读）
  router.get("/industries/tree", readGuard, industryHandlers.treeHandler);
  router.get("/industries/options", readGuard, industryHandlers.optionsHandler);

  // 行业：一级大类（写）
  router.post("/industries/categories", writeGuard, industryHandlers.createCategoryHandler);
  router.patch("/industries/categories/:id", writeGuard, industryHandlers.updateCategoryHandler);
  router.post("/industries/categories/:id/status", writeGuard, industryHandlers.setCategoryStatusHandler);

  // 行业：二级细分（写）
  router.post("/industries/subcategories", writeGuard, industryHandlers.createSubcategoryHandler);
  router.patch("/industries/subcategories/:id", writeGuard, industryHandlers.updateSubcategoryHandler);
  router.post("/industries/subcategories/:id/status", writeGuard, industryHandlers.setSubcategoryStatusHandler);

  // 行业：硬删一律 405
  router.delete("/industries/categories/:id", writeGuard, industryHandlers.deleteForbiddenHandler);
  router.delete("/industries/subcategories/:id", writeGuard, industryHandlers.deleteForbiddenHandler);

  // 产品主数据：树 + 选项（读）
  router.get("/products/tree", readGuard, productHandlers.treeHandler);
  router.get("/products/options", readGuard, productHandlers.optionsHandler);

  // 产品主数据：实体（写）
  router.post("/products/lines", writeGuard, productHandlers.createProductLineHandler);
  router.patch("/products/lines/:id", writeGuard, productHandlers.updateProductLineHandler);
  router.post("/products/lines/:id/status", writeGuard, productHandlers.setProductLineStatusHandler);

  router.post("/products/skus", writeGuard, productHandlers.createProductSkuHandler);
  router.patch("/products/skus/:id", writeGuard, productHandlers.updateProductSkuHandler);
  router.post("/products/skus/:id/status", writeGuard, productHandlers.setProductSkuStatusHandler);

  router.post("/products/modules", writeGuard, productHandlers.createProductModuleHandler);
  router.patch("/products/modules/:id", writeGuard, productHandlers.updateProductModuleHandler);
  router.post("/products/modules/:id/status", writeGuard, productHandlers.setProductModuleStatusHandler);

  // 产品主数据：关联（写）
  router.post("/products/assignments", writeGuard, productHandlers.createAssignmentHandler);
  router.patch("/products/assignments/:id", writeGuard, productHandlers.updateAssignmentHandler);
  router.post("/products/assignments/:id/status", writeGuard, productHandlers.setAssignmentStatusHandler);

  // 产品主数据：硬删一律 405
  router.delete("/products/lines/:id", writeGuard, productHandlers.deleteForbiddenHandler);
  router.delete("/products/skus/:id", writeGuard, productHandlers.deleteForbiddenHandler);
  router.delete("/products/modules/:id", writeGuard, productHandlers.deleteForbiddenHandler);
  router.delete("/products/assignments/:id", writeGuard, productHandlers.deleteForbiddenHandler);

  return router;
}
