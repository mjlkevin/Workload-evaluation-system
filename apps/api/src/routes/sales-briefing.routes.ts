// ============================================================
// Sales Briefing Routes — 销售快报 Skill API
// ============================================================
// P1-2 端点：商机档案 CRUD + 区间报价生成 + 分期方案 + 变更重算
//
// 能力位映射：
//   - POST/GET/PATCH/DELETE /sales/briefs  → estimates:create / estimates:read
//   - POST /sales/briefs/:id/quote         → estimates:create
//   - POST /sales/briefs/:id/recalculate   → estimates:create

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import * as SalesBriefingModule from "../modules/sales-briefing/sales-briefing.module";

const router = Router();

router.post("/briefs", requireCapability("estimates:create"), SalesBriefingModule.postBrief);
router.get("/briefs", requireAnyCapability("estimates:read", "estimates:create"), SalesBriefingModule.listBriefsHandler);
router.get("/briefs/:id", requireAnyCapability("estimates:read", "estimates:create"), SalesBriefingModule.getBriefHandler);
router.patch("/briefs/:id", requireCapability("estimates:create"), SalesBriefingModule.patchBrief);
router.delete("/briefs/:id", requireCapability("estimates:create"), SalesBriefingModule.deleteBriefHandler);
router.post("/briefs/:id/quote", requireCapability("estimates:create"), SalesBriefingModule.generateQuoteHandler);
router.post("/briefs/:id/recalculate", requireCapability("estimates:create"), SalesBriefingModule.recalculateHandler);

export default router;
