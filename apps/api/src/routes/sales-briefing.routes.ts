// ============================================================
// Sales Briefing Routes — 销售快报 Skill API
// ============================================================
// P1-2 端点：商机档案 CRUD + 区间报价生成 + 分期方案 + 变更重算
//
// 能力位映射：
//   - POST/GET/PATCH/DELETE /sales/briefs  → estimates:create / estimates:read
//   - POST /sales/briefs/:id/quote         → estimates:create
//   - POST /sales/briefs/:id/recalculate   → estimates:create

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import { ApiError } from "../utils/errors";
import { opportunityBriefService } from "../services/sales-briefing";

const router = Router();

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

// ------------------------------------------------------------------
// 商机档案 CRUD
// ------------------------------------------------------------------

router.post("/briefs", requireCapability("estimates:create"), async (req, res, next) => {
  try {
    const body = parseBriefBody(req.body);
    const brief = await opportunityBriefService.create({
      ...body,
      ownerUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: brief });
  } catch (err) { next(err); }
});

router.get("/briefs", requireAnyCapability("estimates:read", "estimates:create"), async (req, res, next) => {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) throw new ApiError(401, "未登录");
    const status = req.query.status as string | undefined;
    const list = await opportunityBriefService.listByOwner(ownerUserId, status);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

router.get("/briefs/:id", requireAnyCapability("estimates:read", "estimates:create"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const brief = await opportunityBriefService.findById(id);
    if (!brief) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
});

router.patch("/briefs/:id", requireCapability("estimates:create"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const brief = await opportunityBriefService.update(id, {
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
});

router.delete("/briefs/:id", requireCapability("estimates:create"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const ok = await opportunityBriefService.delete(id);
    if (!ok) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 报价生成（US-1: 30秒区间报价）
// ------------------------------------------------------------------

router.post("/briefs/:id/quote", requireCapability("estimates:create"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const brief = await opportunityBriefService.generateQuote(id, {
      industry: typeof b.industry === "string" ? b.industry : undefined,
      scale: typeof b.scale === "string" ? b.scale : undefined,
      moduleCount: typeof b.moduleCount === "number" ? b.moduleCount : undefined,
      customRatio: typeof b.customRatio === "number" ? b.customRatio : undefined,
      urgency: b.urgency === "urgent" || b.urgency === "normal" ? b.urgency : undefined,
    });
    if (!brief) throw new ApiError(404, "商机档案不存在");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 变更重算（US-3: 口述变更重算）
// ------------------------------------------------------------------

router.post("/briefs/:id/recalculate", requireCapability("estimates:create"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const brief = await opportunityBriefService.recalculate(id, {
      removedModules: Array.isArray(b.removedModules) ? b.removedModules as string[] : undefined,
      addedModules: Array.isArray(b.addedModules) ? b.addedModules as string[] : undefined,
      addedOrgs: typeof b.addedOrgs === "number" ? b.addedOrgs : undefined,
    });
    if (!brief) throw new ApiError(404, "商机档案不存在或尚未生成报价");
    res.json({ success: true, data: brief });
  } catch (err) { next(err); }
});

export default router;
