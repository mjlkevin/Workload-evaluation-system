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
import { requireAnyCapability } from "../rbac/middleware";
import * as DevAssessmentModule from "../modules/dev-assessment/dev-assessment.module";

const router = Router();

router.post("/", requireAnyCapability("dev:assign", "assessment:handoff"), DevAssessmentModule.postDevAssessment);
router.get("/", requireAnyCapability("dev:read", "dev:write", "dev:assign", "assessment:handoff", "deliverable:review"), DevAssessmentModule.listDevAssessmentsHandler);
router.get("/:id", requireAnyCapability("dev:read", "dev:write", "dev:assign", "assessment:handoff", "deliverable:review"), DevAssessmentModule.getDevAssessmentHandler);
router.patch("/:id", requireAnyCapability("dev:write", "dev:assign", "assessment:handoff"), DevAssessmentModule.patchDevAssessment);
router.post("/:id/generate", requireAnyCapability("dev:write", "dev:assign", "assessment:handoff"), DevAssessmentModule.generateDevAssessmentHandler);
router.post("/:id/merge", requireAnyCapability("assessment:handoff", "estimates:write"), DevAssessmentModule.mergeDevAssessmentHandler);
router.get("/versions/:versionId/dev-assessment", requireAnyCapability("dev:read", "dev:write", "dev:assign", "assessment:handoff", "deliverable:review"), DevAssessmentModule.getDevAssessmentByVersionHandler);

export default router;
