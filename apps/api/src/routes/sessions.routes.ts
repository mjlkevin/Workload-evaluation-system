// ============================================================
// 会话路由
// ============================================================

import { Router } from "express";
import * as SessionsModule from "../modules/sessions/sessions.module";

const router = Router();

router.post("/start", SessionsModule.startSession);
router.post("/:sessionId/calculate", SessionsModule.calculateInSession);

export default router;
