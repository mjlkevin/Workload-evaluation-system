import { randomUUID } from "node:crypto";
import { Request, Response } from "express";

import { requireAuth } from "../../middleware/auth";
import { ok } from "../../utils";
import { createProjectEvaluationForUser, listProjectEvaluationsForUser } from "./project-evaluations.usecase";

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
