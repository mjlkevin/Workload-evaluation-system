import { Router } from "express";

import * as ProjectEvaluationsModule from "../modules/project-evaluations/project-evaluations.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.get("/", requireCapability("estimates:read"), ProjectEvaluationsModule.listProjectEvaluations);
router.post("/", requireCapability("estimates:write"), ProjectEvaluationsModule.createProjectEvaluation);
router.post("/assessment-drafts/:assessmentId/confirm", requireCapability("estimates:write"), ProjectEvaluationsModule.confirmAiAssessmentDraft);
router.get("/:projectId", requireCapability("estimates:read"), ProjectEvaluationsModule.getProjectEvaluation);

export default router;
