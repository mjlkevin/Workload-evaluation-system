import { Router } from "express";

import * as AiSessionsModule from "../modules/ai-sessions/ai-sessions.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.get("/", requireCapability("estimates:read"), AiSessionsModule.listSessions);
router.post("/", requireCapability("estimates:read"), AiSessionsModule.createSession);
router.get("/:sessionId", requireCapability("estimates:read"), AiSessionsModule.getSession);
router.delete("/:sessionId", requireCapability("estimates:read"), AiSessionsModule.deleteSession);
router.post("/:sessionId/events", requireCapability("estimates:read"), AiSessionsModule.appendSessionEvent);
router.post("/:sessionId/standard-drafts", requireCapability("system:manage"), AiSessionsModule.createStandardDraft);

export default router;
