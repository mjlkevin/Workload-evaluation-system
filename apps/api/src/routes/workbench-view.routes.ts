// ============================================================
// Workbench 统一视图路由（O5 Sprint 3A）
// ============================================================
// 挂载 /api/v1/ai/home-workbench/view
// JWT 鉴权，返回统一视图数据

import { Router } from "express";

import { createHarnessRuntimeRepository } from "../modules/harness/harness-runtime.repository";
import { createWorkbenchViewHandlers } from "../modules/harness/workbench-view.controller";
import { createWorkbenchViewUsecase } from "../modules/harness/workbench-view.usecase";

export function createWorkbenchViewRouter(): Router {
  // repo 缺省接全局懒加载 db 代理（模块加载不建连接）
  const repo = createHarnessRuntimeRepository();
  const usecase = createWorkbenchViewUsecase({ repo });
  const handlers = createWorkbenchViewHandlers({ usecase });

  const router = Router();
  router.get("/view", handlers.getWorkbenchViewHandler);
  return router;
}

export default createWorkbenchViewRouter;
