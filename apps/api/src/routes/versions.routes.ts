// ============================================================
// 版本管理路由
// ============================================================

import { Router } from "express";
import * as VersionsModule from "../modules/versions/versions.module";

const router = Router();

router.get("/", VersionsModule.listVersions);
router.post("/", VersionsModule.createVersion);
router.patch("/:recordId/status", VersionsModule.updateVersionStatus);
router.delete("/:type/:versionCode", VersionsModule.deleteVersion);

// 检入检出升版
router.post("/:id/checkout", VersionsModule.checkoutVersion);
router.post("/:id/checkin", VersionsModule.checkinVersion);
router.post("/:id/undo-checkout", VersionsModule.undoCheckout);
router.post("/:id/promote", VersionsModule.promoteVersion);
router.patch("/:id/force-unlock", VersionsModule.forceUnlockVersion);

export default router;
