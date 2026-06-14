import { Router } from "express";

import * as ProjectEvaluationsModule from "../modules/project-evaluations/project-evaluations.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.get("/", requireCapability("estimates:read"), ProjectEvaluationsModule.listProjectEvaluations);
router.post("/", requireCapability("estimates:write"), ProjectEvaluationsModule.createProjectEvaluation);

export default router;
