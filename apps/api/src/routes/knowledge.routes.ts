// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.routes — 知识库检索与条目管理路由
// 读：estimates:read（与 AI 工作台/Trace 一致）
// 写/诊断：system:manage（ADMIN 专属）
// ============================================================

import { Router } from "express";

import { requireCapability } from "../rbac/middleware";
import type { KnowledgeStoreRepository } from "../modules/knowledge/knowledge.repository";
import { createKnowledgeHandlers } from "../modules/knowledge/knowledge.controller";

export interface KnowledgeRouterDeps {
  repo: KnowledgeStoreRepository;
}

export function createKnowledgeRouter({ repo }: KnowledgeRouterDeps): Router {
  const router = Router();
  const handlers = createKnowledgeHandlers(repo);

  // 检索（诊断前置阶段，任何业务角色可用）
  router.get("/search", requireCapability("estimates:read"), handlers.searchHandler);

  // 条目列表（含 archived，供管理查看）
  router.get("/entries", requireCapability("estimates:read"), handlers.listEntriesHandler);

  // 条目创建 / 归档（ADMIN 专属）
  router.post("/entries", requireCapability("system:manage"), handlers.createEntryHandler);
  router.post("/entries/:entryId/archive", requireCapability("system:manage"), handlers.archiveEntryHandler);

  // 检索诊断入口（先诊断后生产，仅 ADMIN）
  router.get("/diagnose", requireCapability("system:manage"), handlers.diagnoseHandler);

  return router;
}
