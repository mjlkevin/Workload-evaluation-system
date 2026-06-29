import { RequestHandler, Router } from "express";

import * as ProjectEvaluationsModule from "../modules/project-evaluations/project-evaluations.module";
import { requireAnyCapability, requireCapability } from "../rbac/middleware";

export type ProjectEvaluationsRouterHandlers = {
  listProjectEvaluations: RequestHandler;
  createProjectEvaluation: RequestHandler;
  confirmAiAssessmentDraft: RequestHandler;
  getProjectEvaluation: RequestHandler;
};

export function createProjectEvaluationsRouter(handlers: ProjectEvaluationsRouterHandlers = ProjectEvaluationsModule) {
  const router = Router();

  router.get("/", requireCapability("estimates:read"), handlers.listProjectEvaluations);
  router.post("/", requireAnyCapability("estimates:create", "estimates:write"), handlers.createProjectEvaluation);
  router.post("/assessment-drafts/:assessmentId/confirm", requireCapability("estimates:write"), handlers.confirmAiAssessmentDraft);
  router.get("/:projectId", requireCapability("estimates:read"), handlers.getProjectEvaluation);

  return router;
}

export default createProjectEvaluationsRouter();
