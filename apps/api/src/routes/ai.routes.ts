// ============================================================
// AI 路由
// ============================================================

import { Router } from "express";
import multer from "multer";
import * as AiModule from "../modules/ai/ai.module";
import * as SystemModule from "../modules/system/system.module";
import { requireCapability } from "../rbac/middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const router = Router();

router.post("/parse-basic-info", upload.single("file"), requireCapability("extractor:trigger"), AiModule.parseBasicInfo);
router.post("/company-profile-summary", requireCapability("requirement:upload"), AiModule.companyProfileSummary);
router.post("/kimi-assessment/preview", requireCapability("assessment:create"), AiModule.kimiAssessmentPreview);
router.post("/kimi-assessment/export-markdown", requireCapability("assessment:create"), AiModule.exportKimiAssessmentMarkdown);
/** 与 `POST /api/v1/system/requirement-settings/kimi-api-key/test` 相同处理函数，便于网关只放行 `/ai/*` 的环境 */
router.post("/kimi-api-key/test", requireCapability("system:manage"), SystemModule.testRequirementKimiApiKey);
router.post("/chat", requireCapability("estimates:read"), AiModule.chat);

export default router;
