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
import { ApiError } from "../utils/errors";
import {
  assessmentHandoffService,
  assessmentNarrativeService,
  deliverableService,
  qualityGateReviewService,
  sealedBaselineService,
} from "../services/pm-workbench";

const router = Router();

// ------------------------------------------------------------------
// 校验 helpers
// ------------------------------------------------------------------

function parseHandoffBody(body: unknown): {
  assessmentVersionId?: string;
  fromRole: string;
  toRole: string;
  fromVersionId?: string;
  toVersionId?: string;
  contextSnapshot?: Record<string, unknown>;
  notes?: string;
} {
  const b = body as Record<string, unknown>;
  return {
    assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
    fromRole: String(b.fromRole ?? "IMPL"),
    toRole: String(b.toRole ?? "PM"),
    fromVersionId: typeof b.fromVersionId === "string" ? b.fromVersionId : undefined,
    toVersionId: typeof b.toVersionId === "string" ? b.toVersionId : undefined,
    contextSnapshot: b.contextSnapshot && typeof b.contextSnapshot === "object" ? (b.contextSnapshot as Record<string, unknown>) : undefined,
    notes: typeof b.notes === "string" ? b.notes : undefined,
  };
}

function parseNarrativeBody(body: unknown): {
  assessmentVersionId?: string;
  orgAndModules?: string;
  dataGovernance?: string;
  specialScenarios?: string;
  acceptanceScope?: string;
  timelineAndCost?: string;
  status?: "draft" | "confirmed";
} {
  const b = body as Record<string, unknown>;
  return {
    assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
    orgAndModules: typeof b.orgAndModules === "string" ? b.orgAndModules : undefined,
    dataGovernance: typeof b.dataGovernance === "string" ? b.dataGovernance : undefined,
    specialScenarios: typeof b.specialScenarios === "string" ? b.specialScenarios : undefined,
    acceptanceScope: typeof b.acceptanceScope === "string" ? b.acceptanceScope : undefined,
    timelineAndCost: typeof b.timelineAndCost === "string" ? b.timelineAndCost : undefined,
    status: b.status === "draft" || b.status === "confirmed" ? b.status : undefined,
  };
}

function parseReviewBody(body: unknown): {
  checklist?: {
    deliverablesComplete?: boolean;
    methodologySevenPhases?: boolean;
    rateCardCorrect?: boolean;
    narrativeComplete?: boolean;
    assumptionsDocumented?: boolean;
  };
  verdict?: "pass" | "reject";
  rejectionReasons?: Array<{ field: string; reason: string; suggestion?: string }>;
  notes?: string;
} {
  const b = body as Record<string, unknown>;
  return {
    checklist: b.checklist && typeof b.checklist === "object" ? b.checklist as any : undefined,
    verdict: b.verdict === "pass" || b.verdict === "reject" ? b.verdict : undefined,
    rejectionReasons: Array.isArray(b.rejectionReasons) ? b.rejectionReasons as any : undefined,
    notes: typeof b.notes === "string" ? b.notes : undefined,
  };
}

// ------------------------------------------------------------------
// Assessment Handoff 路由
// ------------------------------------------------------------------

router.post("/handoffs", requireCapability("assessment:handoff"), async (req, res, next) => {
  try {
    const body = parseHandoffBody(req.body);
    const handoff = await assessmentHandoffService.create({
      assessmentVersionId: body.assessmentVersionId,
      fromRole: body.fromRole as any,
      toRole: body.toRole as any,
      initiatedByUserId: req.user?.id,
      fromVersionId: body.fromVersionId,
      toVersionId: body.toVersionId,
      contextSnapshot: body.contextSnapshot,
      notes: body.notes,
    });
    res.status(201).json({ success: true, data: handoff });
  } catch (err) { next(err); }
});

router.get("/handoffs", requireCapability("assessment:handoff"), async (req, res, next) => {
  try {
    const toRole = req.query.toRole as string | undefined;
    const status = req.query.status as string | undefined;
    if (toRole) {
      const list = await assessmentHandoffService.listByToRole(toRole as any, status);
      res.json({ success: true, data: list });
    } else {
      res.status(400).json({ success: false, message: "toRole 查询参数必填" });
    }
  } catch (err) { next(err); }
});

router.get("/handoffs/:id", requireCapability("assessment:handoff"), async (req, res, next) => {
  try {
    const handoff = await assessmentHandoffService.findById(req.params.id);
    if (!handoff) throw new ApiError(404, "接力记录不存在");
    res.json({ success: true, data: handoff });
  } catch (err) { next(err); }
});

router.patch("/handoffs/:id", requireCapability("assessment:handoff"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const handoff = await assessmentHandoffService.update(req.params.id, {
      acceptedByUserId: typeof b.acceptedByUserId === "string" ? b.acceptedByUserId : req.user?.id,
      status: b.status === "pending" || b.status === "accepted" || b.status === "rejected" ? b.status : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    if (!handoff) throw new ApiError(404, "接力记录不存在");
    res.json({ success: true, data: handoff });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Assessment Narrative 路由
// ------------------------------------------------------------------

router.post("/narratives", requireAnyCapability("assessment:create", "assessment:handoff"), async (req, res, next) => {
  try {
    const body = parseNarrativeBody(req.body);
    const narrative = await assessmentNarrativeService.create({
      assessmentVersionId: body.assessmentVersionId,
      orgAndModules: body.orgAndModules,
      dataGovernance: body.dataGovernance,
      specialScenarios: body.specialScenarios,
      acceptanceScope: body.acceptanceScope,
      timelineAndCost: body.timelineAndCost,
      generatedFrom: "manual",
      lastEditedByUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: narrative });
  } catch (err) { next(err); }
});

router.post("/narratives/generate", requireAnyCapability("assessment:create", "assessment:handoff"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const narrative = await assessmentNarrativeService.generateDraft({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      packData: b.packData as any,
      estimateData: b.estimateData as any,
      generatedByUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: narrative });
  } catch (err) { next(err); }
});

router.get("/narratives/:id", requireAnyCapability("assessment:create", "assessment:handoff", "deliverable:review"), async (req, res, next) => {
  try {
    const narrative = await assessmentNarrativeService.findById(req.params.id);
    if (!narrative) throw new ApiError(404, "叙事不存在");
    res.json({ success: true, data: narrative });
  } catch (err) { next(err); }
});

router.get("/versions/:versionId/narrative", requireAnyCapability("assessment:create", "assessment:handoff", "deliverable:review"), async (req, res, next) => {
  try {
    const narrative = await assessmentNarrativeService.findByVersionId(req.params.versionId);
    if (!narrative) throw new ApiError(404, "叙事不存在");
    res.json({ success: true, data: narrative });
  } catch (err) { next(err); }
});

router.patch("/narratives/:id", requireAnyCapability("assessment:create", "assessment:handoff"), async (req, res, next) => {
  try {
    const body = parseNarrativeBody(req.body);
    const narrative = await assessmentNarrativeService.update(req.params.id, {
      ...body,
      lastEditedByUserId: req.user?.id,
    });
    if (!narrative) throw new ApiError(404, "叙事不存在");
    res.json({ success: true, data: narrative });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Deliverable 路由
// ------------------------------------------------------------------

router.post("/deliverables/generate", requireCapability("deliverable:generate"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const items = await deliverableService.generateAll({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      effortEstimate: Array.isArray(b.effortEstimate) ? b.effortEstimate as any : undefined,
      riskTags: Array.isArray(b.riskTags) ? b.riskTags as string[] : undefined,
      assumptions: Array.isArray(b.assumptions) ? b.assumptions as any : undefined,
      phaseProposal: Array.isArray(b.phaseProposal) ? b.phaseProposal as any : undefined,
      varianceBaseline: b.varianceBaseline as any,
    });
    res.status(201).json({ success: true, data: items });
  } catch (err) { next(err); }
});

router.get("/deliverables/:id", requireAnyCapability("deliverable:generate", "deliverable:review"), async (req, res, next) => {
  try {
    const d = await deliverableService.findById(req.params.id);
    if (!d) throw new ApiError(404, "交付物不存在");
    res.json({ success: true, data: d });
  } catch (err) { next(err); }
});

router.get("/versions/:versionId/deliverables", requireAnyCapability("deliverable:generate", "deliverable:review"), async (req, res, next) => {
  try {
    const list = await deliverableService.listByVersion(req.params.versionId);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

router.patch("/deliverables/:id/status", requireAnyCapability("deliverable:generate", "deliverable:review"), async (req, res, next) => {
  try {
    const status = (req.body as Record<string, unknown>).status;
    if (status !== "draft" && status !== "confirmed") throw new ApiError(400, "status 必须为 draft 或 confirmed");
    const d = await deliverableService.updateStatus(req.params.id, status);
    if (!d) throw new ApiError(404, "交付物不存在");
    res.json({ success: true, data: d });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// PMO Quality Gate Review 路由
// ------------------------------------------------------------------

router.post("/reviews", requireCapability("deliverable:review"), async (req, res, next) => {
  try {
    const body = parseReviewBody(req.body);
    const review = await qualityGateReviewService.create({
      assessmentVersionId: typeof (req.body as Record<string, unknown>).assessmentVersionId === "string"
        ? (req.body as Record<string, unknown>).assessmentVersionId as string
        : undefined,
      reviewerUserId: req.user?.id,
      ...body,
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) { next(err); }
});

router.post("/reviews/auto", requireCapability("deliverable:review"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const review = await qualityGateReviewService.autoReview({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      reviewerUserId: req.user?.id,
      deliverables: Array.isArray(b.deliverables) ? b.deliverables as any : [],
      narrativeStatus: typeof b.narrativeStatus === "string" ? b.narrativeStatus : undefined,
      hasAssumptions: typeof b.hasAssumptions === "boolean" ? b.hasAssumptions : undefined,
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) { next(err); }
});

router.get("/reviews/:id", requireCapability("deliverable:review"), async (req, res, next) => {
  try {
    const review = await qualityGateReviewService.findById(req.params.id);
    if (!review) throw new ApiError(404, "审核记录不存在");
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

router.get("/versions/:versionId/review", requireAnyCapability("deliverable:review", "assessment:handoff"), async (req, res, next) => {
  try {
    const review = await qualityGateReviewService.findByVersionId(req.params.versionId);
    if (!review) throw new ApiError(404, "审核记录不存在");
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

router.patch("/reviews/:id", requireCapability("deliverable:review"), async (req, res, next) => {
  try {
    const body = parseReviewBody(req.body);
    const review = await qualityGateReviewService.update(req.params.id, body);
    if (!review) throw new ApiError(404, "审核记录不存在");
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Sealed Baseline 路由
// ------------------------------------------------------------------

router.post("/seal", requireCapability("deliverable:review"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const sealed = await sealedBaselineService.seal({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      sealedByUserId: req.user?.id,
      artifactsSnapshot: b.artifactsSnapshot && typeof b.artifactsSnapshot === "object" ? b.artifactsSnapshot as Record<string, unknown> : undefined,
      contractFlowId: typeof b.contractFlowId === "string" ? b.contractFlowId : undefined,
      sealReason: typeof b.sealReason === "string" ? b.sealReason : undefined,
    });
    res.status(201).json({ success: true, data: sealed });
  } catch (err) { next(err); }
});

router.get("/seal/:id", requireAnyCapability("deliverable:review", "assessment:handoff"), async (req, res, next) => {
  try {
    const sealed = await sealedBaselineService.findById(req.params.id);
    if (!sealed) throw new ApiError(404, "封版记录不存在");
    res.json({ success: true, data: sealed });
  } catch (err) { next(err); }
});

router.get("/versions/:versionId/seal", requireAnyCapability("deliverable:review", "assessment:handoff"), async (req, res, next) => {
  try {
    const sealed = await sealedBaselineService.findByVersionId(req.params.versionId);
    if (!sealed) throw new ApiError(404, "封版记录不存在");
    res.json({ success: true, data: sealed });
  } catch (err) { next(err); }
});

export default router;
