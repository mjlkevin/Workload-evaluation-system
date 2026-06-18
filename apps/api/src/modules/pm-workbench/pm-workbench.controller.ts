import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import * as PW from "./pm-workbench.usecase";

// ------------------------------------------------------------------
// Handoff handlers
// ------------------------------------------------------------------

export async function postHandoff(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const handoff = await PW.createAssessmentHandoff({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
      fromRole: String(b.fromRole ?? "IMPL") as PW.V2Role,
      toRole: String(b.toRole ?? "PM") as PW.V2Role,
      initiatedByUserId: req.user?.id,
      fromVersionId: typeof b.fromVersionId === "string" ? b.fromVersionId : undefined,
      toVersionId: typeof b.toVersionId === "string" ? b.toVersionId : undefined,
      contextSnapshot: b.contextSnapshot && typeof b.contextSnapshot === "object" ? b.contextSnapshot as Record<string, unknown> : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    res.status(201).json({ success: true, data: handoff });
  } catch (err) { next(err); }
}

export async function listHandoffsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const toRole = req.query.toRole as string | undefined;
    const status = req.query.status as string | undefined;
    if (toRole) {
      const list = await PW.listAssessmentHandoffsByToRole(toRole as PW.V2Role, status);
      res.json({ success: true, data: list });
    } else {
      res.status(400).json({ success: false, message: "toRole 查询参数必填" });
    }
  } catch (err) { next(err); }
}

export async function getHandoffHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const handoff = await PW.findAssessmentHandoffById(req.params.id as string);
    if (!handoff) throw new ApiError(404, "接力记录不存在");
    res.json({ success: true, data: handoff });
  } catch (err) { next(err); }
}

export async function patchHandoff(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const handoff = await PW.updateAssessmentHandoff(req.params.id as string, {
      acceptedByUserId: typeof b.acceptedByUserId === "string" ? b.acceptedByUserId : req.user?.id,
      status: b.status === "pending" || b.status === "accepted" || b.status === "rejected" ? b.status : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    if (!handoff) throw new ApiError(404, "接力记录不存在");
    res.json({ success: true, data: handoff });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// Narrative handlers
// ------------------------------------------------------------------

export async function postNarrative(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const narrative = await PW.createAssessmentNarrative({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
      orgAndModules: typeof b.orgAndModules === "string" ? b.orgAndModules : undefined,
      dataGovernance: typeof b.dataGovernance === "string" ? b.dataGovernance : undefined,
      specialScenarios: typeof b.specialScenarios === "string" ? b.specialScenarios : undefined,
      acceptanceScope: typeof b.acceptanceScope === "string" ? b.acceptanceScope : undefined,
      timelineAndCost: typeof b.timelineAndCost === "string" ? b.timelineAndCost : undefined,
      generatedFrom: "manual",
      lastEditedByUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: narrative });
  } catch (err) { next(err); }
}

export async function generateNarrativeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const narrative = await PW.generateNarrativeDraft({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      packData: b.packData as any,
      estimateData: b.estimateData as any,
      generatedByUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: narrative });
  } catch (err) { next(err); }
}

export async function getNarrativeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const narrative = await PW.findAssessmentNarrativeById(req.params.id as string);
    if (!narrative) throw new ApiError(404, "叙事不存在");
    res.json({ success: true, data: narrative });
  } catch (err) { next(err); }
}

export async function getNarrativeByVersionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const narrative = await PW.findAssessmentNarrativeByVersionId(req.params.versionId as string);
    if (!narrative) throw new ApiError(404, "叙事不存在");
    res.json({ success: true, data: narrative });
  } catch (err) { next(err); }
}

export async function patchNarrative(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const narrative = await PW.updateAssessmentNarrative(req.params.id as string, {
      orgAndModules: typeof b.orgAndModules === "string" ? b.orgAndModules : undefined,
      dataGovernance: typeof b.dataGovernance === "string" ? b.dataGovernance : undefined,
      specialScenarios: typeof b.specialScenarios === "string" ? b.specialScenarios : undefined,
      acceptanceScope: typeof b.acceptanceScope === "string" ? b.acceptanceScope : undefined,
      timelineAndCost: typeof b.timelineAndCost === "string" ? b.timelineAndCost : undefined,
      status: b.status === "draft" || b.status === "confirmed" ? b.status : undefined,
      lastEditedByUserId: req.user?.id,
    });
    if (!narrative) throw new ApiError(404, "叙事不存在");
    res.json({ success: true, data: narrative });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// Deliverable handlers
// ------------------------------------------------------------------

export async function generateDeliverablesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const items = await PW.generateAllDeliverables({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      effortEstimate: Array.isArray(b.effortEstimate) ? b.effortEstimate as any : undefined,
      riskTags: Array.isArray(b.riskTags) ? b.riskTags as string[] : undefined,
      assumptions: Array.isArray(b.assumptions) ? b.assumptions as any : undefined,
      phaseProposal: Array.isArray(b.phaseProposal) ? b.phaseProposal as any : undefined,
      varianceBaseline: b.varianceBaseline as any,
    });
    res.status(201).json({ success: true, data: items });
  } catch (err) { next(err); }
}

export async function getDeliverableHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const d = await PW.findDeliverableById(req.params.id as string);
    if (!d) throw new ApiError(404, "交付物不存在");
    res.json({ success: true, data: d });
  } catch (err) { next(err); }
}

export async function listDeliverablesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const list = await PW.listDeliverablesByVersion(req.params.versionId as string);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function patchDeliverableStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const status = (req.body as Record<string, unknown>).status;
    if (status !== "draft" && status !== "confirmed") {
      throw new ApiError(400, "status 必须为 draft 或 confirmed");
    }
    const d = await PW.updateDeliverableStatus(req.params.id as string, status);
    if (!d) throw new ApiError(404, "交付物不存在");
    res.json({ success: true, data: d });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// Review handlers
// ------------------------------------------------------------------

export async function postReview(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const review = await PW.createQualityGateReview({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
      reviewerUserId: req.user?.id,
      checklist: b.checklist && typeof b.checklist === "object" ? b.checklist as any : undefined,
      verdict: b.verdict === "pass" || b.verdict === "reject" ? b.verdict : undefined,
      rejectionReasons: Array.isArray(b.rejectionReasons) ? b.rejectionReasons as any : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) { next(err); }
}

export async function autoReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const review = await PW.autoReview({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      reviewerUserId: req.user?.id,
      deliverables: Array.isArray(b.deliverables) ? b.deliverables as any : [],
      narrativeStatus: typeof b.narrativeStatus === "string" ? b.narrativeStatus : undefined,
      hasAssumptions: typeof b.hasAssumptions === "boolean" ? b.hasAssumptions : undefined,
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) { next(err); }
}

export async function getReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const review = await PW.findQualityGateReviewById(req.params.id as string);
    if (!review) throw new ApiError(404, "审核记录不存在");
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
}

export async function getReviewByVersionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const review = await PW.findQualityGateReviewByVersionId(req.params.versionId as string);
    if (!review) throw new ApiError(404, "审核记录不存在");
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
}

export async function patchReview(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const review = await PW.updateQualityGateReview(req.params.id as string, {
      checklist: b.checklist && typeof b.checklist === "object" ? b.checklist as any : undefined,
      verdict: b.verdict === "pass" || b.verdict === "reject" ? b.verdict : undefined,
      rejectionReasons: Array.isArray(b.rejectionReasons) ? b.rejectionReasons as any : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    if (!review) throw new ApiError(404, "审核记录不存在");
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// SealedBaseline handlers
// ------------------------------------------------------------------

export async function postSeal(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const sealed = await PW.seal({
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : "",
      sealedByUserId: req.user?.id,
      artifactsSnapshot: b.artifactsSnapshot && typeof b.artifactsSnapshot === "object" ? b.artifactsSnapshot as Record<string, unknown> : undefined,
      contractFlowId: typeof b.contractFlowId === "string" ? b.contractFlowId : undefined,
      sealReason: typeof b.sealReason === "string" ? b.sealReason : undefined,
    });
    res.status(201).json({ success: true, data: sealed });
  } catch (err) { next(err); }
}

export async function getSealHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const sealed = await PW.findSealedBaselineById(req.params.id as string);
    if (!sealed) throw new ApiError(404, "封版记录不存在");
    res.json({ success: true, data: sealed });
  } catch (err) { next(err); }
}

export async function getSealByVersionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const sealed = await PW.findSealedBaselineByVersionId(req.params.versionId as string);
    if (!sealed) throw new ApiError(404, "封版记录不存在");
    res.json({ success: true, data: sealed });
  } catch (err) { next(err); }
}
