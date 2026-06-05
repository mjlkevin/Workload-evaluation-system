import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import {
  closeProject,
  getProject,
  updateProject,
  removeProject,
  listProjects,
  findSimilarProjects,
} from "./history.usecase";

export async function postProject(req: Request, res: Response, next: NextFunction) {
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

    const project = await closeProject({
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
}

export async function listProjectsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const industry = req.query.industry as string | undefined;
    const scale = req.query.scale as string | undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : undefined;

    const list = await listProjects({ industry, scale, limit, offset });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function getProjectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const project = await getProject(id);
    if (!project) throw new ApiError(404, "历史项目不存在");
    res.json({ success: true, data: project });
  } catch (err) { next(err); }
}

export async function patchProject(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const project = await updateProject(id, {
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
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const ok = await removeProject(id);
    if (!ok) throw new ApiError(404, "历史项目不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function closeFromBaseline(req: Request, res: Response, next: NextFunction) {
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

    const project = await closeProject({
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
}

export async function findSimilarHandler(req: Request, res: Response, next: NextFunction) {
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

    const results = await findSimilarProjects(industry, scale, modules);
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
}
