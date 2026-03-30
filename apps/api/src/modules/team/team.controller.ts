import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { requireRoleWithAuth } from "../../middleware/auth";
import { ok } from "../../utils/response";
import {
  addTeamMember,
  createReview,
  createReviewComment,
  createTeam,
  getTeam,
  getTeamPlans,
  listReviewComments,
  removeTeamMember,
  updateReviewStatus,
  updateTeamMemberRole,
  updateTeamPlanBinding
} from "./team.usecase";

type UsecaseResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: number; message: string; details: Array<{ field: string; reason: string }> } };

function handleResult(res: Response, result: UsecaseResult) {
  if (result.ok) return res.json(ok(result.data, randomUUID()));
  return res.status(400).json({
    code: result.error.code,
    message: result.error.message,
    details: result.error.details,
    requestId: randomUUID()
  });
}

export function postTeam(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, createTeam(auth.user, req.body || {}));
}

export function getTeamDetail(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, getTeam(auth.user, String(req.params.teamId || "")));
}

export function postTeamMember(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, addTeamMember(auth.user, String(req.params.teamId || ""), req.body || {}));
}

export function patchTeamMemberRole(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    updateTeamMemberRole(auth.user, String(req.params.teamId || ""), String(req.params.userId || ""), req.body || {})
  );
}

export function deleteTeamMember(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, removeTeamMember(auth.user, String(req.params.teamId || ""), String(req.params.userId || "")));
}

export function getPlans(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, getTeamPlans(auth.user, String(req.params.teamId || "")));
}

export function patchPlanBinding(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    updateTeamPlanBinding(auth.user, String(req.params.teamId || ""), String(req.params.globalVersionCode || ""), req.body || {})
  );
}

export function postReview(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, createReview(auth.user, String(req.params.teamId || ""), req.body || {}));
}

export function patchReviewStatus(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    updateReviewStatus(auth.user, String(req.params.teamId || ""), String(req.params.reviewId || ""), req.body || {})
  );
}

export function getReviewComments(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, listReviewComments(auth.user, String(req.params.teamId || ""), String(req.params.reviewId || "")));
}

export function postReviewComment(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    createReviewComment(auth.user, String(req.params.teamId || ""), String(req.params.reviewId || ""), req.body || {})
  );
}
