// ============================================================
// DevAssessment Routes — 开发评估 API（P2-2）
// ============================================================
// 开发顾问独立工作面；可被合并进总评估；可单签合同。
//
// 能力位映射：
//   - 创建 / 分配          → dev:assign | assessment:handoff
//   - 查看                 → dev:read | dev:write | dev:assign | assessment:handoff | deliverable:review
//   - 更新（DEV 编辑）     → dev:write | dev:assign | assessment:handoff
//   - 合并到总评估         → assessment:handoff | estimates:write

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import { ApiError } from "../utils/errors";
import { devAssessmentService } from "../services/dev-assessment";
import type { DevAssessmentItem, DevAssessmentDeployOpsItem } from "../db/schema";

const router = Router();

// ------------------------------------------------------------------
// 校验 helpers
// ------------------------------------------------------------------

function parseCreateBody(body: unknown): {
  assessmentVersionId?: string;
  contractMode?: "embedded" | "separate";
  items?: DevAssessmentItem[];
  deployOpsItems?: DevAssessmentDeployOpsItem[];
  assessedByUserId?: string;
  contextSnapshot?: Record<string, unknown>;
  notes?: string;
} {
  const b = body as Record<string, unknown>;
  return {
    assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
    contractMode: b.contractMode === "embedded" || b.contractMode === "separate" ? b.contractMode : undefined,
    items: Array.isArray(b.items) ? b.items as DevAssessmentItem[] : undefined,
    deployOpsItems: Array.isArray(b.deployOpsItems) ? b.deployOpsItems as DevAssessmentDeployOpsItem[] : undefined,
    assessedByUserId: typeof b.assessedByUserId === "string" ? b.assessedByUserId : undefined,
    contextSnapshot: b.contextSnapshot && typeof b.contextSnapshot === "object" ? b.contextSnapshot as Record<string, unknown> : undefined,
    notes: typeof b.notes === "string" ? b.notes : undefined,
  };
}

function parseUpdateBody(body: unknown): {
  contractMode?: "embedded" | "separate";
  status?: "draft" | "in_progress" | "review_pending" | "confirmed" | "merged";
  items?: DevAssessmentItem[];
  deployOpsItems?: DevAssessmentDeployOpsItem[];
  assessedByUserId?: string;
  contextSnapshot?: Record<string, unknown>;
  notes?: string;
} {
  const b = body as Record<string, unknown>;
  return {
    contractMode: b.contractMode === "embedded" || b.contractMode === "separate" ? b.contractMode : undefined,
    status: ["draft", "in_progress", "review_pending", "confirmed", "merged"].includes(b.status as string) ? (b.status as any) : undefined,
    items: Array.isArray(b.items) ? b.items as DevAssessmentItem[] : undefined,
    deployOpsItems: Array.isArray(b.deployOpsItems) ? b.deployOpsItems as DevAssessmentDeployOpsItem[] : undefined,
    assessedByUserId: typeof b.assessedByUserId === "string" ? b.assessedByUserId : undefined,
    contextSnapshot: b.contextSnapshot && typeof b.contextSnapshot === "object" ? b.contextSnapshot as Record<string, unknown> : undefined,
    notes: typeof b.notes === "string" ? b.notes : undefined,
  };
}

// ------------------------------------------------------------------
// CRUD 路由
// ------------------------------------------------------------------

router.post("/", requireAnyCapability("dev:assign", "assessment:handoff"), async (req, res, next) => {
  try {
    const body = parseCreateBody(req.body);
    const devAssessment = await devAssessmentService.create({
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
});

router.get("/", requireAnyCapability("dev:read", "dev:write", "dev:assign", "assessment:handoff", "deliverable:review"), async (req, res, next) => {
  try {
    const versionId = req.query.assessmentVersionId as string | undefined;
    const assessedBy = req.query.assessedByUserId as string | undefined;
    const assignedBy = req.query.assignedByUserId as string | undefined;
    const status = req.query.status as string | undefined;

    if (versionId) {
      const list = await devAssessmentService.listByVersionId(versionId);
      res.json({ success: true, data: list });
    } else if (assessedBy) {
      const list = await devAssessmentService.listByAssessedBy(assessedBy, status);
      res.json({ success: true, data: list });
    } else if (assignedBy) {
      const list = await devAssessmentService.listByAssignedBy(assignedBy, status);
      res.json({ success: true, data: list });
    } else {
      res.status(400).json({ success: false, message: "请提供 assessmentVersionId、assessedByUserId 或 assignedByUserId 查询参数" });
    }
  } catch (err) { next(err); }
});

router.get("/:id", requireAnyCapability("dev:read", "dev:write", "dev:assign", "assessment:handoff", "deliverable:review"), async (req, res, next) => {
  try {
    const devAssessment = await devAssessmentService.findById(req.params.id as string);
    if (!devAssessment) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: devAssessment });
  } catch (err) { next(err); }
});

router.patch("/:id", requireAnyCapability("dev:write", "dev:assign", "assessment:handoff"), async (req, res, next) => {
  try {
    const body = parseUpdateBody(req.body);
    const devAssessment = await devAssessmentService.update(req.params.id as string, body);
    if (!devAssessment) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: devAssessment });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// AI 生成评估草稿
// ------------------------------------------------------------------

router.post("/:id/generate", requireAnyCapability("dev:write", "dev:assign", "assessment:handoff"), async (req, res, next) => {
  try {
    const result = await devAssessmentService.generateDraft(req.params.id as string);
    if (!result) throw new ApiError(404, "开发评估不存在");
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// 合并到总评估
// ------------------------------------------------------------------

router.post("/:id/merge", requireAnyCapability("assessment:handoff", "estimates:write"), async (req, res, next) => {
  try {
    const result = await devAssessmentService.mergeToVersion(req.params.id as string, {
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
});

// ------------------------------------------------------------------
// 按版本查（快捷路由，与 GET /?assessmentVersionId= 等价）
// ------------------------------------------------------------------

router.get("/versions/:versionId/dev-assessment", requireAnyCapability("dev:read", "dev:write", "dev:assign", "assessment:handoff", "deliverable:review"), async (req, res, next) => {
  try {
    const list = await devAssessmentService.listByVersionId(req.params.versionId as string);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

export default router;
