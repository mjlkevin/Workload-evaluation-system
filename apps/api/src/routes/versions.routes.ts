// ============================================================
// 版本管理路由
// ============================================================

import { Router } from "express";
import * as VersionsModule from "../modules/versions/versions.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.get("/", requireCapability("estimates:read"), VersionsModule.listVersions);
router.post("/", requireCapability("estimates:create"), VersionsModule.createVersion);
router.patch("/:recordId/status", requireCapability("estimates:write"), VersionsModule.updateVersionStatus);
router.delete("/:type/:versionCode", requireCapability("estimates:write"), VersionsModule.deleteVersion);

// 检入检出升版
router.post("/:id/checkout", requireCapability("estimates:write"), VersionsModule.checkoutVersion);
router.patch("/:id/save-draft", requireCapability("estimates:write"), VersionsModule.saveCheckedOutDraft);
router.post("/:id/checkin", requireCapability("estimates:write"), VersionsModule.checkinVersion);
router.post("/:id/undo-checkout", requireCapability("estimates:write"), VersionsModule.undoCheckout);
router.post("/:id/promote", requireCapability("estimates:write"), VersionsModule.promoteVersion);
router.patch("/:id/force-unlock", requireCapability("system:manage"), VersionsModule.forceUnlockVersion);

export default router;
