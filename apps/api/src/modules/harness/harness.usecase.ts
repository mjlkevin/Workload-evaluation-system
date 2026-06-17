// ============================================================
// Harness Usecase
// ============================================================
// 业务规则层：运行创建、所有权隔离、文件绑定、补充信息、动作确认、
// 失败重试与重新分析标记。Phase 1A 不实现真实文件解析、LLM 调用与 SSE。

import type { AuthUser } from "../../types";
import type { HarnessRunRow } from "../../db/schema";
import { asString } from "../../utils";
import { createHarnessRepository, type HarnessRepository } from "./harness.repository";
import {
  canRetryHarnessStage,
  isHarnessRunStage,
  isHarnessStageAtLeast,
  nextStageForConfirmedAction,
  normalizeHarnessRunMode,
  type HarnessAnswerInput,
  type HarnessFileMetadata,
} from "./harness.types";

function requireOwnedRun(user: AuthUser, run: HarnessRunRow | null): HarnessRunRow | null {
  if (!run) return null;
  return run.ownerUserId === user.id ? run : null;
}

function normalizeTitle(value: unknown): string {
  const title = asString(value).trim();
  return title || "未命名 Harness Run";
}

export async function createHarnessRun(
  user: AuthUser,
  body: Record<string, unknown>,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunRow> {
  return repo.createRun({
    ownerUserId: user.id,
    ownerUsername: user.username,
    title: normalizeTitle(body.title),
    mode: normalizeHarnessRunMode(body.mode),
    stage: "uploaded",
    status: "waiting",
    aiSessionId: asString(body.aiSessionId) || undefined,
    metadata: {
      links: {
        aiSessionId: asString(body.aiSessionId) || undefined,
      },
    },
  });
}

export async function getHarnessRun(
  user: AuthUser,
  runId: string,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunRow | null> {
  return requireOwnedRun(user, await repo.findRunById(runId));
}

export async function listHarnessRuns(
  user: AuthUser,
  query: Record<string, unknown>,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunRow[]> {
  const limit = Number(query.limit);
  const offset = Number(query.offset);
  return repo.listRunsForOwner(user.id, {
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  });
}

export async function bindHarnessFile(
  user: AuthUser,
  runId: string,
  file: HarnessFileMetadata,
  repo: HarnessRepository = createHarnessRepository(),
) {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  const saved = await repo.addFile({
    harnessRunId: run.harnessRunId,
    attachmentId: file.attachmentId,
    fileName: file.fileName,
    fileSize: file.fileSize ?? null,
    mimeType: file.mimeType ?? null,
    fileHash: file.fileHash ?? null,
    storagePath: file.storagePath ?? null,
    role: file.role ?? null,
    roleConfidence: file.roleConfidence ?? null,
    metadata: {},
  });
  const updated = await repo.updateRun(run.harnessRunId, { stage: "parsing", status: "running" });
  return { run: updated ?? run, file: saved };
}

export async function submitHarnessAnswers(
  user: AuthUser,
  runId: string,
  body: { answers?: HarnessAnswerInput[] },
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunRow | null> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (!isHarnessRunStage(run.stage) || !isHarnessStageAtLeast(run.stage, "report_v1_ready")) throw new Error("invalid_stage_for_answers");
  const existingMetadata = (run.metadata && typeof run.metadata === "object" ? run.metadata : {}) as Record<string, unknown>;
  const answers = Array.isArray(body.answers) ? body.answers.filter((item) => item && asString(item.field)) : [];
  return repo.updateRun(run.harnessRunId, {
    stage: "clarifying",
    status: "waiting",
    metadata: {
      ...existingMetadata,
      answers,
    },
  });
}

export async function confirmHarnessAction(
  user: AuthUser,
  runId: string,
  actionId: string,
  body: { confirmed?: boolean; actionType?: string },
  repo: HarnessRepository = createHarnessRepository(),
) {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  const confirmed = body.confirmed === true;
  const actionType = asString(body.actionType) || "confirmation";
  const nextStage = confirmed ? nextStageForConfirmedAction(actionType) : null;
  const event = await repo.addToolEvent({
    harnessRunId: run.harnessRunId,
    actionId,
    toolName: actionType,
    eventType: "confirmation",
    status: confirmed ? "confirmed" : "cancelled",
    riskLevel: "high",
    input: { confirmed, actionType },
    output: null,
    errorMessage: null,
    resolvedAt: new Date(),
  });
  const updated = await repo.updateRun(run.harnessRunId, {
    stage: nextStage ?? run.stage,
    status: "waiting",
  });
  return { run: updated ?? run, event };
}

export async function retryHarnessRun(
  user: AuthUser,
  runId: string,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunRow> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) throw new Error("not_found");
  if (!isHarnessRunStage(run.stage) || !canRetryHarnessStage(run.stage)) throw new Error("cannot_retry");
  const updated = await repo.updateRun(run.harnessRunId, {
    stage: "analyzing",
    status: "running",
    errorCode: null,
    errorMessage: null,
  });
  return updated ?? run;
}

export async function reanalyzeHarnessRun(
  user: AuthUser,
  runId: string,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunRow | null> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (!isHarnessRunStage(run.stage) || !isHarnessStageAtLeast(run.stage, "evidence_ready")) throw new Error("invalid_stage_for_reanalyze");
  return repo.updateRun(run.harnessRunId, {
    forceReanalysis: true,
    stage: "analyzing",
    status: "running",
  });
}
