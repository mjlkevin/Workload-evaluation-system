// ============================================================
// 规则路由
// ============================================================

import { Router } from "express";
import * as RulesModule from "../modules/rules/rules.module";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";

const router = Router();

router.get("/active", requireAnyCapability("rule:manage", "estimates:read"), RulesModule.getActiveRuleSet);
router.get("/meta", requireAnyCapability("rule:manage", "estimates:read"), RulesModule.getRuleSetMeta);
router.post("/import-json", requireCapability("rule:manage"), RulesModule.importRuleSetJson);

export default router;
