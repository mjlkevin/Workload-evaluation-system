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

export default router;
