import { randomUUID } from "node:crypto";
import { Request, RequestHandler, Response } from "express";

import { requireAuth } from "../../middleware/auth";
import { asString, fail, ok } from "../../utils";
import { confirmAiAssessmentDraftForUser as confirmAiAssessmentDraftForUserImpl, createProjectEvaluationForUser, getProjectEvaluationForUser, listProjectEvaluationsForUser } from "./project-evaluations.usecase";

type ConfirmAiAssessmentDraftForUser = typeof confirmAiAssessmentDraftForUserImpl;

export type ProjectEvaluationsControllerDeps = {
  confirmAiAssessmentDraftForUser?: ConfirmAiAssessmentDraftForUser;
};

export async function listProjectEvaluations(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listProjectEvaluationsForUser(auth.user, req.query || {}) }, randomUUID()));
}

export async function createProjectEvaluation(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ project: createProjectEvaluationForUser(auth.user, req.body || {}) }, randomUUID()));
}

export async function getProjectEvaluation(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const projectId = asString(req.params.projectId);
  const project = getProjectEvaluationForUser(auth.user, projectId);
  if (!project) {
    return fail(res, 40404, "项目评估不存在", [{ field: "projectId", reason: "not_found" }]);
  }
  return res.json(ok({ project }, randomUUID()));
}

export function createConfirmAiAssessmentDraftHandler(deps: ProjectEvaluationsControllerDeps = {}): RequestHandler {
  const confirmAiAssessmentDraftForUser = deps.confirmAiAssessmentDraftForUser ?? confirmAiAssessmentDraftForUserImpl;
  return async function confirmAiAssessmentDraftHandler(req: Request, res: Response) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const assessmentId = asString(req.params.assessmentId);
    try {
      const result = await confirmAiAssessmentDraftForUser(auth.user, assessmentId, req.body || {});
      if (!result) {
        return fail(res, 40404, "AI 评估草稿不存在", [{ field: "assessmentId", reason: "not_found" }]);
      }
      return res.json(ok(result, randomUUID()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "confirm_ai_draft_failed";
      if (message === "not_ai_harness_draft") {
        return fail(res, 40902, "当前评估不是 Harness AI 草稿", [{ field: "assessmentId", reason: message }]);
      }
      if (message === "harness_run_not_found") {
        return fail(res, 40404, "Harness Run 不存在或无权访问", [{ field: "assessmentId", reason: message }]);
      }
      throw error;
    }
  };
}

export const confirmAiAssessmentDraft = createConfirmAiAssessmentDraftHandler();
