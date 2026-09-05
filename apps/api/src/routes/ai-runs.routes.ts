// ============================================================
// AI Runs 路由（RP-047 Batch C）
// ============================================================
// 挂载 /api/v1/ai-runs：active 列表、snapshot、SSE 回放、
// cancel / inputs / confirm / reject / retry 动作端点（规格 §2.2 + 批次 1a）。
// 路由工厂模式：enabled flag 与 SSE 时序参数可注入，
// 生产接线见 routes/index.ts（flag 读取点收敛，D2）。

import { Router } from "express";

import {
  createAiRunsHandlers,
  createRunEventsHandler,
} from "../modules/harness/harness-runtime.controller";
import { createAiRunsUsecase } from "../modules/harness/harness-runtime.usecase";
import type { HarnessRuntimeRepository } from "../modules/harness/harness-runtime.repository";
import { getAiSession } from "../modules/ai-sessions/ai-sessions.usecase";

export type AiRunsRouterDeps = {
  repo: HarnessRuntimeRepository;
  enabled: boolean;
  heartbeatMs?: number;
  pollMs?: number;
  batchLimit?: number;
};

export function createAiRunsRouter(deps: AiRunsRouterDeps): Router {
  const usecase = createAiRunsUsecase({
    repo: deps.repo,
    enabled: deps.enabled,
    // owner 归 ai-sessions 域：非 owner 与不存在同为 null → 上层 404
    findSession: async (user, sessionId) => getAiSession(user, sessionId),
  });
  const handlers = createAiRunsHandlers({ usecase });
  const eventsHandler = createRunEventsHandler({
    enabled: deps.enabled,
    repo: deps.repo,
    heartbeatMs: deps.heartbeatMs,
    pollMs: deps.pollMs,
    batchLimit: deps.batchLimit,
  });

  const router = Router();
  router.get("/", handlers.listActiveRunsHandler);
  router.get("/:runId", handlers.getRunSnapshotHandler);
  router.get("/:runId/events", eventsHandler);
  router.post("/:runId/cancel", handlers.cancelRunHandler);
  router.post("/:runId/inputs", handlers.submitInputsHandler);
  router.post("/:runId/actions/:actionId/confirm", handlers.confirmActionHandler);
  // 批次 1a · skip 档：拒绝与同意同为幂等动作，只认 actionId（不接收工具参数）
  router.post("/:runId/actions/:actionId/reject", handlers.rejectActionHandler);
  router.post("/:runId/retry", handlers.retryRunHandler);
  return router;
}

export default createAiRunsRouter;
