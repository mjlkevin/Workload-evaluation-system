// ============================================================
// Harness Usecase
// ============================================================
// 业务规则层：运行创建、所有权隔离、文件绑定、补充信息、动作确认、
// 失败重试与重新分析标记。Phase 1A 不实现真实文件解析、LLM 调用与 SSE。

import { createHash } from "node:crypto";

import { config } from "../../config/env";
import { defaultProviderRegistry } from "../../ai/provider";
import { loadRequirementSystemConfigStore, resolveActiveRequirementKimiApiKey } from "../system/system.repository";
import { createProjectAndAssessmentDraftsFromHarness } from "../project-evaluations/project-evaluations.usecase";
import type { ProjectEvaluationDraftBundle } from "../project-evaluations/project-evaluations.types";
import type { AuthUser } from "../../types";
import type {
  HarnessArtifactRow,
  HarnessEvidenceRow,
  HarnessFileRow,
  HarnessModelRunRow,
  HarnessRunRow,
  HarnessToolEventRow,
} from "../../db/schema";
import { asString } from "../../utils";
import { createHarnessRepository, type HarnessRepository } from "./harness.repository";
import {
  canRetryHarnessStage,
  expectedStatusForHarnessStage,
  type HarnessFileUnderstandingContent,
  type HarnessRequirementReportV1Content,
  type HarnessRequirementReportV2Content,
  type HarnessRunStage,
  isHarnessRunStage,
  isHarnessStageAtLeast,
  nextStageForConfirmedAction,
  normalizeHarnessRunMode,
  type HarnessAnswerInput,
  type HarnessEvidenceInput,
  type HarnessFileMetadata,
  type HarnessParsedFileInput,
} from "./harness.types";

const REPORT_V1_PROMPT_PROFILE_ID = "harness.requirement_report_v1.default";
const REPORT_V1_PROMPT_VERSION = "2026-06-17";

const REPORT_V2_PROMPT_PROFILE_ID = "harness.requirement_report_v2.default";
const REPORT_V2_PROMPT_VERSION = "2026-06-17";

function requireOwnedRun(user: AuthUser, run: HarnessRunRow | null): HarnessRunRow | null {
  if (!run) return null;
  return run.ownerUserId === user.id ? run : null;
}

function normalizeTitle(value: unknown): string {
  const title = asString(value).trim();
  return title || "未命名 Harness Run";
}

function withFallbackText(value: unknown): string {
  const normalized = asString(value).trim();
  return normalized || "待补充";
}

function buildEvidenceSourceRef(item: { sourceSheet?: unknown; sourceCell?: unknown }, sourceFile: string, index: number): string {
  const sourceSheet = asString(item.sourceSheet).trim();
  const sourceCell = asString(item.sourceCell).trim();
  const ref = [sourceSheet, sourceCell].filter(Boolean).join("!");
  return ref || `${sourceFile}#${index + 1}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item).trim()).filter(Boolean) : [];
}

function asPriority(value: unknown): "must" | "should" | "could" {
  const normalized = asString(value).trim();
  return normalized === "should" || normalized === "could" ? normalized : "must";
}

function parseJsonObject(text: string): Record<string, unknown> {
  const raw = asString(text).trim();
  if (!raw) throw new Error("invalid_model_report_schema");
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return asRecord(JSON.parse(fenced));
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return asRecord(JSON.parse(raw.slice(start, end + 1)));
    throw new Error("invalid_model_report_schema");
  }
}

function parseReportV1(content: string): HarnessRequirementReportV1Content {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonObject(content);
  } catch {
    throw new Error("invalid_model_report_schema");
  }
  const project = asRecord(parsed.project);
  const requirementFindings = Array.isArray(parsed.requirementFindings)
    ? parsed.requirementFindings.map((item) => {
      const record = asRecord(item);
      return {
        domain: withFallbackText(record.domain),
        scenario: withFallbackText(record.scenario),
        moduleHint: withFallbackText(record.moduleHint),
        confidence: typeof record.confidence === "number" ? record.confidence : 0.5,
        evidenceRefs: asStringArray(record.evidenceRefs),
      };
    })
    : [];
  const missingFields = Array.isArray(parsed.missingFields)
    ? parsed.missingFields.map((item) => {
      const record = asRecord(item);
      return {
        field: withFallbackText(record.field),
        reason: withFallbackText(record.reason),
        priority: asPriority(record.priority),
      };
    })
    : [];
  const clarificationQuestions = Array.isArray(parsed.clarificationQuestions)
    ? parsed.clarificationQuestions.map((item) => {
      const record = asRecord(item);
      return {
        question: withFallbackText(record.question),
        targetRole: withFallbackText(record.targetRole),
        reason: withFallbackText(record.reason),
      };
    })
    : [];
  const risks = Array.isArray(parsed.risks)
    ? parsed.risks.map((item) => {
      const record = asRecord(item);
      return {
        title: withFallbackText(record.title),
        assumption: withFallbackText(record.assumption),
        impact: withFallbackText(record.impact),
      };
    })
    : [];
  const nextActions = Array.isArray(parsed.nextActions)
    ? parsed.nextActions.map((item) => {
      const record = asRecord(item);
      return {
        label: withFallbackText(record.label),
        actionType: withFallbackText(record.actionType),
      };
    })
    : [];

  if (
    parsed.version !== "v1" ||
    !asString(parsed.sourceFile).trim() ||
    !parsed.project ||
    typeof parsed.project !== "object" ||
    Array.isArray(parsed.project)
  ) {
    throw new Error("invalid_model_report_schema");
  }

  return {
    version: "v1",
    sourceFile: asString(parsed.sourceFile).trim(),
    project: {
      projectName: withFallbackText(project.projectName),
      customerName: withFallbackText(project.customerName),
      industry: withFallbackText(project.industry),
    },
    sourceSheets: asStringArray(parsed.sourceSheets),
    requirementFindings,
    missingFields,
    clarificationQuestions,
    risks,
    nextActions,
  };
}

function parseReportV2(content: string): HarnessRequirementReportV2Content {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonObject(content);
  } catch {
    throw new Error("invalid_model_report_schema");
  }
  const project = asRecord(parsed.project);
  const requirementFindings = Array.isArray(parsed.requirementFindings)
    ? parsed.requirementFindings.map((item) => {
      const record = asRecord(item);
      return {
        domain: withFallbackText(record.domain),
        scenario: withFallbackText(record.scenario),
        moduleHint: withFallbackText(record.moduleHint),
        confidence: typeof record.confidence === "number" ? record.confidence : 0.5,
        evidenceRefs: asStringArray(record.evidenceRefs),
      };
    })
    : [];
  const missingFields = Array.isArray(parsed.missingFields)
    ? parsed.missingFields.map((item) => {
      const record = asRecord(item);
      return {
        field: withFallbackText(record.field),
        reason: withFallbackText(record.reason),
        priority: asPriority(record.priority),
      };
    })
    : [];
  const clarificationQuestions = Array.isArray(parsed.clarificationQuestions)
    ? parsed.clarificationQuestions.map((item) => {
      const record = asRecord(item);
      return {
        question: withFallbackText(record.question),
        targetRole: withFallbackText(record.targetRole),
        reason: withFallbackText(record.reason),
      };
    })
    : [];
  const answeredQuestions = Array.isArray(parsed.answeredQuestions)
    ? parsed.answeredQuestions.map((item) => {
      const record = asRecord(item);
      return {
        question: withFallbackText(record.question),
        answer: record.answer ?? null,
        source: asString(record.source) || "user_chat",
      };
    })
    : [];
  const risks = Array.isArray(parsed.risks)
    ? parsed.risks.map((item) => {
      const record = asRecord(item);
      return {
        title: withFallbackText(record.title),
        assumption: withFallbackText(record.assumption),
        impact: withFallbackText(record.impact),
      };
    })
    : [];
  const nextActions = Array.isArray(parsed.nextActions)
    ? parsed.nextActions.map((item) => {
      const record = asRecord(item);
      return {
        label: withFallbackText(record.label),
        actionType: withFallbackText(record.actionType),
      };
    })
    : [];

  if (
    parsed.version !== "v2" ||
    !asString(parsed.sourceFile).trim() ||
    !parsed.project ||
    typeof parsed.project !== "object" ||
    Array.isArray(parsed.project)
  ) {
    throw new Error("invalid_model_report_schema");
  }

  return {
    version: "v2",
    sourceFile: asString(parsed.sourceFile).trim(),
    project: {
      projectName: withFallbackText(project.projectName),
      customerName: withFallbackText(project.customerName),
      industry: withFallbackText(project.industry),
    },
    sourceSheets: asStringArray(parsed.sourceSheets),
    requirementFindings,
    missingFields,
    clarificationQuestions,
    answeredQuestions,
    risks,
    nextActions,
    clarificationSummary: withFallbackText(parsed.clarificationSummary),
  };
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeRawContent(value: string): string {
  return asString(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

export type HarnessModelRunnerResult = {
  provider: string;
  model: string;
  content: string;
  rawContent?: string;
  attempts?: number;
};

export type HarnessModelRunner = (input: {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: "json_object";
}) => Promise<HarnessModelRunnerResult>;

export type HarnessFormalEstimationDraftWriter = (input: {
  user: AuthUser;
  run: HarnessRunRow;
  actionId: string;
  report: HarnessRequirementReportV2Content;
}) => Promise<ProjectEvaluationDraftBundle> | ProjectEvaluationDraftBundle;

const confirmActionLocks = new Map<string, Promise<void>>();

async function withConfirmActionLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = confirmActionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  confirmActionLocks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (confirmActionLocks.get(key) === tail) {
      confirmActionLocks.delete(key);
    }
  }
}

function minimumStageForConfirmedAction(actionType: string): HarnessRunStage | null {
  switch (actionType) {
    case "create_project_evaluation":
    case "link_project_evaluation":
    case "create_requirement_draft":
    case "publish_standard_version":
    case "overwrite_assessment_result":
    case "export_delivery_document":
      return "report_v2_ready";
    default:
      return null;
  }
}

function getKimiProvider() {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) throw new Error("kimi_provider_not_registered");
  return provider;
}

async function defaultHarnessModelRunner(input: {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: "json_object";
}): Promise<HarnessModelRunnerResult> {
  const { apiKey } = resolveActiveRequirementKimiApiKey();
  if (!apiKey) throw new Error("model_not_configured");
  const provider = getKimiProvider();
  const timeoutMs = (await loadRequirementSystemConfigStore()).active.kimiEvaluation.timeoutMs || 120000;
  const completion = await provider.chatCompletion({
    model: config.kimi.model,
    temperature: 0.2,
    responseFormat: input.responseFormat,
    promptCacheKey: "harness-requirement-report-v1",
    timeoutMs,
    credentialsOverride: { apiKey, apiBaseUrl: config.kimi.apiBaseUrl },
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  });
  return {
    provider: completion.provider,
    model: completion.model,
    content: completion.content,
    rawContent: completion.rawContent,
    attempts: completion.attempts,
  };
}

export type HarnessRunDetail = {
  run: HarnessRunRow;
  files: HarnessFileRow[];
  evidences: HarnessEvidenceRow[];
  artifacts: HarnessArtifactRow[];
  modelRuns: HarnessModelRunRow[];
  toolEvents: HarnessToolEventRow[];
};

async function loadHarnessRunDetail(run: HarnessRunRow, repo: HarnessRepository): Promise<HarnessRunDetail> {
  const [files, evidences, artifacts, modelRuns, toolEvents] = await Promise.all([
    repo.listFiles(run.harnessRunId),
    repo.listEvidences(run.harnessRunId),
    repo.listArtifacts(run.harnessRunId),
    repo.listModelRuns(run.harnessRunId),
    repo.listToolEvents(run.harnessRunId),
  ]);
  return { run, files, evidences, artifacts, modelRuns, toolEvents };
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

export async function getHarnessRunDetail(
  user: AuthUser,
  runId: string,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunDetail | null> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  return loadHarnessRunDetail(run, repo);
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
  if (run.stage !== "uploaded") {
    throw new Error("invalid_stage_for_file_binding");
  }
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

export async function submitHarnessParseResult(
  user: AuthUser,
  runId: string,
  body: HarnessParsedFileInput,
  repo: HarnessRepository = createHarnessRepository(),
): Promise<HarnessRunDetail | null> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (run.stage !== "parsing") {
    throw new Error("invalid_stage_for_parse_result");
  }

  const sourceFile = withFallbackText(body.sourceFile);
  const sourceSheets = Array.isArray(body.sheets) ? body.sheets.map((item) => asString(item).trim()).filter(Boolean) : [];
  const items = Array.isArray(body.items) ? body.items.filter((item) => item && asString(item.text).trim()) : [];
  const summary = body.summary && typeof body.summary === "object" ? body.summary : {};
  const project = {
    projectName: withFallbackText(summary.projectName),
    customerName: withFallbackText(summary.customerName),
    industry: withFallbackText(summary.industry),
  };

  const evidenceInputs: HarnessEvidenceInput[] = [
    {
      harnessRunId: run.harnessRunId,
      harnessFileId: body.fileId ?? null,
      evidenceType: "block",
      sourceRef: sourceFile,
      content: {
        kind: "summary",
        sourceFile,
        sourceSheets,
        summary: {
          ...summary,
          ...project,
        },
      },
      confidence: null,
    },
    ...items.map((item, index) => ({
      harnessRunId: run.harnessRunId,
      harnessFileId: body.fileId ?? null,
      evidenceType: "item" as const,
      sourceRef: buildEvidenceSourceRef(item, sourceFile, index),
      content: {
        kind: "item",
        sourceFile,
        sourceSheet: withFallbackText(item.sourceSheet),
        sourceCell: withFallbackText(item.sourceCell),
        category: withFallbackText(item.category),
        text: withFallbackText(item.text),
        metadata: item.metadata ?? {},
      },
      confidence: null,
    })),
  ];

  const evidences = await repo.addEvidences(evidenceInputs);
  const understanding: HarnessFileUnderstandingContent = {
    version: "v1",
    sourceFile,
    sourceSheets,
    project,
    extractedItemCount: items.length,
  };
  await repo.addArtifact({
    harnessRunId: run.harnessRunId,
    artifactType: "file_understanding",
    title: "文件理解结果 v1",
    version: "v1",
    status: "ready",
    content: understanding,
    evidenceIds: evidences.map((item) => item.harnessEvidenceId),
    modelRunId: null,
  });
  const updatedRun = await repo.updateRun(run.harnessRunId, {
    stage: "evidence_ready",
    status: "waiting",
  });
  return loadHarnessRunDetail(updatedRun ?? run, repo);
}

function estimateTokens(text: string): number {
  return Math.ceil(asString(text).length / 4);
}

function buildReportV1Prompts(input: {
  run: HarnessRunRow;
  files: HarnessFileRow[];
  evidences: HarnessEvidenceRow[];
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "你是 WES 工作量评估 Harness 中的需求理解 Agent。",
    "你运行在受控 Harness 环境中，必须只基于提供的 files/evidences 做业务理解。",
    "禁止编造客户、行业、模块、工作量或已确认事实；缺失信息必须写入 missingFields 和 clarificationQuestions。",
    "必须输出合法 JSON 对象，不要输出 Markdown、解释文字或代码块。",
    "JSON 字段必须为：version, sourceFile, project, sourceSheets, requirementFindings, missingFields, clarificationQuestions, risks, nextActions。",
    "requirementFindings[].evidenceRefs 必须引用 evidence.sourceId 或 evidence.harnessEvidenceId。",
  ].join("\n");
  const userPrompt = JSON.stringify({
    run: {
      harnessRunId: input.run.harnessRunId,
      title: input.run.title,
      stage: input.run.stage,
    },
    files: input.files.map((file) => ({
      harnessFileId: file.harnessFileId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      role: file.role,
    })),
    evidences: input.evidences.map((evidence) => ({
      harnessEvidenceId: evidence.harnessEvidenceId,
      sourceId: evidence.sourceId,
      evidenceType: evidence.evidenceType,
      textSnapshot: evidence.textSnapshot,
      tableSnapshot: evidence.tableSnapshot,
      confidence: evidence.confidence,
    })),
    outputSchema: {
      version: "v1",
      sourceFile: "string",
      project: { projectName: "string", customerName: "string", industry: "string" },
      sourceSheets: ["string"],
      requirementFindings: [{
        domain: "string",
        scenario: "string",
        moduleHint: "string",
        confidence: 0.8,
        evidenceRefs: ["sourceId or harnessEvidenceId"],
      }],
      missingFields: [{ field: "string", reason: "string", priority: "must|should|could" }],
      clarificationQuestions: [{ question: "string", targetRole: "string", reason: "string" }],
      risks: [{ title: "string", assumption: "string", impact: "string" }],
      nextActions: [{ label: "string", actionType: "string" }],
    },
  }, null, 2);
  return { systemPrompt, userPrompt };
}

export async function generateHarnessRequirementReportV1(
  user: AuthUser,
  runId: string,
  _body: { force?: boolean } = {},
  repo: HarnessRepository = createHarnessRepository(),
  modelRunner: HarnessModelRunner = defaultHarnessModelRunner,
): Promise<HarnessRunDetail | null> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (run.stage !== "evidence_ready") {
    throw new Error("invalid_stage_for_report_v1");
  }

  const startedAt = Date.now();
  await repo.updateRun(run.harnessRunId, { stage: "analyzing", status: "running", errorCode: null, errorMessage: null });
  const files = await repo.listFiles(run.harnessRunId);
  const evidences = await repo.listEvidences(run.harnessRunId);
  const evidenceIds = evidences.map((item) => item.harnessEvidenceId);
  const { systemPrompt, userPrompt } = buildReportV1Prompts({ run, files, evidences });
  let lastResult: HarnessModelRunnerResult | null = null;
  let lastSchemaError = "";

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      lastResult = await modelRunner({
        systemPrompt,
        userPrompt: attempt === 1
          ? userPrompt
          : `${userPrompt}\n\n上一轮输出未通过 schema 校验：${lastSchemaError || "invalid_model_report_schema"}。请只输出合法 JSON 对象，不要输出 Markdown。`,
        responseFormat: "json_object",
      });
      try {
        const report = parseReportV1(lastResult.content);
        const rawContent = lastResult.rawContent || lastResult.content;
        const modelRun = await repo.addModelRun({
          harnessRunId: run.harnessRunId,
          toolEventId: null,
          provider: lastResult.provider || "kimi",
          model: lastResult.model,
          mode: "model",
          promptProfileId: REPORT_V1_PROMPT_PROFILE_ID,
          promptVersion: REPORT_V1_PROMPT_VERSION,
          evidenceIds,
          inputTokenEstimate: estimateTokens(systemPrompt + userPrompt),
          outputTokenEstimate: estimateTokens(lastResult.content),
          rawContentHash: hashText(rawContent),
          rawContentSummary: summarizeRawContent(rawContent),
          elapsedMs: Date.now() - startedAt,
          fallbackReason: null,
          schemaValidationErrors: [],
        });
        await repo.addArtifact({
          harnessRunId: run.harnessRunId,
          artifactType: "requirement_report_v1",
          title: "需求解析报告 v1",
          version: "v1",
          status: "ready",
          content: report,
          evidenceIds,
          modelRunId: modelRun.harnessModelRunId,
        });
        const updatedRun = await repo.updateRun(run.harnessRunId, {
          stage: "report_v1_ready",
          status: "waiting",
          promptProfileId: REPORT_V1_PROMPT_PROFILE_ID,
          promptVersion: REPORT_V1_PROMPT_VERSION,
        });
        return loadHarnessRunDetail(updatedRun ?? run, repo);
      } catch (error) {
        lastSchemaError = error instanceof Error ? error.message : "invalid_model_report_schema";
      }
    }

    const rawContent = lastResult?.rawContent || lastResult?.content || "";
    await repo.addModelRun({
      harnessRunId: run.harnessRunId,
      toolEventId: null,
      provider: lastResult?.provider || "kimi",
      model: lastResult?.model || config.kimi.model,
      mode: "model",
      promptProfileId: REPORT_V1_PROMPT_PROFILE_ID,
      promptVersion: REPORT_V1_PROMPT_VERSION,
      evidenceIds,
      inputTokenEstimate: estimateTokens(systemPrompt + userPrompt),
      outputTokenEstimate: estimateTokens(lastResult?.content || ""),
      rawContentHash: rawContent ? hashText(rawContent) : null,
      rawContentSummary: rawContent ? summarizeRawContent(rawContent) : null,
      elapsedMs: Date.now() - startedAt,
      fallbackReason: null,
      schemaValidationErrors: [lastSchemaError || "invalid_model_report_schema"],
    });
    await repo.updateRun(run.harnessRunId, {
      stage: "failed_schema_validation",
      status: "failed",
      errorCode: "invalid_model_report_schema",
      errorMessage: lastSchemaError || "invalid_model_report_schema",
    });
    throw new Error("invalid_model_report_schema");
  } catch (error) {
    const message = error instanceof Error ? error.message : "model_failed";
    if (message !== "invalid_model_report_schema") {
      await repo.updateRun(run.harnessRunId, {
        stage: "failed",
        status: "failed",
        errorCode: message,
        errorMessage: message,
      });
    }
    throw error;
  }
}

function buildReportV2Prompts(input: {
  run: HarnessRunRow;
  files: HarnessFileRow[];
  evidences: HarnessEvidenceRow[];
  v1Report: HarnessRequirementReportV1Content;
  answers: HarnessAnswerInput[];
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "你是 WES 工作量评估 Harness 中的需求理解 Agent。",
    "你运行在受控 Harness 环境中，当前任务是基于 v1 需求解析报告、原始文件 evidence 和用户补充回答，生成 v2 优化版报告。",
    "禁止编造客户、行业、模块、工作量或已确认事实；v2 中的 missingFields 和 clarificationQuestions 应比 v1 减少或细化。",
    "必须输出合法 JSON 对象，不要输出 Markdown、解释文字或代码块。",
    "JSON 字段必须为：version, sourceFile, project, sourceSheets, requirementFindings, missingFields, clarificationQuestions, answeredQuestions, risks, nextActions, clarificationSummary。",
    "requirementFindings[].evidenceRefs 必须引用 evidence.sourceId 或 evidence.harnessEvidenceId。",
    "answeredQuestions 必须列出本次用户已回答的问题及答案来源。",
  ].join("\n");
  const userPrompt = JSON.stringify({
    run: {
      harnessRunId: input.run.harnessRunId,
      title: input.run.title,
      stage: input.run.stage,
    },
    files: input.files.map((file) => ({
      harnessFileId: file.harnessFileId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      role: file.role,
    })),
    evidences: input.evidences.map((evidence) => ({
      harnessEvidenceId: evidence.harnessEvidenceId,
      sourceId: evidence.sourceId,
      evidenceType: evidence.evidenceType,
      textSnapshot: evidence.textSnapshot,
      tableSnapshot: evidence.tableSnapshot,
      confidence: evidence.confidence,
    })),
    v1Report: input.v1Report,
    answers: input.answers,
    outputSchema: {
      version: "v2",
      sourceFile: "string",
      project: { projectName: "string", customerName: "string", industry: "string" },
      sourceSheets: ["string"],
      requirementFindings: [{
        domain: "string",
        scenario: "string",
        moduleHint: "string",
        confidence: 0.8,
        evidenceRefs: ["sourceId or harnessEvidenceId"],
      }],
      missingFields: [{ field: "string", reason: "string", priority: "must|should|could" }],
      clarificationQuestions: [{ question: "string", targetRole: "string", reason: "string" }],
      answeredQuestions: [{ question: "string", answer: "any", source: "user_chat|structured_form" }],
      risks: [{ title: "string", assumption: "string", impact: "string" }],
      nextActions: [{ label: "string", actionType: "string" }],
      clarificationSummary: "string",
    },
  }, null, 2);
  return { systemPrompt, userPrompt };
}

export async function generateHarnessRequirementReportV2(
  user: AuthUser,
  runId: string,
  _body: { force?: boolean } = {},
  repo: HarnessRepository = createHarnessRepository(),
  modelRunner: HarnessModelRunner = defaultHarnessModelRunner,
): Promise<HarnessRunDetail | null> {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (!isHarnessRunStage(run.stage) || run.stage !== "clarifying") {
    throw new Error("invalid_stage_for_report_v2");
  }

  const startedAt = Date.now();
  const files = await repo.listFiles(run.harnessRunId);
  const evidences = await repo.listEvidences(run.harnessRunId);
  const artifacts = await repo.listArtifacts(run.harnessRunId);
  const v1Artifact = [...artifacts].reverse().find((artifact) => artifact.artifactType === "requirement_report_v1");
  if (!v1Artifact) throw new Error("v1_report_not_found");
  const v1Report = v1Artifact.content as HarnessRequirementReportV1Content;
  const metadata = asRecord(run.metadata);
  const answers = Array.isArray(metadata.answers) ? metadata.answers as HarnessAnswerInput[] : [];
  if (answers.length === 0) {
    throw new Error("missing_harness_answers");
  }
  const evidenceIds = evidences.map((item) => item.harnessEvidenceId);

  await repo.updateRun(run.harnessRunId, { stage: "analyzing", status: "running", errorCode: null, errorMessage: null });
  const { systemPrompt, userPrompt } = buildReportV2Prompts({ run, files, evidences, v1Report, answers });
  let lastResult: HarnessModelRunnerResult | null = null;
  let lastSchemaError = "";

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      lastResult = await modelRunner({
        systemPrompt,
        userPrompt: attempt === 1
          ? userPrompt
          : `${userPrompt}\n\n上一轮输出未通过 schema 校验：${lastSchemaError || "invalid_model_report_schema"}。请只输出合法 JSON 对象，不要输出 Markdown。`,
        responseFormat: "json_object",
      });
      try {
        const parsedReport = parseReportV2(lastResult.content);
        const answeredQuestions = parsedReport.answeredQuestions.length
          ? parsedReport.answeredQuestions
          : answers.map((answer) => ({ question: answer.field, answer: answer.value, source: answer.source }));
        const report: HarnessRequirementReportV2Content = { ...parsedReport, answeredQuestions };
        const rawContent = lastResult.rawContent || lastResult.content;
        const modelRun = await repo.addModelRun({
          harnessRunId: run.harnessRunId,
          toolEventId: null,
          provider: lastResult.provider || "kimi",
          model: lastResult.model,
          mode: "model",
          promptProfileId: REPORT_V2_PROMPT_PROFILE_ID,
          promptVersion: REPORT_V2_PROMPT_VERSION,
          evidenceIds,
          inputTokenEstimate: estimateTokens(systemPrompt + userPrompt),
          outputTokenEstimate: estimateTokens(lastResult.content),
          rawContentHash: hashText(rawContent),
          rawContentSummary: summarizeRawContent(rawContent),
          elapsedMs: Date.now() - startedAt,
          fallbackReason: null,
          schemaValidationErrors: [],
        });
        await repo.addArtifact({
          harnessRunId: run.harnessRunId,
          artifactType: "requirement_report_v2",
          title: "需求解析报告 v2",
          version: "v2",
          status: "ready",
          content: report,
          evidenceIds,
          modelRunId: modelRun.harnessModelRunId,
        });
        const updatedRun = await repo.updateRun(run.harnessRunId, {
          stage: "report_v2_ready",
          status: "waiting",
          promptProfileId: REPORT_V2_PROMPT_PROFILE_ID,
          promptVersion: REPORT_V2_PROMPT_VERSION,
        });
        return loadHarnessRunDetail(updatedRun ?? run, repo);
      } catch (error) {
        lastSchemaError = error instanceof Error ? error.message : "invalid_model_report_schema";
      }
    }

    const rawContent = lastResult?.rawContent || lastResult?.content || "";
    await repo.addModelRun({
      harnessRunId: run.harnessRunId,
      toolEventId: null,
      provider: lastResult?.provider || "kimi",
      model: lastResult?.model || config.kimi.model,
      mode: "model",
      promptProfileId: REPORT_V2_PROMPT_PROFILE_ID,
      promptVersion: REPORT_V2_PROMPT_VERSION,
      evidenceIds,
      inputTokenEstimate: estimateTokens(systemPrompt + userPrompt),
      outputTokenEstimate: estimateTokens(lastResult?.content || ""),
      rawContentHash: rawContent ? hashText(rawContent) : null,
      rawContentSummary: rawContent ? summarizeRawContent(rawContent) : null,
      elapsedMs: Date.now() - startedAt,
      fallbackReason: null,
      schemaValidationErrors: [lastSchemaError || "invalid_model_report_schema"],
    });
    await repo.updateRun(run.harnessRunId, {
      stage: "failed_schema_validation",
      status: "failed",
      errorCode: "invalid_model_report_schema",
      errorMessage: lastSchemaError || "invalid_model_report_schema",
    });
    throw new Error("invalid_model_report_schema");
  } catch (error) {
    const message = error instanceof Error ? error.message : "model_failed";
    if (message !== "invalid_model_report_schema") {
      await repo.updateRun(run.harnessRunId, {
        stage: "failed",
        status: "failed",
        errorCode: message,
        errorMessage: message,
      });
    }
    throw error;
  }
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
  formalEstimationDraftWriter: HarnessFormalEstimationDraftWriter = ({ user, run, actionId, report }) =>
    createProjectAndAssessmentDraftsFromHarness(user, {
      harnessRunId: run.harnessRunId,
      actionId,
      aiSessionId: run.aiSessionId,
      report,
    }),
) {
  const confirmed = body.confirmed === true;
  const actionType = asString(body.actionType) || "confirmation";
  if (confirmed && actionType === "enter_formal_estimation") {
    if (actionId !== actionType) {
      throw new Error("actionId_type_mismatch");
    }
    return withConfirmActionLock(`${runId}:${actionType}`, () =>
      confirmHarnessActionCore(user, runId, actionId, body, repo, formalEstimationDraftWriter));
  }
  if (confirmed) {
    return withConfirmActionLock(`${runId}:${actionId}:${actionType}`, () =>
      confirmHarnessActionCore(user, runId, actionId, body, repo, formalEstimationDraftWriter));
  }
  return confirmHarnessActionCore(user, runId, actionId, body, repo, formalEstimationDraftWriter);
}

async function confirmHarnessActionCore(
  user: AuthUser,
  runId: string,
  actionId: string,
  body: { confirmed?: boolean; actionType?: string },
  repo: HarnessRepository,
  formalEstimationDraftWriter: HarnessFormalEstimationDraftWriter,
) {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  const confirmed = body.confirmed === true;
  const actionType = asString(body.actionType) || "confirmation";
  if (confirmed) {
    const existing = (await repo.listToolEvents(run.harnessRunId)).find((event) =>
      (actionType === "enter_formal_estimation" || event.actionId === actionId)
      && event.toolName === actionType
      && event.eventType === "confirmation"
      && event.status === "confirmed");
    if (existing) return { run, event: existing };
  }
  if (run.stage === "completed" || run.stage === "failed" || run.stage === "failed_schema_validation" || run.stage === "cancelled") {
    throw new Error("invalid_stage_for_action_confirmation");
  }
  const minimumStage = confirmed ? minimumStageForConfirmedAction(actionType) : null;
  if (minimumStage && (!isHarnessRunStage(run.stage) || !isHarnessStageAtLeast(run.stage, minimumStage))) {
    throw new Error("invalid_stage_for_action_confirmation");
  }
  let output: Record<string, unknown> | null = null;
  const nextStage = confirmed ? nextStageForConfirmedAction(actionType) : null;
  const targetStage: HarnessRunStage = nextStage ?? run.stage as HarnessRunStage;
  let runPatch: Partial<HarnessRunRow> = {
    stage: targetStage,
    status: expectedStatusForHarnessStage(targetStage),
  };

  if (confirmed && actionType === "enter_formal_estimation") {
    if (run.stage !== "report_v2_ready") {
      throw new Error("invalid_stage_for_formal_estimation");
    }
    const artifacts = await repo.listArtifacts(run.harnessRunId);
    const v2Artifact = [...artifacts].reverse().find((artifact) => artifact.artifactType === "requirement_report_v2");
    if (!v2Artifact) throw new Error("v2_report_not_found");
    const pendingEvent = await repo.addToolEvent({
      harnessRunId: run.harnessRunId,
      actionId,
      toolName: actionType,
      eventType: "confirmation",
      status: "pending",
      riskLevel: "high",
      input: { confirmed, actionType, stage: run.stage },
      output: null,
      errorMessage: null,
      resolvedAt: null,
    });
    try {
      const draftBundle = await formalEstimationDraftWriter({
        user,
        run,
        actionId,
        report: v2Artifact.content as HarnessRequirementReportV2Content,
      });
      output = {
        project: draftBundle.project,
        assessmentDraft: draftBundle.assessmentDraft,
      };
      const metadata = asRecord(run.metadata);
      const links = asRecord(metadata.links);
      runPatch = {
        ...runPatch,
        projectEvaluationId: draftBundle.project.projectId,
        metadata: {
          ...metadata,
          links: {
            ...links,
            aiSessionId: run.aiSessionId ?? links.aiSessionId,
            projectEvaluationId: draftBundle.project.projectId,
            assessmentVersionId: draftBundle.assessmentDraft.recordId,
            assessmentVersionCode: draftBundle.assessmentDraft.versionCode,
          },
          lastConfirmedAction: {
            actionId,
            actionType,
            confirmedAt: new Date().toISOString(),
          },
        },
      };
      const updated = await repo.updateRun(run.harnessRunId, runPatch);
      const event = await repo.updateToolEvent(pendingEvent.harnessToolEventId, {
        status: "confirmed",
        output,
        errorMessage: null,
        resolvedAt: new Date(),
      }) ?? pendingEvent;
      return { run: updated ?? run, event: { ...event, status: "confirmed", output } as HarnessToolEventRow };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repo.updateToolEvent(pendingEvent.harnessToolEventId, {
        status: "failed",
        output,
        errorMessage: message,
        resolvedAt: new Date(),
      });
      throw error;
    }
  }

  const event = await repo.addToolEvent({
    harnessRunId: run.harnessRunId,
    actionId,
    toolName: actionType,
    eventType: "confirmation",
    status: confirmed ? "confirmed" : "cancelled",
    riskLevel: "high",
    input: { confirmed, actionType, stage: run.stage },
    output,
    errorMessage: null,
    resolvedAt: new Date(),
  });
  const updated = await repo.updateRun(run.harnessRunId, runPatch);
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
    stage: "evidence_ready",
    status: "waiting",
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
  if (run.stage !== "report_v1_ready" && run.stage !== "clarifying" && run.stage !== "report_v2_ready") throw new Error("invalid_stage_for_reanalyze");
  return repo.updateRun(run.harnessRunId, {
    forceReanalysis: true,
    stage: "analyzing",
    status: "running",
  });
}
