// ============================================================
// 导出历史与下载路由
// ============================================================

import { Router } from "express";
import * as ExportsModule from "../modules/exports/exports.module";

const router = Router();

// 导出历史列表
router.get("/history", ExportsModule.history);

export default router;
