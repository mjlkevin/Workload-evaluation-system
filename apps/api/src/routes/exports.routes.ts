// ============================================================
// 导出历史与下载路由
// ============================================================

import { Router } from "express";
import * as ExportsModule from "../modules/exports/exports.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

// 导出历史列表
router.get("/history", requireCapability("estimates:read"), ExportsModule.history);

export default router;
