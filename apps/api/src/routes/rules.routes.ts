// ============================================================
// 规则路由
// ============================================================

import { Router } from "express";
import * as RulesModule from "../modules/rules/rules.module";

const router = Router();

router.get("/active", RulesModule.getActiveRuleSet);
router.get("/meta", RulesModule.getRuleSetMeta);
router.post("/import-json", RulesModule.importRuleSetJson);

export default router;
