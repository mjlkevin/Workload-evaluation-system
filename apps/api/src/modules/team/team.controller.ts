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
  listReviews,
  listReviewComments,
  listUserTeams,
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

export async function postTeam(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await createTeam(auth.user, req.body || {}));
}

export async function getUserTeams(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await listUserTeams(auth.user));
}

export async function getTeamDetail(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await getTeam(auth.user, String(req.params.teamId || "")));
}

export async function postTeamMember(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await addTeamMember(auth.user, String(req.params.teamId || ""), req.body || {}));
}

export async function patchTeamMemberRole(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    await updateTeamMemberRole(auth.user, String(req.params.teamId || ""), String(req.params.userId || ""), req.body || {})
  );
}

export async function deleteTeamMember(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await removeTeamMember(auth.user, String(req.params.teamId || ""), String(req.params.userId || "")));
}

export async function getPlans(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await getTeamPlans(auth.user, String(req.params.teamId || "")));
}

export async function patchPlanBinding(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    await updateTeamPlanBinding(auth.user, String(req.params.teamId || ""), String(req.params.globalVersionCode || ""), req.body || {})
  );
}

export async function postReview(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await createReview(auth.user, String(req.params.teamId || ""), req.body || {}));
}

export async function getReviews(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await listReviews(auth.user, String(req.params.teamId || "")));
}

export async function patchReviewStatus(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    await updateReviewStatus(auth.user, String(req.params.teamId || ""), String(req.params.reviewId || ""), req.body || {})
  );
}

export async function getReviewComments(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(res, await listReviewComments(auth.user, String(req.params.teamId || ""), String(req.params.reviewId || "")));
}

export async function postReviewComment(req: Request, res: Response) {
  const auth = await requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;
  return handleResult(
    res,
    await createReviewComment(auth.user, String(req.params.teamId || ""), String(req.params.reviewId || ""), req.body || {})
  );
}
