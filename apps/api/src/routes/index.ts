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
import sessionsRoutes from "./sessions.routes";
import exportsRoutes from "./exports.routes";
import teamRoutes from "./team.routes";
import wbsRoutes from "./wbs.routes";
import systemRoutes from "./system.routes";
import presalesRoutes from "./presales.routes";
import pmRoutes from "./pm.routes";

import { ok } from "../utils/response";
import { notFoundHandler } from "../middleware/error-handler";

const router = Router();

// 健康检查
router.get("/health", (_req, res) => {
  res.json(ok({ service: "workload-api", status: "up" }));
});

// 业务路由
router.use("/auth", authRoutes);
router.use("/versions", versionsRoutes);
router.use("/templates", templatesRoutes);
router.use("/rule-sets", rulesRoutes);
router.use("/estimates", estimatesRoutes);
router.use("/ai", aiRoutes);
router.use("/sessions", sessionsRoutes);
router.use("/exports", exportsRoutes);
router.use("/teams", teamRoutes);
router.use("/wbs", wbsRoutes);
router.use("/system", systemRoutes);
router.use("/presales", presalesRoutes);
router.use("/pm", pmRoutes);

/** 未匹配 /api/v1/* 时返回标准 JSON，避免 Express 默认纯文本 404 导致前端误判为「非 JSON」 */
router.use((req, res) => {
  notFoundHandler(req, res);
});

export default router;
