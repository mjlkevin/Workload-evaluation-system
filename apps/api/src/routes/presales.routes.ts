// ============================================================
// Pre-sales Routes — 售前审查 Agent API
// ============================================================
// P1-1 端点：原始物料 → 需求包 → DSL 审阅 → 问询 → 初估包 → SOW
//
// 能力位映射：
//   - POST   /presales/requirement-packs                      → extractor:trigger
//   - GET    /presales/requirement-packs                       → requirement:upload
//   - GET    /presales/requirement-packs/:id                   → requirement:upload
//   - PATCH  /presales/requirement-packs/:id                   → requirement:maintain
//   - DELETE /presales/requirement-packs/:id                   → requirement:maintain
//   - POST   /presales/requirement-packs/:id/review            → extractor:trigger
//   - GET    /presales/requirement-packs/:id/confidences       → requirement:upload
//   - POST   /presales/requirement-packs/:id/initial-estimate  → estimates:create
//   - GET    /presales/initial-estimates/:id                   → estimates:read OR estimates:create
//   - PATCH  /presales/initial-estimates/:id                   → estimates:write OR estimates:create
//   - POST   /presales/requirement-packs/:id/sow               → estimates:create
//   - GET    /presales/sow-documents/:id                       → estimates:read OR estimates:create
//   - PATCH  /presales/sow-documents/:id                       → estimates:write OR estimates:create
//   - GET    /presales/requirement-packs/:id/sow               → estimates:read OR estimates:create

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import * as PresalesModule from "../modules/presales/presales.module";

const router = Router();

// Requirement Pack routes
router.post("/requirement-packs", requireCapability("extractor:trigger"), PresalesModule.postRequirementPack);
router.get("/requirement-packs", requireCapability("requirement:upload"), PresalesModule.listRequirementPacksHandler);
router.get("/requirement-packs/:id", requireCapability("requirement:upload"), PresalesModule.getRequirementPackHandler);
router.patch("/requirement-packs/:id", requireCapability("requirement:maintain"), PresalesModule.patchRequirementPack);
router.delete("/requirement-packs/:id", requireCapability("requirement:maintain"), PresalesModule.deleteRequirementPackHandler);
router.post("/requirement-packs/:id/review", requireCapability("extractor:trigger"), PresalesModule.reviewRequirementPackHandler);
router.get("/requirement-packs/:id/confidences", requireCapability("requirement:upload"), PresalesModule.getFieldConfidencesHandler);

// Initial Estimate routes
router.post("/requirement-packs/:id/initial-estimate", requireCapability("estimates:create"), PresalesModule.generateInitialEstimateHandler);
router.get("/initial-estimates/:id", requireAnyCapability("estimates:read", "estimates:create"), PresalesModule.getInitialEstimateHandler);
router.patch("/initial-estimates/:id", requireAnyCapability("estimates:write", "estimates:create"), PresalesModule.patchInitialEstimate);

// SOW routes
router.post("/requirement-packs/:id/sow", requireCapability("estimates:create"), PresalesModule.generateSowHandler);
router.get("/sow-documents/:id", requireAnyCapability("estimates:read", "estimates:create"), PresalesModule.getSowHandler);
router.patch("/sow-documents/:id", requireAnyCapability("estimates:write", "estimates:create"), PresalesModule.patchSowHandler);
router.get("/requirement-packs/:id/sow", requireAnyCapability("estimates:read", "estimates:create"), PresalesModule.listSowByPackHandler);

export default router;
