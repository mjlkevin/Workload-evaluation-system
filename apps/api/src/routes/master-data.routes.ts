// ============================================================
// 批次 10a · 基础管理（行业主数据）路由
// ============================================================
// 挂载点 /api/v1/master-data，权限沿用既有能力位口径：
//   读  estimates:read  —— 新建单据要取行业下拉，业务角色必须读得到
//   写  system:manage   —— 主数据维护是管理动作，admin 专属
// 与 knowledge.routes.ts 的读写分级同形。
//
// DELETE 显式注册并必然回 405（禁硬删的第三层，见 industry.controller.ts）。

import { Router } from "express";

import { createIndustryHandlers } from "../modules/master-data/industry.controller";
import type { IndustryStoreRepository } from "../modules/master-data/industry.repository";
import { requireCapability } from "../rbac/middleware";

export interface MasterDataRouterDeps {
  repo: IndustryStoreRepository;
}

export function createMasterDataRouter({ repo }: MasterDataRouterDeps): Router {
  const router = Router();
  const handlers = createIndustryHandlers(repo);
  const readGuard = requireCapability("estimates:read");
  const writeGuard = requireCapability("system:manage");

  // 行业：两层树 + 新建单据选项（读）
  router.get("/industries/tree", readGuard, handlers.treeHandler);
  router.get("/industries/options", readGuard, handlers.optionsHandler);

  // 行业：一级大类（写）
  router.post("/industries/categories", writeGuard, handlers.createCategoryHandler);
  router.patch("/industries/categories/:id", writeGuard, handlers.updateCategoryHandler);
  router.post("/industries/categories/:id/status", writeGuard, handlers.setCategoryStatusHandler);

  // 行业：二级细分（写）
  router.post("/industries/subcategories", writeGuard, handlers.createSubcategoryHandler);
  router.patch("/industries/subcategories/:id", writeGuard, handlers.updateSubcategoryHandler);
  router.post("/industries/subcategories/:id/status", writeGuard, handlers.setSubcategoryStatusHandler);

  // 硬删一律 405（注册路由的目的就是让拒绝有合同语义，而不是 404 查无此接口）
  router.delete("/industries/categories/:id", writeGuard, handlers.deleteForbiddenHandler);
  router.delete("/industries/subcategories/:id", writeGuard, handlers.deleteForbiddenHandler);

  return router;
}
