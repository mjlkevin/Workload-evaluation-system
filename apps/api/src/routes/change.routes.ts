// ============================================================
// Change Management Routes — 变更提报 API
// ============================================================
// P2-3 端点：ChangeSubmission 提交 / 查看 / 合并 / 驳回
//
// 能力位映射：
//   - POST   /change-submissions          → estimates:write
//   - GET    /change-submissions/:id      → estimates:read
//   - GET    /change-submissions          → estimates:read
//   - POST   /change-submissions/:id/merge → man-day:adjust
//   - POST   /change-submissions/:id/reject → man-day:adjust 或 deliverable:reject

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import { ApiError } from "../utils/errors";
import { changeSubmissionService } from "../services/change-management";

const router = Router();

// ------------------------------------------------------------------
// 销售提交变更
// ------------------------------------------------------------------

router.post("/change-submissions", requireCapability("estimates:write"), async (req, res, next) => {
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

    const submission = await changeSubmissionService.submitChange({
      parentEntityType: parentEntityType as any,
      parentEntityId,
      changeDescription: changeDescription.trim(),
      submittedByUserId: req.user?.id,
    });

    res.status(201).json({ success: true, data: submission });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 查看单条变更提报
// ------------------------------------------------------------------

router.get("/change-submissions/:id", requireAnyCapability("estimates:read", "estimates:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const submission = await changeSubmissionService.findById(id);
    if (!submission) throw new ApiError(404, "变更提报不存在");
    res.json({ success: true, data: submission });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 按父实体列表变更提报
// ------------------------------------------------------------------

router.get("/change-submissions", requireAnyCapability("estimates:read", "estimates:write"), async (req, res, next) => {
  try {
    const parentEntityId = req.query.parentEntityId as string | undefined;
    const parentEntityType = req.query.parentEntityType as string | undefined;
    const submitterId = req.query.submitterId as string | undefined;

    if (parentEntityId && parentEntityType) {
      const list = await changeSubmissionService.listByParent(parentEntityType, parentEntityId);
      res.json({ success: true, data: list });
      return;
    }

    if (submitterId) {
      const list = await changeSubmissionService.listBySubmitter(submitterId);
      res.json({ success: true, data: list });
      return;
    }

    // 无过滤条件时返回当前用户提交的
    const currentUserId = req.user?.id;
    if (!currentUserId) throw new ApiError(401, "未登录");
    const list = await changeSubmissionService.listBySubmitter(currentUserId);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// PM 合并变更到版本
// ------------------------------------------------------------------

router.post("/change-submissions/:id/merge", requireCapability("man-day:adjust"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const targetVersionId = b.targetVersionId as string;

    if (!targetVersionId || typeof targetVersionId !== "string") {
      throw new ApiError(400, "targetVersionId 必填");
    }

    const merged = await changeSubmissionService.mergeToVersion(
      id,
      targetVersionId,
      req.user?.id,
    );
    if (!merged) throw new ApiError(404, "变更提报不存在");
    res.json({ success: true, data: merged });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// PM/PMO 驳回变更
// ------------------------------------------------------------------

router.post("/change-submissions/:id/reject", requireAnyCapability("man-day:adjust", "deliverable:reject"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const rejected = await changeSubmissionService.reject(id, {
      reviewedByUserId: req.user?.id,
    });
    if (!rejected) throw new ApiError(404, "变更提报不存在");
    res.json({ success: true, data: rejected });
  } catch (err) { next(err); }
});

export default router;
