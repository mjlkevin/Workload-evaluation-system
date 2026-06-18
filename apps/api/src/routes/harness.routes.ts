// ============================================================
// Harness Routes
// ============================================================
// Phase 1A 路由：挂载于 /api/v1/harness。提供运行创建、查询、文件绑定、
// 补充信息、动作确认、重试/重新分析以及 SSE 事件占位接口。

import { Router } from "express";

import {
  bindFileHandler,
  confirmActionHandler,
  createRunHandler,
  eventsHandler,
  generateReportV1Handler,
  generateReportV2Handler,
  getRunHandler,
  listRunsHandler,
  reanalyzeRunHandler,
  retryRunHandler,
  submitAnswersHandler,
  submitParseResultHandler,
  type HarnessControllerDeps,
} from "../modules/harness/harness.module";

export function createHarnessRouter(deps: HarnessControllerDeps = {}) {
  const router = Router();

  router.post("/runs", createRunHandler(deps));
  router.get("/runs", listRunsHandler(deps));
  router.get("/runs/:runId", getRunHandler(deps));
  router.get("/runs/:runId/events", eventsHandler(deps));
  router.post("/runs/:runId/files", bindFileHandler(deps));
  router.post("/runs/:runId/parse-result", submitParseResultHandler(deps));
  router.post("/runs/:runId/report-v1", generateReportV1Handler(deps));
  router.post("/runs/:runId/report-v2", generateReportV2Handler(deps));
  router.post("/runs/:runId/answers", submitAnswersHandler(deps));
  router.post("/runs/:runId/actions/:actionId/confirm", confirmActionHandler(deps));
  router.post("/runs/:runId/retry", retryRunHandler(deps));
  router.post("/runs/:runId/reanalyze", reanalyzeRunHandler(deps));

  return router;
}

export default createHarnessRouter();
