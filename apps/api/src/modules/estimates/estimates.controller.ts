import { Request, Response } from "express";

import { requireRole, requireRoleWithAuth } from "../../middleware/auth";
import { fail, ok } from "../../utils/response";
import { CalculateRequest } from "../../types";
import {
  calculateAndExportEstimate,
  calculateEstimateOnly,
  getActiveImplementationDependencyRules,
  listExportHistoryByOwner,
} from "./estimates.usecase";

export function calculate(req: Request, res: Response) {
  if (!requireRole(req, res, ["admin", "operator"])) return;

  const body = req.body as CalculateRequest;
  const result = calculateEstimateOnly(body);
  if (!result.ok) {
    return fail(res, result.code, result.message, result.details);
  }
  return res.json(ok(result.data, result.requestId));
}

export async function calculateAndExport(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const body = req.body as CalculateRequest & { exportType?: "excel" | "pdf" };
  const idempotencyKey = String(req.header("Idempotency-Key") || "").trim() || undefined;
  const result = await calculateAndExportEstimate(body, auth.user.id, idempotencyKey);
  if (!result.ok) {
    return fail(res, result.code, result.message, result.details);
  }
  return res.json(ok(result.data, result.requestId));
}

export async function exportExcel(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const body = req.body as CalculateRequest;
  const idempotencyKey = String(req.header("Idempotency-Key") || "").trim() || undefined;
  const result = await calculateAndExportEstimate({ ...body, exportType: "excel" }, auth.user.id, idempotencyKey);
  if (!result.ok) {
    return fail(res, result.code, result.message, result.details);
  }
  return res.json(ok(result.data, result.requestId));
}

export async function exportPdf(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const body = req.body as CalculateRequest;
  const idempotencyKey = String(req.header("Idempotency-Key") || "").trim() || undefined;
  const result = await calculateAndExportEstimate({ ...body, exportType: "pdf" }, auth.user.id, idempotencyKey);
  if (!result.ok) {
    return fail(res, result.code, result.message, result.details);
  }
  return res.json(ok(result.data, result.requestId));
}

export function listExportHistory(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 20)));
  const data = listExportHistoryByOwner(auth.user.id, page, pageSize);
  return res.json(ok({ page, pageSize, ...data }));
}

export function getActiveDependencyRules(req: Request, res: Response) {
  if (!requireRole(req, res, ["admin", "operator"])) return;
  const data = getActiveImplementationDependencyRules();
  return res.json(ok(data));
}
