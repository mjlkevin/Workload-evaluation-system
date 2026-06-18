import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import * as SB from "./sales-briefing.usecase";

function parseBriefBody(body: unknown): {
  customerName: string;
  customerProfile?: Record<string, unknown>;
  vagueRequirements?: string;
  extractedSignals?: Array<{ signal: string; weight: number }>;
} {
  const b = body as Record<string, unknown>;
  if (typeof b.customerName !== "string" || !b.customerName.trim()) {
    throw new ApiError(400, "customerName 必填");
  }
  return {
    customerName: b.customerName.trim(),
    customerProfile: b.customerProfile && typeof b.customerProfile === "object" ? (b.customerProfile as Record<string, unknown>) : undefined,
    vagueRequirements: typeof b.vagueRequirements === "string" ? b.vagueRequirements : undefined,
    extractedSignals: Array.isArray(b.extractedSignals) ? b.extractedSignals as any : undefined,
  };
}

export async function postBrief(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseBriefBody(req.body);
    const brief = await SB.createBrief({
      ...body,
      ownerUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: brief });
  } catch (err) { next(err); }
}

export async function listBriefsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) throw new ApiError(401, "未登录");
    const status = req.query.status as string | undefined;
    const list = await SB.listBriefsByOwner(ownerUserId, status);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function getBriefHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const brief = await SB.findBriefById(id);
    if (!brief) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
}

export async function patchBrief(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const brief = await SB.updateBrief(id, {
      customerName: typeof b.customerName === "string" ? b.customerName : undefined,
      customerProfile: b.customerProfile && typeof b.customerProfile === "object" ? b.customerProfile as Record<string, unknown> : undefined,
      vagueRequirements: typeof b.vagueRequirements === "string" ? b.vagueRequirements : undefined,
      extractedSignals: Array.isArray(b.extractedSignals) ? b.extractedSignals as any : undefined,
      status: b.status === "open" || b.status === "converted" || b.status === "abandoned" ? b.status : undefined,
      linkedRequirementPackId: typeof b.linkedRequirementPackId === "string" ? b.linkedRequirementPackId : undefined,
    });
    if (!brief) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
}

export async function deleteBriefHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const ok = await SB.deleteBrief(id);
    if (!ok) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function generateQuoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const brief = await SB.generateQuote(id, {
      industry: typeof b.industry === "string" ? b.industry : undefined,
      scale: typeof b.scale === "string" ? b.scale : undefined,
      moduleCount: typeof b.moduleCount === "number" ? b.moduleCount : undefined,
      customRatio: typeof b.customRatio === "number" ? b.customRatio : undefined,
      urgency: b.urgency === "urgent" || b.urgency === "normal" ? b.urgency : undefined,
    });
    if (!brief) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
}

export async function recalculateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const brief = await SB.recalculate(id, {
      removedModules: Array.isArray(b.removedModules) ? b.removedModules as string[] : undefined,
      addedModules: Array.isArray(b.addedModules) ? b.addedModules as string[] : undefined,
      addedOrgs: typeof b.addedOrgs === "number" ? b.addedOrgs : undefined,
    });
    if (!brief) throw new ApiError(404, "商机档案不存在或尚未生成报价");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
}
