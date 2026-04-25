import { Router } from "express";
import * as SystemModule from "../modules/system/system.module";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";

const router = Router();

router.get("/version-code-rules", requireCapability("system:manage"), SystemModule.listVersionCodeRules);
router.patch("/version-code-rules/:ruleId/config", requireCapability("system:manage"), SystemModule.updateVersionCodeRuleConfig);
router.post("/version-code-rules/:ruleId/activate", requireCapability("system:manage"), SystemModule.activateVersionCodeRule);
router.post("/version-code-rules/:ruleId/disable", requireCapability("system:manage"), SystemModule.disableVersionCodeRule);
router.get("/requirement-settings", requireAnyCapability("system:manage", "requirement:upload"), SystemModule.getRequirementSystemConfig);
router.patch("/requirement-settings/draft", requireCapability("system:manage"), SystemModule.updateRequirementSystemConfigDraft);
router.post("/requirement-settings/activate", requireCapability("system:manage"), SystemModule.activateRequirementSystemConfig);
router.post("/requirement-settings/kimi-api-key/test", requireCapability("system:manage"), SystemModule.testRequirementKimiApiKey);
router.get("/implementation-dependency-rules", requireAnyCapability("system:manage", "rule:manage"), SystemModule.getImplementationDependencyRules);
router.patch("/implementation-dependency-rules/draft", requireAnyCapability("system:manage", "rule:manage"), SystemModule.updateImplementationDependencyRulesDraft);
router.post("/implementation-dependency-rules/activate", requireAnyCapability("system:manage", "rule:manage"), SystemModule.activateImplementationDependencyRules);

export default router;
