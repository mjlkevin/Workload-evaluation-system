import { Router } from "express";
import * as SystemModule from "../modules/system/system.module";

const router = Router();

router.get("/version-code-rules", SystemModule.listVersionCodeRules);
router.patch("/version-code-rules/:ruleId/config", SystemModule.updateVersionCodeRuleConfig);
router.post("/version-code-rules/:ruleId/activate", SystemModule.activateVersionCodeRule);
router.post("/version-code-rules/:ruleId/disable", SystemModule.disableVersionCodeRule);

export default router;
