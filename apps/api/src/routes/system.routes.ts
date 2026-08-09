import { Router } from "express";
import * as AiSessionsModule from "../modules/ai-sessions/ai-sessions.module";
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
router.get("/knowledge-base-config", requireCapability("system:manage"), SystemModule.getKnowledgeBaseConfig);
router.patch("/knowledge-base-config/draft", requireCapability("system:manage"), SystemModule.updateKnowledgeBaseConfigDraft);
router.post("/knowledge-base-config/activate", requireCapability("system:manage"), SystemModule.activateKnowledgeBaseConfig);
router.post("/knowledge-base-config/test", requireCapability("system:manage"), SystemModule.testKnowledgeBaseConnectivity);
router.get("/role-capabilities", requireCapability("system:manage"), SystemModule.getRoleCapabilitiesMatrix);
// 会话管理：管理员审计全量用户 AI 会话
router.get("/ai-sessions", requireCapability("system:manage"), AiSessionsModule.listAllSessionsForAdmin);

export default router;
