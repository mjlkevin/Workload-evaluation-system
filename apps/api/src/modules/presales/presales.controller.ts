import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import * as PS from "./presales.usecase";

// ------------------------------------------------------------------
// Auth helpers
// ------------------------------------------------------------------

function isValidUUID(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function canAccessOwnedResource(
  user: { id?: string; role?: string } | undefined,
  resource: { ownerUserId?: string | null } | null | undefined,
): boolean {
  if (!user || !resource) return false;
  if (user.role === "admin") return true;
  return Boolean(resource.ownerUserId && resource.ownerUserId === user.id);
}

function assertCanAccessOwnedResource(
  user: { id?: string; role?: string } | undefined,
  resource: { ownerUserId?: string | null } | null | undefined,
): void {
  if (!canAccessOwnedResource(user, resource)) {
    throw new ApiError(404, "资源不存在");
  }
}

// ------------------------------------------------------------------
// Requirement Pack handlers
// ------------------------------------------------------------------

export async function postRequirementPack(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const input: { sourceExtractionId?: string; extractionId?: string } = {};
    if (b.sourceExtractionId && isValidUUID(b.sourceExtractionId)) input.sourceExtractionId = b.sourceExtractionId as string;
    if (b.extractionId && isValidUUID(b.extractionId)) input.extractionId = b.extractionId as string;
    const pack = await PS.createFromExtraction({
      ...input,
      ownerUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: pack });
  } catch (err) { next(err); }
}

export async function listRequirementPacksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) throw new ApiError(401, "未登录");
    const status = req.query.status as string | undefined;
    const packs = await PS.listRequirementPacksByOwner(ownerUserId, status);
    res.json({ success: true, data: packs });
  } catch (err) { next(err); }
}

export async function getRequirementPackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pack = await PS.findRequirementPackById(req.params.id as string);
    if (!pack) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, pack);
    res.json({ success: true, data: pack });
  } catch (err) { next(err); }
}

export async function patchRequirementPack(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await PS.findRequirementPackById(id);
    if (!existing) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, existing);

    const b = req.body as Record<string, unknown>;
    const input: Record<string, unknown> = {};
    if (Array.isArray(b.structuredRequirements)) input.structuredRequirements = b.structuredRequirements;
    if (typeof b.industry === "string") input.industry = b.industry;
    if (typeof b.scale === "string") input.scale = b.scale;
    if (Array.isArray(b.modules)) input.modules = b.modules;
    if (Array.isArray(b.constraints)) input.constraints = b.constraints;
    if (b.status === "draft" || b.status === "confirmed" || b.status === "deprecated") input.status = b.status;

    const pack = await PS.updateRequirementPack(id, input as any);
    if (!pack) throw new ApiError(404, "需求包不存在");
    res.json({ success: true, data: pack });
  } catch (err) { next(err); }
}

export async function deleteRequirementPackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await PS.findRequirementPackById(id);
    if (!existing) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, existing);
    const ok = await PS.deleteRequirementPack(id);
    if (!ok) throw new ApiError(404, "需求包不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function reviewRequirementPackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const pack = await PS.findRequirementPackById(id);
    if (!pack) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, pack);
    const result = await PS.reviewPack(id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getFieldConfidencesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const pack = await PS.findRequirementPackById(id);
    if (!pack) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, pack);
    const confidences = await PS.getFieldConfidences(id);
    res.json({ success: true, data: confidences });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// Initial Estimate handlers
// ------------------------------------------------------------------

export async function generateInitialEstimateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const pack = await PS.findRequirementPackById(id);
    if (!pack) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, pack);

    const existing = await PS.findInitialEstimateByPackId(pack.requirementPackId);
    if (existing) {
      await PS.deleteInitialEstimate(existing.initialEstimateId);
    }

    const estimate = await PS.generateFromPack({
      requirementPack: pack,
      ownerUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: estimate });
  } catch (err) { next(err); }
}

export async function getInitialEstimateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const estimate = await PS.findInitialEstimateById(req.params.id as string);
    if (!estimate) throw new ApiError(404, "初估包不存在");
    assertCanAccessOwnedResource(req.user, estimate);
    res.json({ success: true, data: estimate });
  } catch (err) { next(err); }
}

export async function patchInitialEstimate(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await PS.findInitialEstimateById(id);
    if (!existing) throw new ApiError(404, "初估包不存在");
    assertCanAccessOwnedResource(req.user, existing);

    const b = req.body as Record<string, unknown>;
    const input: Record<string, unknown> = {};
    if (Array.isArray(b.effortEstimate)) input.effortEstimate = b.effortEstimate;
    if (Array.isArray(b.riskTags)) input.riskTags = b.riskTags;
    if (Array.isArray(b.assumptions)) input.assumptions = b.assumptions;
    if (b.confidenceScores && typeof b.confidenceScores === "object") input.confidenceScores = b.confidenceScores;
    if (Array.isArray(b.phaseProposal)) input.phaseProposal = b.phaseProposal;
    if (b.status === "draft" || b.status === "reviewed" || b.status === "handed_off" || b.status === "deprecated") input.status = b.status;

    const estimate = await PS.updateInitialEstimate(id, input as any);
    if (!estimate) throw new ApiError(404, "初估包不存在");
    res.json({ success: true, data: estimate });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// SOW handlers
// ------------------------------------------------------------------

export async function generateSowHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const pack = await PS.findRequirementPackById(id);
    if (!pack) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, pack);

    const cloudProduct = (req.body as Record<string, unknown>).cloudProduct as string || "金蝶AI星空";
    const sowItems = await PS.generateSowFromPack({
      requirementPack: pack,
      cloudProduct,
      ownerUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: sowItems });
  } catch (err) { next(err); }
}

export async function getSowHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const sow = await PS.findSowDocumentById(req.params.id as string);
    if (!sow) throw new ApiError(404, "SOW 条目不存在");
    assertCanAccessOwnedResource(req.user, sow);
    res.json({ success: true, data: sow });
  } catch (err) { next(err); }
}

export async function patchSowHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await PS.findSowDocumentById(id);
    if (!existing) throw new ApiError(404, "SOW 条目不存在");
    assertCanAccessOwnedResource(req.user, existing);

    const b = req.body as Record<string, unknown>;
    const input: Record<string, unknown> = {};
    if (typeof b.cloudProduct === "string") input.cloudProduct = b.cloudProduct;
    if (typeof b.module === "string") input.module = b.module;
    if (typeof b.category === "string") input.category = b.category;
    if (typeof b.description === "string") input.description = b.description;
    if (typeof b.customizationScope === "string") input.customizationScope = b.customizationScope;
    if (b.status === "draft" || b.status === "confirmed" || b.status === "changed") input.status = b.status;

    const sow = await PS.updateSowDocument(id, input as any);
    if (!sow) throw new ApiError(404, "SOW 条目不存在");
    res.json({ success: true, data: sow });
  } catch (err) { next(err); }
}

export async function listSowByPackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const pack = await PS.findRequirementPackById(id);
    if (!pack) throw new ApiError(404, "需求包不存在");
    assertCanAccessOwnedResource(req.user, pack);
    const sowItems = await PS.findSowDocumentsByPackId(id);
    res.json({ success: true, data: sowItems });
  } catch (err) { next(err); }
}
