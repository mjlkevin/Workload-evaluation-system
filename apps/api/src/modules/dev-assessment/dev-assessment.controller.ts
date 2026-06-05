import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import type { DevAssessmentItem, DevAssessmentDeployOpsItem } from "../../db/schema";
import type { CreateDevAssessmentInput, UpdateDevAssessmentInput } from "./dev-assessment.usecase";
import * as DA from "./dev-assessment.usecase";

function parseCreateBody(body: unknown): Partial<CreateDevAssessmentInput> & { assessmentVersionId?: string } {
  const b = body as Record<string, unknown>;
  return {
    assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
    contractMode: (b.contractMode === "embedded" || b.contractMode === "separate") ? (b.contractMode as "embedded" | "separate") : undefined,
    items: Array.isArray(b.items) ? b.items as DevAssessmentItem[] : undefined,
    deployOpsItems: Array.isArray(b.deployOpsItems) ? b.deployOpsItems as DevAssessmentDeployOpsItem[] : undefined,
    assessedByUserId: typeof b.assessedByUserId === "string" ? b.assessedByUserId : undefined,
    contextSnapshot: b.contextSnapshot && typeof b.contextSnapshot === "object" ? b.contextSnapshot as Record<string, unknown> : undefined,
    notes: typeof b.notes === "string" ? b.notes : undefined,
  };
}

function parseUpdateBody(body: unknown): Partial<UpdateDevAssessmentInput> {
  const b = body as Record<string, unknown>;
  return {
    contractMode: (b.contractMode === "embedded" || b.contractMode === "separate") ? (b.contractMode as "embedded" | "separate") : undefined,
    status: ["draft", "in_progress", "review_pending", "confirmed", "merged"].includes(b.status as string) ? (b.status as any) : undefined,
    items: Array.isArray(b.items) ? b.items as DevAssessmentItem[] : undefined,
    deployOpsItems: Array.isArray(b.deployOpsItems) ? b.deployOpsItems as DevAssessmentDeployOpsItem[] : undefined,
    assessedByUserId: typeof b.assessedByUserId === "string" ? b.assessedByUserId : undefined,
    contextSnapshot: b.contextSnapshot && typeof b.contextSnapshot === "object" ? b.contextSnapshot as Record<string, unknown> : undefined,
    notes: typeof b.notes === "string" ? b.notes : undefined,
  };
}

export async function postDevAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseCreateBody(req.body);
    const devAssessment = await DA.createDevAssessment({
      assessmentVersionId: body.assessmentVersionId,
      contractMode: body.contractMode,
      items: body.items,
      deployOpsItems: body.deployOpsItems,
      assignedByUserId: req.user?.id,
      assessedByUserId: body.assessedByUserId,
      contextSnapshot: body.contextSnapshot,
      notes: body.notes,
    });
    res.status(201).json({ success: true, data: devAssessment });
  } catch (err) { next(err); }
}

export async function listDevAssessmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const versionId = req.query.assessmentVersionId as string | undefined;
    const assessedBy = req.query.assessedByUserId as string | undefined;
    const assignedBy = req.query.assignedByUserId as string | undefined;
    const status = req.query.status as string | undefined;

    if (versionId) {
      const list = await DA.listDevAssessmentsByVersionId(versionId);
      res.json({ success: true, data: list });
    } else if (assessedBy) {
      const list = await DA.listByAssessedBy(assessedBy, status);
      res.json({ success: true, data: list });
    } else if (assignedBy) {
      const list = await DA.listByAssignedBy(assignedBy, status);
      res.json({ success: true, data: list });
    } else {
      res.status(400).json({ success: false, message: "请提供 assessmentVersionId、assessedByUserId 或 assignedByUserId 查询参数" });
    }
  } catch (err) { next(err); }
}

export async function getDevAssessmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const devAssessment = await DA.findDevAssessmentById(req.params.id as string);
    if (!devAssessment) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: devAssessment });
  } catch (err) { next(err); }
}

export async function patchDevAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseUpdateBody(req.body);
    const devAssessment = await DA.updateDevAssessment(req.params.id as string, body);
    if (!devAssessment) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: devAssessment });
  } catch (err) { next(err); }
}

export async function generateDevAssessmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await DA.generateDraft(req.params.id as string);
    if (!result) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function mergeDevAssessmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await DA.mergeToVersion(req.params.id as string, {
      mergedByUserId: req.user?.id,
    });
    if (!result) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof Error && err.message === "dev_assessment_not_linked_to_version") {
      next(new ApiError(400, "该开发评估未关联评估版本，无法合并"));
      return;
    }
    next(err);
  }
}

export async function getDevAssessmentByVersionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const list = await DA.listDevAssessmentsByVersionId(req.params.versionId as string);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}
