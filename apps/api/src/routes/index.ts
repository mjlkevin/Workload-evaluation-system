// ============================================================
// 路由注册入口
// ============================================================

import { Router } from "express";

import authRoutes from "./auth.routes";
import versionsRoutes from "./versions.routes";
import templatesRoutes from "./templates.routes";
import rulesRoutes from "./rules.routes";
import estimatesRoutes from "./estimates.routes";
import aiRoutes from "./ai.routes";
import { createAiSessionsRouter } from "./ai-sessions.routes";
import { createAiRunsRouter } from "./ai-runs.routes";
import projectEvaluationsRoutes from "./project-evaluations.routes";
import sessionsRoutes from "./sessions.routes";
import exportsRoutes from "./exports.routes";
import teamRoutes from "./team.routes";
import wbsRoutes from "./wbs.routes";
import systemRoutes from "./system.routes";
import presalesRoutes from "./presales.routes";
import pmRoutes from "./pm.routes";
import salesBriefingRoutes from "./sales-briefing.routes";
import collabRoutes from "./collab.routes";
import devAssessmentRoutes from "./dev-assessment.routes";
import changeRoutes from "./change.routes";
import historyRoutes from "./history.routes";
import agentRoutes from "./agent.routes";
import harnessRoutes from "./harness.routes";
import traceRoutes from "./trace.routes";
import { createKnowledgeRouter } from "./knowledge.routes";

import { notFoundHandler } from "../middleware/error-handler";
import { isDurableRunsEnabledFromEnv } from "../modules/harness/harness-runtime.usecase";
import { createHarnessRuntimeRepository } from "../modules/harness/harness-runtime.repository";
import { getKnowledgeRepository } from "../modules/knowledge/knowledge.module";

const router = Router();

// RP-047 Batch C：异步 Run API 接线（flag 读取点收敛于此，D2）
const durableRunsEnabled = isDurableRunsEnabledFromEnv();
const harnessRuntimeRepo = createHarnessRuntimeRepository();
const aiSessionsRoutes = createAiSessionsRouter({ repo: harnessRuntimeRepo, enabled: durableRunsEnabled });
const aiRunsRoutes = createAiRunsRouter({ repo: harnessRuntimeRepo, enabled: durableRunsEnabled });

// SP-2026-007 MS1：知识库中文混合检索（BM25 + RRF + 三重护栏）
const knowledgeRoutes = createKnowledgeRouter({ repo: getKnowledgeRepository() });

// 业务路由
router.use("/auth", authRoutes);
router.use("/versions", versionsRoutes);
router.use("/templates", templatesRoutes);
router.use("/rule-sets", rulesRoutes);
router.use("/estimates", estimatesRoutes);
router.use("/ai", aiRoutes);
router.use("/ai-sessions", aiSessionsRoutes);
router.use("/ai-runs", aiRunsRoutes);
router.use("/project-evaluations", projectEvaluationsRoutes);
router.use("/sessions", sessionsRoutes);
router.use("/exports", exportsRoutes);
router.use("/teams", teamRoutes);
router.use("/wbs", wbsRoutes);
router.use("/system", systemRoutes);
router.use("/presales", presalesRoutes);
router.use("/pm", pmRoutes);
router.use("/sales", salesBriefingRoutes);
router.use("/collab", collabRoutes);
router.use("/dev-assessments", devAssessmentRoutes);
router.use("/change", changeRoutes);
router.use("/history", historyRoutes);
router.use("/agent", agentRoutes);
router.use("/harness", harnessRoutes);
router.use("/traces", traceRoutes);
router.use("/knowledge", knowledgeRoutes);

/** 未匹配 /api/v1/* 时返回标准 JSON，避免 Express 默认纯文本 404 导致前端误判为「非 JSON」 */
router.use((req, res) => {
  notFoundHandler(req, res);
});

export default router;
