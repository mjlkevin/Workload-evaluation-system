// ============================================================
// History Project Routes — 历史项目库 API（P2-4）
// ============================================================
// 覆盖 US-19：老客户二期继承一期起点，只问增量部分。
//
// 能力位映射：
//   - POST   /history/projects                    → assessment:create
//   - GET    /history/projects                    → estimates:read
//   - GET    /history/projects/:id                → estimates:read
//   - PATCH  /history/projects/:id                → estimates:write
//   - DELETE /history/projects/:id                → assessment:create
//   - POST   /history/projects/:id/close-from-baseline → assessment:create
//   - GET    /history/similar                     → estimates:read

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import * as HistoryModule from "../modules/history/history.module";

const router = Router();

router.post("/projects", requireCapability("assessment:create"), HistoryModule.postProject);
router.get("/projects", requireAnyCapability("estimates:read", "estimates:write"), HistoryModule.listProjectsHandler);
router.get("/projects/:id", requireAnyCapability("estimates:read", "estimates:write"), HistoryModule.getProjectHandler);
router.patch("/projects/:id", requireCapability("estimates:write"), HistoryModule.patchProject);
router.delete("/projects/:id", requireCapability("assessment:create"), HistoryModule.deleteProject);
router.post("/projects/:id/close-from-baseline", requireCapability("assessment:create"), HistoryModule.closeFromBaseline);
router.get("/similar", requireAnyCapability("estimates:read", "estimates:write"), HistoryModule.findSimilarHandler);

export default router;
