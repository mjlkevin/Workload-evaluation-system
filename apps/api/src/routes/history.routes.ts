// ============================================================
// History Project Routes — 历史项目库 API（P2-4）
// ============================================================
// 覆盖 US-19：老客户二期继承一期起点，只问增量部分。
//
// 能力位映射：
//   - POST   /history/projects                    → assessment:create
//   - GET    /history/projects                    → estimates:read
//   - GET    /history/projects/:id                → estimates:read
//   - PATCH  /history/projects/:id                → estimates:write
//   - DELETE /history/projects/:id                → assessment:create
//   - POST   /history/projects/:id/close-from-baseline → assessment:create
//   - GET    /history/similar                     → estimates:read

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import { ApiError } from "../utils/errors";
import { historyProjectService } from "../services/history";

const router = Router();

// ------------------------------------------------------------------
// 创建历史项目记录
// ------------------------------------------------------------------

router.post("/projects", requireCapability("assessment:create"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.industry || typeof b.industry !== "string" || !b.industry.trim()) {
      throw new ApiError(400, "industry 必填");
    }
    if (!b.scale || typeof b.scale !== "string" || !b.scale.trim()) {
      throw new ApiError(400, "scale 必填");
    }
    if (typeof b.estimatedDays !== "number" || b.estimatedDays < 0) {
      throw new ApiError(400, "estimatedDays 必填且为非负数");
    }

    const project = await historyProjectService.closeProject({
      industry: b.industry.trim(),
      scale: b.scale.trim(),
      modules: Array.isArray(b.modules) ? (b.modules as string[]) : undefined,
      estimatedDays: b.estimatedDays,
      actualDays: typeof b.actualDays === "number" ? b.actualDays : undefined,
      estimatedCost: typeof b.estimatedCost === "number" ? b.estimatedCost : undefined,
      actualCost: typeof b.actualCost === "number" ? b.actualCost : undefined,
      delayReason: typeof b.delayReason === "string" ? b.delayReason : undefined,
      riskTags: Array.isArray(b.riskTags) ? (b.riskTags as string[]) : undefined,
      sourceAssessmentVersionId: typeof b.sourceAssessmentVersionId === "string" ? b.sourceAssessmentVersionId : undefined,
      sourceSealedBaselineId: typeof b.sourceSealedBaselineId === "string" ? b.sourceSealedBaselineId : undefined,
      closedAt: b.closedAt ? new Date(b.closedAt as string) : undefined,
    });

    res.status(201).json({ success: true, data: project });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 列表 + 过滤
// ------------------------------------------------------------------

router.get("/projects", requireAnyCapability("estimates:read", "estimates:write"), async (req, res, next) => {
  try {
    const industry = req.query.industry as string | undefined;
    const scale = req.query.scale as string | undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : undefined;

    const list = await historyProjectService.listAll({
      industry,
      scale,
      limit,
      offset,
    });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 单条详情
// ------------------------------------------------------------------

router.get("/projects/:id", requireAnyCapability("estimates:read", "estimates:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const project = await historyProjectService.findById(id);
    if (!project) throw new ApiError(404, "历史项目不存在");
    res.json({ success: true, data: project });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 更新
// ------------------------------------------------------------------

router.patch("/projects/:id", requireCapability("estimates:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const project = await historyProjectService.update(id, {
      industry: typeof b.industry === "string" ? b.industry : undefined,
      scale: typeof b.scale === "string" ? b.scale : undefined,
      modules: Array.isArray(b.modules) ? (b.modules as string[]) : undefined,
      estimatedDays: typeof b.estimatedDays === "number" ? b.estimatedDays : undefined,
      actualDays: typeof b.actualDays === "number" ? b.actualDays : undefined,
      estimatedCost: typeof b.estimatedCost === "number" ? b.estimatedCost : undefined,
      actualCost: typeof b.actualCost === "number" ? b.actualCost : undefined,
      delayReason: typeof b.delayReason === "string" ? b.delayReason : undefined,
      riskTags: Array.isArray(b.riskTags) ? (b.riskTags as string[]) : undefined,
      closedAt: b.closedAt ? new Date(b.closedAt as string) : undefined,
    });
    if (!project) throw new ApiError(404, "历史项目不存在");
    res.json({ success: true, data: project });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 删除
// ------------------------------------------------------------------

router.delete("/projects/:id", requireCapability("assessment:create"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const ok = await historyProjectService.delete(id);
    if (!ok) throw new ApiError(404, "历史项目不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 从封版基线回流（快捷端点）
// ------------------------------------------------------------------

router.post("/projects/:id/close-from-baseline", requireCapability("assessment:create"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.industry || typeof b.industry !== "string" || !b.industry.trim()) {
      throw new ApiError(400, "industry 必填");
    }
    if (!b.scale || typeof b.scale !== "string" || !b.scale.trim()) {
      throw new ApiError(400, "scale 必填");
    }
    if (typeof b.estimatedDays !== "number" || b.estimatedDays < 0) {
      throw new ApiError(400, "estimatedDays 必填且为非负数");
    }

    const project = await historyProjectService.closeProject({
      industry: b.industry.trim(),
      scale: b.scale.trim(),
      modules: Array.isArray(b.modules) ? (b.modules as string[]) : undefined,
      estimatedDays: b.estimatedDays,
      actualDays: typeof b.actualDays === "number" ? b.actualDays : undefined,
      estimatedCost: typeof b.estimatedCost === "number" ? b.estimatedCost : undefined,
      actualCost: typeof b.actualCost === "number" ? b.actualCost : undefined,
      delayReason: typeof b.delayReason === "string" ? b.delayReason : undefined,
      riskTags: Array.isArray(b.riskTags) ? (b.riskTags as string[]) : undefined,
      sourceAssessmentVersionId: typeof b.sourceAssessmentVersionId === "string" ? b.sourceAssessmentVersionId : undefined,
      sourceSealedBaselineId: req.params.id as string,
      closedAt: b.closedAt ? new Date(b.closedAt as string) : undefined,
    });

    res.status(201).json({ success: true, data: project });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 相似度检索
// ------------------------------------------------------------------

router.get("/similar", requireAnyCapability("estimates:read", "estimates:write"), async (req, res, next) => {
  try {
    const industry = req.query.industry as string;
    const scale = req.query.scale as string;
    const modulesParam = req.query.modules as string | undefined;
    const modules = modulesParam ? modulesParam.split(",").map((m) => m.trim()).filter(Boolean) : [];

    if (!industry || typeof industry !== "string") {
      throw new ApiError(400, "industry 必填");
    }
    if (!scale || typeof scale !== "string") {
      throw new ApiError(400, "scale 必填");
    }

    const results = await historyProjectService.findSimilar(industry, scale, modules);
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

export default router;
