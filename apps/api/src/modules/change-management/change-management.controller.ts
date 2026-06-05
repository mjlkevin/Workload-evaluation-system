import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import * as CM from "./change-management.usecase";

export async function postChangeSubmission(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const parentEntityType = b.parentEntityType as string;
    const parentEntityId = b.parentEntityId as string;
    const changeDescription = b.changeDescription as string;

    if (!parentEntityType || !["opportunity_brief", "requirement_pack", "assessment_version"].includes(parentEntityType)) {
      throw new ApiError(400, "parentEntityType 必须为 opportunity_brief | requirement_pack | assessment_version");
    }
    if (!parentEntityId || typeof parentEntityId !== "string") {
      throw new ApiError(400, "parentEntityId 必填");
    }
    if (!changeDescription || typeof changeDescription !== "string" || !changeDescription.trim()) {
      throw new ApiError(400, "changeDescription 必填");
    }

    const submission = await CM.submitChange({
      parentEntityType: parentEntityType as any,
      parentEntityId,
      changeDescription: changeDescription.trim(),
      submittedByUserId: req.user?.id,
    });

    res.status(201).json({ success: true, data: submission });
  } catch (err) { next(err); }
}

export async function getChangeSubmissionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const submission = await CM.findChangeSubmissionById(id);
    if (!submission) throw new ApiError(404, "变更提报不存在");
    res.json({ success: true, data: submission });
  } catch (err) { next(err); }
}

export async function listChangeSubmissionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parentEntityId = req.query.parentEntityId as string | undefined;
    const parentEntityType = req.query.parentEntityType as string | undefined;
    const submitterId = req.query.submitterId as string | undefined;

    if (parentEntityId && parentEntityType) {
      const list = await CM.listChangeSubmissionsByParent(parentEntityType, parentEntityId);
      res.json({ success: true, data: list });
      return;
    }

    if (submitterId) {
      const list = await CM.listChangeSubmissionsBySubmitter(submitterId);
      res.json({ success: true, data: list });
      return;
    }

    const currentUserId = req.user?.id;
    if (!currentUserId) throw new ApiError(401, "未登录");
    const list = await CM.listChangeSubmissionsBySubmitter(currentUserId);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function mergeChangeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const targetVersionId = b.targetVersionId as string;

    if (!targetVersionId || typeof targetVersionId !== "string") {
      throw new ApiError(400, "targetVersionId 必填");
    }

    const merged = await CM.mergeToVersion(id, targetVersionId, req.user?.id);
    if (!merged) throw new ApiError(404, "变更提报不存在");
    res.json({ success: true, data: merged });
  } catch (err) { next(err); }
}

export async function rejectChangeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const rejected = await CM.reject(id, {
      reviewedByUserId: req.user?.id,
    });
    if (!rejected) throw new ApiError(404, "变更提报不存在");
    res.json({ success: true, data: rejected });
  } catch (err) { next(err); }
}
