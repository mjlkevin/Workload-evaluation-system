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

import { ok } from "../utils/response";

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

export default router;
