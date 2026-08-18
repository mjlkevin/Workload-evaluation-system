import { Request, Response } from "express";

import { requireRoleWithAuth } from "../../middleware/auth";
import { CalculateRequest } from "../../types";
import { fail, ok } from "../../utils/response";
import { calculateBySession, startEstimateSession } from "./sessions.usecase";

export async function startSession(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const result = await startEstimateSession(auth.user.id, (req.body || {}) as { templateId?: string; ruleSetId?: string });
  if (!result.ok) {
    return fail(res, result.code, result.message, result.details);
  }
  return res.json(ok(result.data));
}

export async function calculateInSession(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const sessionId = String(req.params.sessionId || "");
  const body = req.body as Omit<CalculateRequest, "templateId" | "ruleSetId">;
  const result = await calculateBySession(auth.user.id, sessionId, body);
  if (!result.ok) {
    return fail(res, result.code, result.message, result.details);
  }
  return res.json(ok(result.data, result.requestId));
}
