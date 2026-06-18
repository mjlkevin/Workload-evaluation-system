// ============================================================
// Harness Controller
// ============================================================
// Express 请求处理器：封装 usecase，统一使用 JWT 鉴权与标准响应结构。

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

import { requireAuth } from "../../middleware/auth";
import { asString } from "../../utils";
import { fail, ok } from "../../utils/response";
import type { HarnessRepository } from "./harness.repository";
import { createHarnessRepository } from "./harness.repository";
import {
  bindHarnessFile,
  confirmHarnessAction,
  createHarnessRun,
  generateHarnessRequirementReportV1,
  generateHarnessRequirementReportV2,
  getHarnessRunDetail,
  listHarnessRuns,
  reanalyzeHarnessRun,
  retryHarnessRun,
  submitHarnessParseResult,
  submitHarnessAnswers,
  type HarnessFormalEstimationDraftWriter,
  type HarnessModelRunner,
} from "./harness.usecase";

export interface HarnessControllerDeps {
  repo?: HarnessRepository;
  modelRunner?: HarnessModelRunner;
  formalEstimationDraftWriter?: HarnessFormalEstimationDraftWriter;
}

function repoFrom(deps: HarnessControllerDeps): HarnessRepository {
  return deps.repo ?? createHarnessRepository();
}

export function createRunHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const run = await createHarnessRun(auth.user, req.body || {}, repoFrom(deps));
    res.json(ok({ run }, randomUUID()));
  };
}

export function listRunsHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const items = await listHarnessRuns(auth.user, req.query || {}, repoFrom(deps));
    res.json(ok({ items }, randomUUID()));
  };
}

export function getRunHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const detail = await getHarnessRunDetail(auth.user, asString(req.params.runId), repoFrom(deps));
    if (!detail) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
    res.json(ok(detail, randomUUID()));
  };
}

export function bindFileHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const body = req.body || {};
    const attachmentId = asString(body.attachmentId);
    const fileName = asString(body.fileName);
    if (!attachmentId) return fail(res, 40001, "参数错误", [{ field: "attachmentId", reason: "required" }]);
    if (!fileName) return fail(res, 40001, "参数错误", [{ field: "fileName", reason: "required" }]);
    try {
      const result = await bindHarnessFile(auth.user, asString(req.params.runId), {
        attachmentId,
        fileName,
        fileSize: typeof body.fileSize === "number" ? body.fileSize : undefined,
        mimeType: asString(body.mimeType) || undefined,
        fileHash: asString(body.fileHash) || undefined,
        storagePath: asString(body.storagePath) || undefined,
        role: asString(body.role) || undefined,
        roleConfidence: typeof body.roleConfidence === "number" ? body.roleConfidence : undefined,
      }, repoFrom(deps));
      if (!result) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok(result, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "当前阶段不可绑定文件", [{ field: "stage", reason: message }]);
    }
  };
}

export function submitAnswersHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const run = await submitHarnessAnswers(auth.user, asString(req.params.runId), req.body || {}, repoFrom(deps));
      if (!run) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok({ run }, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "当前阶段不可提交补充信息", [{ field: "stage", reason: message }]);
    }
  };
}

export function submitParseResultHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const detail = await submitHarnessParseResult(auth.user, asString(req.params.runId), req.body || {}, repoFrom(deps));
      if (!detail) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok(detail, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "当前阶段不可提交文件解析结果", [{ field: "stage", reason: message }]);
    }
  };
}

export function generateReportV1Handler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const detail = await generateHarnessRequirementReportV1(auth.user, asString(req.params.runId), req.body || {}, repoFrom(deps), deps.modelRunner);
      if (!detail) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok(detail, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "需求解析报告生成失败", [{ field: "model", reason: message }]);
    }
  };
}

export function generateReportV2Handler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const detail = await generateHarnessRequirementReportV2(auth.user, asString(req.params.runId), req.body || {}, repoFrom(deps), deps.modelRunner);
      if (!detail) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok(detail, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "v2 需求解析报告生成失败", [{ field: "model", reason: message }]);
    }
  };
}

export function confirmActionHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const result = await confirmHarnessAction(auth.user, asString(req.params.runId), asString(req.params.actionId), req.body || {}, repoFrom(deps), deps.formalEstimationDraftWriter);
      if (!result) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok(result, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "当前阶段不可确认动作", [{ field: "stage", reason: message }]);
    }
  };
}

export function retryRunHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const run = await retryHarnessRun(auth.user, asString(req.params.runId), repoFrom(deps));
      res.json(ok({ run }, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "not_found") return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      return fail(res, 40001, "当前阶段不可重试", [{ field: "stage", reason: message }]);
    }
  };
}

export function reanalyzeRunHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const run = await reanalyzeHarnessRun(auth.user, asString(req.params.runId), repoFrom(deps));
      if (!run) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
      res.json(ok({ run }, randomUUID()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(res, 40001, "当前阶段不可重新分析", [{ field: "stage", reason: message }]);
    }
  };
}

export function eventsHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const detail = await getHarnessRunDetail(auth.user, asString(req.params.runId), repoFrom(deps));
    if (!detail) return fail(res, 40404, "Harness Run 不存在", [{ field: "runId", reason: "not_found" }]);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.write("event: run_state\n");
    res.write(`data: ${JSON.stringify({ stage: detail.run.stage, status: detail.run.status })}\n\n`);
    res.end();
  };
}
