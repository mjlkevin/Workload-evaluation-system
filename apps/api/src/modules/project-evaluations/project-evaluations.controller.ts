import { randomUUID } from "node:crypto";
import { Request, Response } from "express";

import { requireAuth } from "../../middleware/auth";
import { asString, fail, ok } from "../../utils";
import { confirmAiAssessmentDraftForUser, createProjectEvaluationForUser, getProjectEvaluationForUser, listProjectEvaluationsForUser } from "./project-evaluations.usecase";

export function listProjectEvaluations(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listProjectEvaluationsForUser(auth.user, req.query || {}) }, randomUUID()));
}

export function createProjectEvaluation(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ project: createProjectEvaluationForUser(auth.user, req.body || {}) }, randomUUID()));
}

export function getProjectEvaluation(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const projectId = asString(req.params.projectId);
  const project = getProjectEvaluationForUser(auth.user, projectId);
  if (!project) {
    return fail(res, 40404, "项目评估不存在", [{ field: "projectId", reason: "not_found" }]);
  }
  return res.json(ok({ project }, randomUUID()));
}

export async function confirmAiAssessmentDraft(req: Request, res: Response) {
  const auth = requireAuth(req, res);
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
}
