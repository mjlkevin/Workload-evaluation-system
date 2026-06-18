// ============================================================
// PM / PMO Routes — 工作台与审核台 API
// ============================================================
// P1-3 端点：接力视图 / Narrative / 4大交付物 / PMO审核 / 封版
//
// 能力位映射：
//   - handoffs         → assessment:handoff
//   - narratives       → assessment:create / assessment:handoff
//   - deliverables     → deliverable:generate / deliverable:review
//   - reviews (PMO)    → deliverable:review / deliverable:reject
//   - seal (PMO)       → deliverable:review

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import * as PMModule from "../modules/pm-workbench/pm-workbench.module";

const router = Router();

// Handoffs
router.post("/handoffs", requireCapability("assessment:handoff"), PMModule.postHandoff);
router.get("/handoffs", requireCapability("assessment:handoff"), PMModule.listHandoffsHandler);
router.get("/handoffs/:id", requireCapability("assessment:handoff"), PMModule.getHandoffHandler);
router.patch("/handoffs/:id", requireCapability("assessment:handoff"), PMModule.patchHandoff);

// Narratives
router.post("/narratives", requireAnyCapability("assessment:create", "assessment:handoff"), PMModule.postNarrative);
router.post("/narratives/generate", requireAnyCapability("assessment:create", "assessment:handoff"), PMModule.generateNarrativeHandler);
router.get("/narratives/:id", requireAnyCapability("assessment:create", "assessment:handoff", "deliverable:review"), PMModule.getNarrativeHandler);
router.get("/versions/:versionId/narrative", requireAnyCapability("assessment:create", "assessment:handoff", "deliverable:review"), PMModule.getNarrativeByVersionHandler);
router.patch("/narratives/:id", requireAnyCapability("assessment:create", "assessment:handoff"), PMModule.patchNarrative);

// Deliverables
router.post("/deliverables/generate", requireCapability("deliverable:generate"), PMModule.generateDeliverablesHandler);
router.get("/deliverables/:id", requireAnyCapability("deliverable:generate", "deliverable:review"), PMModule.getDeliverableHandler);
router.get("/versions/:versionId/deliverables", requireAnyCapability("deliverable:generate", "deliverable:review"), PMModule.listDeliverablesHandler);
router.patch("/deliverables/:id/status", requireAnyCapability("deliverable:generate", "deliverable:review"), PMModule.patchDeliverableStatus);

// Reviews
router.post("/reviews", requireCapability("deliverable:review"), PMModule.postReview);
router.post("/reviews/auto", requireCapability("deliverable:review"), PMModule.autoReviewHandler);
router.get("/reviews/:id", requireCapability("deliverable:review"), PMModule.getReviewHandler);
router.get("/versions/:versionId/review", requireAnyCapability("deliverable:review", "assessment:handoff"), PMModule.getReviewByVersionHandler);
router.patch("/reviews/:id", requireCapability("deliverable:review"), PMModule.patchReview);

// Seal
router.post("/seal", requireCapability("deliverable:review"), PMModule.postSeal);
router.get("/seal/:id", requireAnyCapability("deliverable:review", "assessment:handoff"), PMModule.getSealHandler);
router.get("/versions/:versionId/seal", requireAnyCapability("deliverable:review", "assessment:handoff"), PMModule.getSealByVersionHandler);

export default router;
