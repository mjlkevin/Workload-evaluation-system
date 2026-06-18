// ============================================================
// 会话路由
// ============================================================

import { Router } from "express";
import * as SessionsModule from "../modules/sessions/sessions.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.post("/start", requireCapability("estimates:create"), SessionsModule.startSession);
router.post("/:sessionId/calculate", requireCapability("estimates:create"), SessionsModule.calculateInSession);

export default router;
