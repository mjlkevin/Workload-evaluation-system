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
import { MANUAL_TEST_RESULT_STATUSES, type ManualTestResultStatus } from "./harness.types";
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

function modelErrorReason(err: unknown): string {
  const legacyReason = (err as { legacyReason?: unknown } | null)?.legacyReason;
  if (typeof legacyReason === "string" && legacyReason) return legacyReason;
  return err instanceof Error ? err.message : String(err);
}

function failModelGeneration(res: Response, message: string, err: unknown) {
  const reason = modelErrorReason(err);
  const providerCode = (err as { code?: unknown } | null)?.code;
  const providerStatus = (err as { status?: unknown } | null)?.status;
  if (reason === "kimi_rate_limited" || providerCode === "rate_limited" || providerStatus === 429) {
    return fail(res, 42901, "模型服务请求过于频繁，请稍后重试", [{ field: "model", reason }]);
  }
  return fail(res, 40001, message, [{ field: "model", reason }]);
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
      return failModelGeneration(res, "需求解析报告生成失败", err);
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
      return failModelGeneration(res, "v2 需求解析报告生成失败", err);
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

// ============================================================
// Manual Test Result Handlers
// ============================================================

export function createManualTestResultHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const body = req.body || {};
    const executorName = asString(body.executorName);
    const environment = asString(body.environment);
    const resultStatus = asString(body.resultStatus) as ManualTestResultStatus;
    if (!executorName) return fail(res, 40001, "参数错误", [{ field: "executorName", reason: "required" }]);
    if (!environment) return fail(res, 40001, "参数错误", [{ field: "environment", reason: "required" }]);
    if (!resultStatus || !(MANUAL_TEST_RESULT_STATUSES as readonly string[]).includes(resultStatus)) {
      return fail(res, 40001, "参数错误", [{ field: "resultStatus", reason: "must be one of: passed, failed, blocked, skipped" }]);
    }
    const result = await repoFrom(deps).createManualTestResult({
      harnessRunId: asString(body.harnessRunId) || asString(req.params.runId) || undefined,
      harnessToolEventId: asString(body.harnessToolEventId) || undefined,
      testCaseKey: asString(body.testCaseKey) || undefined,
      executorName,
      environment,
      account: asString(body.account) || undefined,
      screenshotUrl: asString(body.screenshotUrl) || undefined,
      resultStatus,
      notes: asString(body.notes) || undefined,
      metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : undefined,
    });
    res.json(ok({ result }, randomUUID()));
  };
}

export function listManualTestResultsHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const runId = asString(req.params.runId) || null;
    const status = asString(req.query.status) || undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : undefined;
    const items = await repoFrom(deps).listManualTestResults(runId, { status, limit, offset });
    res.json(ok({ items }, randomUUID()));
  };
}

export function getManualTestResultHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const result = await repoFrom(deps).getManualTestResult(asString(req.params.resultId));
    if (!result) return fail(res, 40404, "测试结果不存在", [{ field: "resultId", reason: "not_found" }]);
    res.json(ok({ result }, randomUUID()));
  };
}

export function updateManualTestResultHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const body = req.body || {};
    const resultStatus = asString(body.resultStatus) as ManualTestResultStatus | undefined;
    if (resultStatus && !(MANUAL_TEST_RESULT_STATUSES as readonly string[]).includes(resultStatus)) {
      return fail(res, 40001, "参数错误", [{ field: "resultStatus", reason: "must be one of: passed, failed, blocked, skipped" }]);
    }
    const patch: Record<string, unknown> = {};
    if (body.executorName !== undefined) patch.executorName = asString(body.executorName);
    if (body.environment !== undefined) patch.environment = asString(body.environment);
    if (body.account !== undefined) patch.account = asString(body.account) || null;
    if (body.screenshotUrl !== undefined) patch.screenshotUrl = asString(body.screenshotUrl) || null;
    if (resultStatus) patch.resultStatus = resultStatus;
    if (body.notes !== undefined) patch.notes = asString(body.notes) || null;
    if (body.testCaseKey !== undefined) patch.testCaseKey = asString(body.testCaseKey) || null;
    if (body.harnessToolEventId !== undefined) patch.harnessToolEventId = asString(body.harnessToolEventId) || null;
    if (typeof body.metadata === "object" && body.metadata) patch.metadata = body.metadata;
    const result = await repoFrom(deps).updateManualTestResult(asString(req.params.resultId), patch as any);
    if (!result) return fail(res, 40404, "测试结果不存在", [{ field: "resultId", reason: "not_found" }]);
    res.json(ok({ result }, randomUUID()));
  };
}

export function deleteManualTestResultHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const deleted = await repoFrom(deps).deleteManualTestResult(asString(req.params.resultId));
    if (!deleted) return fail(res, 40404, "测试结果不存在", [{ field: "resultId", reason: "not_found" }]);
    res.json(ok({ deleted: true }, randomUUID()));
  };
}
