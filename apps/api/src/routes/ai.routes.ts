// ============================================================
// AI 路由
// ============================================================

import { Router } from "express";
import multer from "multer";
import * as AiModule from "../modules/ai/ai.module";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const router = Router();

router.post("/parse-basic-info", upload.single("file"), AiModule.parseBasicInfo);
router.post("/company-profile-summary", AiModule.companyProfileSummary);
router.post("/kimi-assessment/preview", AiModule.kimiAssessmentPreview);
router.post("/kimi-assessment/export-markdown", AiModule.exportKimiAssessmentMarkdown);
router.post("/chat", AiModule.chat);

export default router;
