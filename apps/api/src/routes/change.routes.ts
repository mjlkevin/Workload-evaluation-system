// ============================================================
// Change Management Routes — 变更提报 API
// ============================================================
// P2-3 端点：ChangeSubmission 提交 / 查看 / 合并 / 驳回
//
// 能力位映射：
//   - POST   /change-submissions          → estimates:write
//   - GET    /change-submissions/:id      → estimates:read
//   - GET    /change-submissions          → estimates:read
//   - POST   /change-submissions/:id/merge → man-day:adjust
//   - POST   /change-submissions/:id/reject → man-day:adjust 或 deliverable:reject

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import * as ChangeModule from "../modules/change-management/change-management.module";

const router = Router();

router.post("/change-submissions", requireCapability("estimates:write"), ChangeModule.postChangeSubmission);
router.get("/change-submissions/:id", requireAnyCapability("estimates:read", "estimates:write"), ChangeModule.getChangeSubmissionHandler);
router.get("/change-submissions", requireAnyCapability("estimates:read", "estimates:write"), ChangeModule.listChangeSubmissionsHandler);
router.post("/change-submissions/:id/merge", requireCapability("man-day:adjust"), ChangeModule.mergeChangeHandler);
router.post("/change-submissions/:id/reject", requireAnyCapability("man-day:adjust", "deliverable:reject"), ChangeModule.rejectChangeHandler);

export default router;
