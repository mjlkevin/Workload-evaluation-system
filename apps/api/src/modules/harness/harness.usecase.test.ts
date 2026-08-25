import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  isHarnessRunStage,
  normalizeHarnessRunMode,
  canRetryHarnessStage,
  HARNESS_RUN_STAGES,
  expectedStatusForHarnessStage,
  isValidHarnessStageStatus,
  nextStageForConfirmedAction,
  type HarnessRequirementReportV2Content,
} from "./harness.types";
import {
  DEFAULT_HARNESS_REGRESSION_SAMPLES,
  normalizeHarnessRegressionSample,
  scoreHarnessRegressionReport,
} from "./harness.regression";

import {
  harnessRuns,
  harnessEvidences,
  harnessArtifacts,
  harnessToolEvents,
  harnessModelRuns,
  harnessScores,
  harnessCases,
  harnessExpectedAnswers,
} from "../../db/schema";

import {
  createHarnessRunRecord,
  listHarnessRunsForOwner,
  type HarnessRepository,
} from "./harness.repository";

import type {
  HarnessRunRow,
  HarnessFileRow,
  HarnessEvidenceRow,
  HarnessArtifactRow,
  HarnessToolEventRow,
  HarnessModelRunRow,
} from "../../db/schema";
import type { AuthUser } from "../../types";
import { versionsStorePath } from "../../utils";
import { _resetVersionsRepositoryForTest, loadVersionsStore } from "../versions/versions.repository";
import { createProjectAndAssessmentDraftsFromHarness, listProjectEvaluationsForUser, getProjectEvaluationForUser, confirmAiAssessmentDraftForUser } from "../project-evaluations/project-evaluations.usecase";
import {
  createHarnessRun,
  generateHarnessRequirementReportV1,
  generateHarnessRequirementReportV2,
  getHarnessRun,
  getHarnessRunDetail,
  listHarnessRuns,
  bindHarnessFile,
  submitHarnessParseResult,
  submitHarnessAnswers,
  confirmHarnessAction,
  retryHarnessRun,
  reanalyzeHarnessRun,
} from "./harness.usecase";

/**
 * C10（2026-08-25）：以下 project-evaluations 用例假定 versions 走 JSON 文件实现
 * （patch fs 断言原子写、loadVersionsStore 直读文件）。全局开关全开（PG）时
 * 选择器走 PG，断言失效——这里显式隔离到 JSON 实现，与全局开关无关。
 */
async function withVersionsJsonIsolation<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.WES_STORE_VERSIONS_PG;
  delete process.env.WES_STORE_VERSIONS_PG;
  _resetVersionsRepositoryForTest();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.WES_STORE_VERSIONS_PG;
    else process.env.WES_STORE_VERSIONS_PG = prev;
    _resetVersionsRepositoryForTest();
  }
}

test("harness.types: validates known run stages", () => {
  assert.ok(HARNESS_RUN_STAGES.includes("uploaded"));
  assert.ok(HARNESS_RUN_STAGES.includes("completed"));
  assert.equal(isHarnessRunStage("report_v1_ready"), true);
  assert.equal(isHarnessRunStage("bad_stage"), false);
});

test("harness.types: normalizes run mode", () => {
  assert.equal(normalizeHarnessRunMode("interactive"), "interactive");
  assert.equal(normalizeHarnessRunMode("replay"), "replay");
  assert.equal(normalizeHarnessRunMode("regression"), "regression");
  assert.equal(normalizeHarnessRunMode("unknown"), "interactive");
  assert.equal(normalizeHarnessRunMode(undefined), "interactive");
});

test("harness.types: retry is allowed only from failed states", () => {
  assert.equal(canRetryHarnessStage("failed"), true);
  assert.equal(canRetryHarnessStage("failed_schema_validation"), true);
  assert.equal(canRetryHarnessStage("uploaded"), false);
  assert.equal(canRetryHarnessStage("completed"), false);
});

test("harness.types: validates stage and status combinations", () => {
  assert.equal(expectedStatusForHarnessStage("uploaded"), "waiting");
  assert.equal(expectedStatusForHarnessStage("parsing"), "running");
  assert.equal(expectedStatusForHarnessStage("completed"), "completed");
  assert.equal(isValidHarnessStageStatus("failed", "failed"), true);
  assert.equal(isValidHarnessStageStatus("failed", "running"), false);
});

test("harness.types: maps confirmed action types to target stages", () => {
  assert.equal(nextStageForConfirmedAction("create_project_evaluation"), "project_link_pending");
  assert.equal(nextStageForConfirmedAction("create_requirement_draft"), "requirement_draft_pending");
  assert.equal(nextStageForConfirmedAction("enter_formal_estimation"), "ready_for_estimation");
  assert.equal(nextStageForConfirmedAction("export_delivery_document"), null);
  assert.equal(nextStageForConfirmedAction("unknown"), null);
});

test("harness.schema: exports all harness tables", () => {
  assert.ok(harnessRuns);
  assert.ok(harnessEvidences);
  assert.ok(harnessArtifacts);
  assert.ok(harnessToolEvents);
  assert.ok(harnessModelRuns);
  assert.ok(harnessScores);
  assert.ok(harnessCases);
  assert.ok(harnessExpectedAnswers);
});

test("harness.regression: normalizes deterministic sample format", () => {
  const sample = normalizeHarnessRegressionSample({
    caseKey: "manufacturing-procurement-mvp",
    title: "制造业采购闭环 MVP",
    expected: {
      project: { customerName: "蓝海制造", industry: "制造业" },
      requirementFindings: [
        {
          domain: "供应链",
          scenario: "采购到入库闭环",
          moduleHint: "供应链云",
          evidenceRefs: ["需求清单!B12"],
        },
      ],
    },
  });

  assert.equal(sample.version, "harness-regression-sample.v1");
  assert.equal(sample.sampleType, "requirement_report_v2");
  assert.equal(sample.active, true);
  assert.equal(sample.expected.version, "harness-regression-expected.v1");
  assert.equal(sample.expected.threshold, 0.8);
});

test("harness.regression: scores report by project fields requirement coverage and evidence refs", () => {
  const sample = DEFAULT_HARNESS_REGRESSION_SAMPLES[0];
  const partialReport: HarnessRequirementReportV2Content = {
    version: "v2",
    sourceFile: "蓝海制造需求.xlsx",
    project: { projectName: "蓝海采购协同", customerName: "蓝海制造", industry: "制造业" },
    sourceSheets: ["需求清单"],
    requirementFindings: [
      {
        domain: "供应链",
        scenario: "采购到入库闭环",
        moduleHint: "供应链云",
        confidence: 0.88,
        evidenceRefs: ["需求清单!B12"],
      },
    ],
    missingFields: [],
    clarificationQuestions: [],
    answeredQuestions: [],
    risks: [],
    nextActions: [],
    clarificationSummary: "已补充范围。",
  };

  const partialScore = scoreHarnessRegressionReport(partialReport, sample.expected);

  assert.equal(partialScore.scoreType, "requirement_match_v1");
  assert.equal(partialScore.value, 0.65);
  assert.equal(partialScore.passed, false);
  assert.equal(partialScore.details.project.matchedFields, 3);
  assert.equal(partialScore.details.requirements.expectedCount, 2);
  assert.equal(partialScore.details.requirements.matchedCount, 1);
  assert.deepEqual(partialScore.details.evidence.matchedRefs, ["需求清单!B12"]);

  const fullReport: HarnessRequirementReportV2Content = {
    ...partialReport,
    requirementFindings: [
      ...partialReport.requirementFindings,
      {
        domain: "财务核算",
        scenario: "自动生成采购凭证",
        moduleHint: "总账",
        confidence: 0.81,
        evidenceRefs: ["需求清单!B14"],
      },
    ],
  };

  const fullScore = scoreHarnessRegressionReport(fullReport, sample.expected);
  assert.equal(fullScore.value, 1);
  assert.equal(fullScore.passed, true);
  assert.equal(fullScore.details.requirements.matchedCount, 2);
});

test("harness.repository: repository contract exposes create and detail list functions", () => {
  const repo: Pick<HarnessRepository, "createRun" | "listRunsForOwner" | "addEvidences" | "listEvidences"> = {
    createRun: async (input) => ({
      harnessRunId: "run-1",
      ownerUserId: input.ownerUserId,
      ownerUsername: input.ownerUsername,
      mode: input.mode,
      stage: input.stage,
      status: input.status,
      title: input.title,
      aiSessionId: null,
      projectEvaluationId: null,
      requirementVersionId: null,
      originalStandardSetVersion: null,
      replayStandardSetVersion: null,
      promptProfileId: null,
      promptVersion: null,
      forceReanalysis: false,
      metadata: {},
      errorCode: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      runKind: "file_analysis",
      workflowId: "legacy_file_analysis",
      workflowVersion: "v1",
      currentStepKey: null,
      submissionKey: null,
      eventSequence: 0,
      availableAt: new Date(),
      recoveryCount: 0,
      cancelRequestedAt: null,
      cancelRequestedBy: null,
      lastCheckpointId: null,
      executionConfig: {},
      retryOfRunId: null,
    }),
    listRunsForOwner: async () => [],
    addEvidences: async () => [],
    listEvidences: async () => [],
  };

  assert.equal(typeof repo.createRun, "function");
  assert.equal(typeof repo.listRunsForOwner, "function");
  assert.equal(typeof repo.addEvidences, "function");
  assert.equal(typeof repo.listEvidences, "function");
});

function activeHarnessUser(): AuthUser {
  return {
    id: "u-1",
    username: "elly",
    role: "admin",
    status: "active",
    passwordHash: "",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    permissions: [],
  } as AuthUser;
}

function withFileSnapshotRestore(filePath: string, run: () => void): void {
  const existed = fs.existsSync(filePath);
  const snapshot = existed ? fs.readFileSync(filePath, "utf-8") : "";
  try {
    run();
  } finally {
    if (existed) fs.writeFileSync(filePath, snapshot, "utf-8");
    else if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

async function withFileSnapshotRestoreAsync(filePath: string, run: () => Promise<void>): Promise<void> {
  const existed = fs.existsSync(filePath);
  const snapshot = existed ? fs.readFileSync(filePath, "utf-8") : "";
  try {
    await run();
  } finally {
    if (existed) fs.writeFileSync(filePath, snapshot, "utf-8");
    else if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

function makeMemoryHarnessRepo(): HarnessRepository {
  const runs: HarnessRunRow[] = [];
  const files: HarnessFileRow[] = [];
  const evidences: HarnessEvidenceRow[] = [];
  const artifacts: HarnessArtifactRow[] = [];
  const toolEvents: HarnessToolEventRow[] = [];
  const modelRuns: HarnessModelRunRow[] = [];
  const byCreatedAtAsc = <T extends { createdAt: Date }>(items: T[]): T[] =>
    [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    async createRun(input) {
      const now = new Date();
      const run = {
        harnessRunId: `run-${runs.length + 1}`,
        ownerUserId: input.ownerUserId,
        ownerUsername: input.ownerUsername,
        mode: input.mode,
        stage: input.stage,
        status: input.status,
        title: input.title,
        aiSessionId: input.aiSessionId ?? null,
        projectEvaluationId: null,
        requirementVersionId: null,
        originalStandardSetVersion: null,
        replayStandardSetVersion: null,
        promptProfileId: null,
        promptVersion: null,
        forceReanalysis: false,
        metadata: input.metadata ?? {},
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        runKind: "file_analysis",
        workflowId: "legacy_file_analysis",
        workflowVersion: "v1",
        currentStepKey: null,
        submissionKey: null,
        eventSequence: 0,
        availableAt: now,
        recoveryCount: 0,
        cancelRequestedAt: null,
        cancelRequestedBy: null,
        lastCheckpointId: null,
        executionConfig: {},
        retryOfRunId: null,
      } satisfies HarnessRunRow;
      runs.push(run);
      return run;
    },
    async findRunById(id) {
      return runs.find((run) => run.harnessRunId === id) ?? null;
    },
    async listRunsForOwner(ownerUserId) {
      return runs.filter((run) => run.ownerUserId === ownerUserId);
    },
    async updateRun(id, patch) {
      const idx = runs.findIndex((run) => run.harnessRunId === id);
      if (idx < 0) return null;
      runs[idx] = { ...runs[idx], ...patch, updatedAt: new Date() } as HarnessRunRow;
      return runs[idx];
    },
    async addFile(input) {
      const row = { ...input, harnessFileId: `file-${files.length + 1}`, createdAt: new Date() } as HarnessFileRow;
      files.push(row);
      return row;
    },
    async listFiles(runId) {
      return byCreatedAtAsc(files.filter((file) => file.harnessRunId === runId));
    },
    async addEvidences(inputs) {
      const baseIndex = evidences.length;
      const rows = inputs.map((input, index) => ({
        harnessEvidenceId: `evidence-${baseIndex + index + 1}`,
        harnessRunId: input.harnessRunId,
        harnessFileId: input.harnessFileId ?? null,
        sourceType: "attachment",
        sourceId: input.sourceRef,
        evidenceType: input.evidenceType,
        businessTags: [],
        locator: {},
        textSnapshot: null,
        tableSnapshot: input.content,
        parserVersion: "phase1b-v1",
        fileHash: null,
        confidence: input.confidence ?? null,
        metadata: {},
        createdAt: new Date(),
      } satisfies HarnessEvidenceRow));
      evidences.push(...rows);
      return rows;
    },
    async listEvidences(runId) {
      return byCreatedAtAsc(evidences.filter((evidence) => evidence.harnessRunId === runId));
    },
    async addArtifact(input) {
      const now = new Date();
      const row = { ...input, harnessArtifactId: `artifact-${artifacts.length + 1}`, createdAt: now, updatedAt: now } as HarnessArtifactRow;
      artifacts.push(row);
      return row;
    },
    async listArtifacts(runId) {
      return byCreatedAtAsc(artifacts.filter((artifact) => artifact.harnessRunId === runId));
    },
    async addToolEvent(input) {
      const row = { ...input, harnessToolEventId: `tool-${toolEvents.length + 1}`, createdAt: new Date() } as HarnessToolEventRow;
      toolEvents.push(row);
      return row;
    },
    async updateToolEvent(id, patch) {
      const idx = toolEvents.findIndex((event) => event.harnessToolEventId === id);
      if (idx < 0) return null;
      toolEvents[idx] = { ...toolEvents[idx], ...patch } as HarnessToolEventRow;
      return toolEvents[idx];
    },
    async listToolEvents(runId) {
      return byCreatedAtAsc(toolEvents.filter((event) => event.harnessRunId === runId));
    },
    async addModelRun(input) {
      const row = { ...input, harnessModelRunId: `model-${modelRuns.length + 1}`, createdAt: new Date() } as HarnessModelRunRow;
      modelRuns.push(row);
      return row;
    },
    async listModelRuns(runId) {
      return byCreatedAtAsc(modelRuns.filter((run) => run.harnessRunId === runId));
    },
    async createManualTestResult() { throw new Error("not_implemented"); },
    async getManualTestResult() { return null; },
    async listManualTestResults() { return []; },
    async updateManualTestResult() { return null; },
    async deleteManualTestResult() { return false; },
  };
}

async function addHarnessV2ReportArtifact(repo: HarnessRepository, runId: string) {
  return repo.addArtifact({
    harnessRunId: runId,
    artifactType: "requirement_report_v2",
    title: "需求解析报告 v2",
    version: "v2",
    status: "ready",
    content: {
      version: "v2",
      sourceFile: "需求.xlsx",
      project: { projectName: "蓝海制造项目", customerName: "蓝海制造", industry: "制造业" },
      sourceSheets: ["项目概况", "需求清单"],
      requirementFindings: [
        { domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] },
      ],
      missingFields: [],
      clarificationQuestions: [],
      answeredQuestions: [{ question: "实施范围", answer: "一期覆盖采购到入库", source: "user_chat" }],
      risks: [{ title: "接口风险", assumption: "存在外部 WMS 对接", impact: "需要评估接口工作量" }],
      nextActions: [{ label: "生成项目/评估草稿", actionType: "enter_formal_estimation" }],
      clarificationSummary: "用户已补充一期范围。",
    },
    evidenceIds: [],
    modelRunId: null,
  });
}

function makeDraftBundle(user: AuthUser, projectId = "project-draft-1", assessmentId = "assessment-draft-1") {
  const now = new Date().toISOString();
  return {
    project: {
      projectId,
      projectName: "蓝海制造项目",
      customerName: "蓝海制造",
      industry: "制造业",
      currentStage: "assessment_draft",
      status: "draft" as const,
      ownerUserId: user.id,
      ownerUsername: user.username,
      versionCode: "GL-08-001",
      participantUserIds: [],
      currentAssessmentVersionId: assessmentId,
      createdFromSessionId: undefined,
      sourceGlobalVersionRecordId: projectId,
      createdAt: now,
      updatedAt: now,
    },
    assessmentDraft: {
      recordId: assessmentId,
      versionCode: `IA-AI-DRAFT-${assessmentId}`,
      status: "draft_from_ai" as const,
    },
  };
}

test("harness.usecase: creates and lists runs for owner", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "哈希温控评估", mode: "bad" }, repo);

  assert.equal(created.title, "哈希温控评估");
  assert.equal(created.mode, "interactive");
  assert.equal(created.stage, "uploaded");
  assert.equal(created.status, "waiting");

  const items = await listHarnessRuns(user, {}, repo);
  assert.equal(items.length, 1);
  assert.equal(items[0].harnessRunId, created.harnessRunId);
});

test("harness.usecase: denies access to another user's run", async () => {
  const repo = makeMemoryHarnessRepo();
  const owner = activeHarnessUser();
  const other = { ...owner, id: "u-2", username: "other" };
  const created = await createHarnessRun(owner, { title: "私有运行" }, repo);
  const found = await getHarnessRun(other, created.harnessRunId, repo);
  assert.equal(found, null);
});

test("harness.usecase: bind file moves uploaded run to parsing", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "绑定文件" }, repo);
  const result = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-1",
    fileName: "实施工作量评估申请.xlsx",
    fileSize: 1024,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }, repo);

  assert.ok(result);
  assert.equal(result.run.stage, "parsing");
  assert.equal(result.file.fileName, "实施工作量评估申请.xlsx");
});

test("harness.usecase: submit parse result persists evidences and file understanding artifact", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "解析入库" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-parse-1",
    fileName: "项目评估.xlsx",
    fileSize: 2048,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }, repo);

  assert.ok(bindResult);

  const detail = await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "项目评估.xlsx",
    sheets: ["项目概况", "需求清单"],
    summary: {
      projectName: "星云一期",
      customerName: "华北制造",
      industry: "离散制造",
    },
    items: [
      {
        sourceSheet: "需求清单",
        sourceCell: "B12",
        category: "scope",
        text: "新增仓储执行看板",
      },
      {
        sourceSheet: "需求清单",
        sourceCell: "B13",
        text: "待补充",
      },
    ],
  }, repo);

  assert.ok(detail);
  assert.equal(detail.run.stage, "evidence_ready");
  assert.equal(detail.run.status, "waiting");
  assert.equal(detail.evidences.length, 3);
  assert.equal(detail.evidences[1].sourceId, "需求清单!B12");
  assert.equal(detail.evidences[2].sourceId, "需求清单!B13");
  assert.equal(detail.artifacts.at(-1)?.artifactType, "file_understanding");
  assert.equal(detail.artifacts.at(-1)?.title, "文件理解结果 v1");
});

test("harness.usecase: parse result keeps trace refs separate from display fallbacks", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "追踪标识" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-trace-1",
    fileName: "追踪文件.xlsx",
  }, repo);

  assert.ok(bindResult);

  const detail = await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "追踪文件.xlsx",
    sheets: ["S1"],
    summary: {},
    items: [
      { sourceCell: "C8", text: "只有单元格" },
      { text: "没有定位" },
    ],
  }, repo);

  assert.ok(detail);
  assert.equal(detail.evidences[1].sourceId, "C8");
  assert.equal(detail.evidences[2].sourceId, "追踪文件.xlsx#2");

  const artifact = detail.artifacts.at(-1);
  assert.ok(artifact);
  const content = artifact.content as { project?: { projectName?: string; customerName?: string; industry?: string } };
  assert.equal(content.project?.projectName, "待补充");
  assert.equal(content.project?.customerName, "待补充");
  assert.equal(content.project?.industry, "待补充");
});

test("harness.usecase: submit parse result denies non-owner", async () => {
  const repo = makeMemoryHarnessRepo();
  const owner = activeHarnessUser();
  const other = { ...owner, id: "u-2", username: "other" };
  const created = await createHarnessRun(owner, { title: "私有解析" }, repo);
  const bindResult = await bindHarnessFile(owner, created.harnessRunId, {
    attachmentId: "att-parse-2",
    fileName: "私有文件.xlsx",
  }, repo);

  assert.ok(bindResult);

  const result = await submitHarnessParseResult(other, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "私有文件.xlsx",
    summary: { projectName: "P1" },
  }, repo);

  assert.equal(result, null);
});

test("harness.usecase: submit parse result rejects runs before parsing", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "阶段错误" }, repo);

  await assert.rejects(() => submitHarnessParseResult(user, created.harnessRunId, {
    sourceFile: "未开始解析.xlsx",
    summary: { projectName: "P1" },
  }, repo), /invalid_stage_for_parse_result/);
});

test("harness.usecase: run detail returns files evidences artifacts model runs and tool events", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "明细聚合" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-detail-1",
    fileName: "明细文件.xlsx",
  }, repo);

  assert.ok(bindResult);

  await repo.addToolEvent({
    harnessRunId: created.harnessRunId,
    actionId: "evt-1",
    toolName: "parse_excel",
    eventType: "started",
    status: "completed",
    riskLevel: "low",
    input: { sourceFile: "明细文件.xlsx" },
    output: { rows: 2 },
    errorMessage: null,
    resolvedAt: new Date(),
  });
  await repo.addModelRun({
    harnessRunId: created.harnessRunId,
    toolEventId: null,
    provider: "mock",
    model: "mock-parser",
    mode: "cached",
    promptProfileId: null,
    promptVersion: null,
    evidenceIds: [],
    inputTokenEstimate: null,
    outputTokenEstimate: null,
    rawContentHash: null,
    rawContentSummary: "cached parse",
    elapsedMs: 12,
    fallbackReason: null,
    schemaValidationErrors: [],
  });

  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "明细文件.xlsx",
    sheets: ["S1"],
    summary: {
      projectName: "待补充",
    },
    items: [{ text: "条目一" }],
  }, repo);

  const detail = await getHarnessRunDetail(user, created.harnessRunId, repo);

  assert.ok(detail);
  assert.equal(detail.files.length, 1);
  assert.equal(detail.evidences.length, 2);
  assert.equal(detail.artifacts.length, 1);
  assert.equal(detail.modelRuns.length, 1);
  assert.equal(detail.toolEvents.length, 1);
});

test("harness.usecase: generates report v1 through model runner and persists trace", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "模型报告" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-model-1",
    fileName: "模型文件.xlsx",
  }, repo);

  assert.ok(bindResult);

  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "模型文件.xlsx",
    sheets: ["3.业务需求及问题一览表"],
    summary: { projectName: "哈希温控项目评估", customerName: "哈希温控", industry: "制造业" },
    items: [{ sourceSheet: "3.业务需求及问题一览表", sourceCell: "B12", category: "财务核算", text: "自动生成凭证" }],
  }, repo);

  let called = 0;
  const detail = await generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async (input) => {
    called += 1;
    assert.equal(input.responseFormat, "json_object");
    assert.match(input.userPrompt, /自动生成凭证/);
    return {
      provider: "kimi",
      model: "moonshot-v1-128k",
      content: JSON.stringify({
        version: "v1",
        sourceFile: "模型文件.xlsx",
        project: { projectName: "哈希温控项目评估", customerName: "哈希温控", industry: "制造业" },
        sourceSheets: ["3.业务需求及问题一览表"],
        requirementFindings: [{
          domain: "财务核算",
          scenario: "自动生成凭证",
          moduleHint: "总账",
          confidence: 0.82,
          evidenceRefs: ["3.业务需求及问题一览表!B12"],
        }],
        missingFields: [{ field: "自动凭证规则数量", reason: "文件未明确规则规模", priority: "must" }],
        clarificationQuestions: [{ question: "自动凭证规则预计多少条？", targetRole: "财务关键用户", reason: "影响实施配置和测试工作量" }],
        risks: [{ title: "规则复杂度风险", assumption: "自动凭证规则未锁定", impact: "可能增加配置和测试人天" }],
        nextActions: [{ label: "补充项目信息", actionType: "supplement_project_info" }],
      }),
      rawContent: "raw-json",
      attempts: 1,
    };
  });

  assert.ok(detail);
  assert.equal(called, 1);
  assert.equal(detail.run.stage, "report_v1_ready");
  assert.equal(detail.run.status, "waiting");
  assert.equal(detail.modelRuns.length, 1);
  assert.equal(detail.modelRuns[0].provider, "kimi");
  assert.equal(detail.modelRuns[0].mode, "model");
  assert.deepEqual(detail.modelRuns[0].schemaValidationErrors, []);
  const reportArtifact = detail.artifacts.find((artifact) => artifact.artifactType === "requirement_report_v1");
  assert.ok(reportArtifact);
  assert.equal(reportArtifact.modelRunId, detail.modelRuns[0].harnessModelRunId);
  assert.equal((reportArtifact.content as any).requirementFindings[0].domain, "财务核算");
});

test("harness.usecase: report v1 retries invalid json and marks schema failure", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "坏 JSON" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-bad-json",
    fileName: "坏JSON.xlsx",
  }, repo);

  assert.ok(bindResult);
  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "坏JSON.xlsx",
    items: [{ text: "需求文本" }],
  }, repo);

  let called = 0;
  await assert.rejects(() => generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => {
    called += 1;
    return {
      provider: "kimi",
      model: "moonshot-v1-128k",
      content: called === 1 ? "not-json" : JSON.stringify({ version: "v1", sourceFile: "坏JSON.xlsx" }),
      rawContent: "bad",
    };
  }), /invalid_model_report_schema/);

  assert.equal(called, 2);
  const updated = await getHarnessRun(user, created.harnessRunId, repo);
  assert.ok(updated);
  assert.equal(updated.stage, "failed_schema_validation");
  assert.equal(updated.status, "failed");
  const detail = await getHarnessRunDetail(user, created.harnessRunId, repo);
  assert.ok(detail);
  assert.equal(detail.modelRuns.length, 1);
  assert.deepEqual(detail.modelRuns[0].schemaValidationErrors, ["invalid_model_report_schema"]);
});

test("harness.usecase: report v1 accepts empty optional analysis arrays", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "空数组报告" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-empty-arrays",
    fileName: "空数组.xlsx",
  }, repo);

  assert.ok(bindResult);
  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "空数组.xlsx",
    summary: { projectName: "空数组项目", customerName: "待补充", industry: "待补充" },
    items: [{ text: "只有基础信息，暂无可识别需求" }],
  }, repo);

  const detail = await generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({
      version: "v1",
      sourceFile: "空数组.xlsx",
      project: { projectName: "空数组项目", customerName: "待补充", industry: "待补充" },
      sourceSheets: [],
      requirementFindings: [],
      missingFields: [],
      clarificationQuestions: [],
      risks: [],
      nextActions: [],
    }),
  }));

  assert.ok(detail);
  assert.equal(detail.run.stage, "report_v1_ready");
  const artifact = detail.artifacts.find((item) => item.artifactType === "requirement_report_v1");
  assert.ok(artifact);
  assert.deepEqual((artifact.content as any).requirementFindings, []);
});

test("harness.usecase: report v1 rejects runs before evidence is ready", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "过早报告" }, repo);

  await assert.rejects(() => generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: "{}",
  })), /invalid_stage_for_report_v1/);
});

test("harness.usecase: parse result and report v1 cannot move later stages backwards", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "防倒退" }, repo);
  await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-no-regress",
    fileName: "防倒退.xlsx",
  }, repo);
  await submitHarnessParseResult(user, created.harnessRunId, {
    sourceFile: "防倒退.xlsx",
    items: [{ text: "需求文本" }],
  }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v1_ready", status: "waiting" });

  await assert.rejects(() => submitHarnessParseResult(user, created.harnessRunId, {
    sourceFile: "防倒退.xlsx",
    items: [{ text: "覆盖解析" }],
  }, repo), /invalid_stage_for_parse_result/);
  await assert.rejects(() => generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: "{}",
  })), /invalid_stage_for_report_v1/);
  await assert.rejects(() => bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-late-bind",
    fileName: "后续补文件.xlsx",
  }, repo), /invalid_stage_for_file_binding/);
});

test("harness.usecase: answers move run to clarifying", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "补充字段" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v1_ready", status: "waiting" });
  const result = await submitHarnessAnswers(user, created.harnessRunId, {
    answers: [{ field: "customerName", value: "哈希温控", source: "structured_form" }],
  }, repo);

  assert.ok(result);
  assert.equal(result.stage, "clarifying");
  assert.deepEqual((result.metadata as any).answers[0].field, "customerName");
});

test("harness.usecase: answers are rejected before report v1", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "过早补充" }, repo);
  await assert.rejects(() => submitHarnessAnswers(user, created.harnessRunId, {
    answers: [{ field: "customerName", value: "哈希温控", source: "structured_form" }],
  }, repo), /invalid_stage_for_answers/);
});

test("harness.usecase: confirming action records a tool event", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "确认动作" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  const result = await confirmHarnessAction(user, created.harnessRunId, "act-1", { confirmed: true, actionType: "create_project_evaluation" }, repo);

  assert.ok(result);
  assert.equal(result.run.stage, "project_link_pending");
  assert.equal(result.event.actionId, "act-1");
  assert.equal(result.event.status, "confirmed");
  assert.equal(result.event.toolName, "create_project_evaluation");
});

test("harness.usecase: action confirmation is rejected from terminal stages", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "终态确认" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "failed_schema_validation", status: "failed" });

  await assert.rejects(() => confirmHarnessAction(user, created.harnessRunId, "act-terminal", {
    confirmed: false,
    actionType: "create_project_evaluation",
  }, repo), /invalid_stage_for_action_confirmation/);
});

test("harness.usecase: cancelling action records event and keeps stage", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "取消动作" }, repo);
  const result = await confirmHarnessAction(user, created.harnessRunId, "act-2", { confirmed: false, actionType: "create_project_evaluation" }, repo);

  assert.ok(result);
  assert.equal(result.run.stage, "uploaded");
  assert.equal(result.event.status, "cancelled");
});

test("harness.usecase: action type controls confirmed target stage", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "需求草稿" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  const result = await confirmHarnessAction(user, created.harnessRunId, "act-3", { confirmed: true, actionType: "create_requirement_draft" }, repo);

  assert.ok(result);
  assert.equal(result.run.stage, "requirement_draft_pending");
});

test("harness.usecase: confirmed project actions require report v2 ready", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "过早确认项目动作" }, repo);

  await assert.rejects(() => confirmHarnessAction(user, created.harnessRunId, "act-early", {
    confirmed: true,
    actionType: "create_project_evaluation",
  }, repo), /invalid_stage_for_action_confirmation/);

  assert.equal((await repo.listToolEvents(created.harnessRunId)).length, 0);
});

test("harness.usecase: repeated non-formal confirmation returns existing event", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "重复确认普通动作" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });

  const first = await confirmHarnessAction(user, created.harnessRunId, "act-repeat", {
    confirmed: true,
    actionType: "create_requirement_draft",
  }, repo);
  const second = await confirmHarnessAction(user, created.harnessRunId, "act-repeat", {
    confirmed: true,
    actionType: "create_requirement_draft",
  }, repo);

  assert.equal(first?.event.harnessToolEventId, second?.event.harnessToolEventId);
  assert.equal((await repo.listToolEvents(created.harnessRunId)).filter((event) => event.status === "confirmed").length, 1);
});

test("harness.usecase: entering formal estimation creates traceable project and assessment drafts", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "端到端草稿" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  await repo.addArtifact({
    harnessRunId: created.harnessRunId,
    artifactType: "requirement_report_v2",
    title: "需求解析报告 v2",
    version: "v2",
    status: "ready",
    content: {
      version: "v2",
      sourceFile: "需求.xlsx",
      project: { projectName: "蓝海制造项目", customerName: "蓝海制造", industry: "制造业" },
      sourceSheets: ["项目概况", "需求清单"],
      requirementFindings: [
        { domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] },
      ],
      missingFields: [],
      clarificationQuestions: [],
      answeredQuestions: [{ question: "实施范围", answer: "一期覆盖采购到入库", source: "user_chat" }],
      risks: [{ title: "接口风险", assumption: "存在外部 WMS 对接", impact: "需要评估接口工作量" }],
      nextActions: [{ label: "生成项目/评估草稿", actionType: "enter_formal_estimation" }],
      clarificationSummary: "用户已补充一期范围。",
    },
    evidenceIds: [],
    modelRunId: null,
  });

  const result = await confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, async ({ report }) => ({
    project: {
      projectId: "project-draft-1",
      projectName: report.project.projectName,
      customerName: report.project.customerName,
      industry: report.project.industry,
      currentStage: "assessment_draft",
      status: "draft",
      ownerUserId: user.id,
      ownerUsername: user.username,
      versionCode: "GL-08-002",
      participantUserIds: [],
      currentAssessmentVersionId: "assessment-draft-1",
      createdFromSessionId: undefined,
      sourceGlobalVersionRecordId: "project-draft-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    assessmentDraft: {
      recordId: "assessment-draft-1",
      versionCode: "IA-AI-DRAFT-001",
      status: "draft_from_ai",
    },
  }));

  assert.ok(result);
  assert.equal(result.run.stage, "ready_for_estimation");
  assert.equal(result.run.projectEvaluationId, "project-draft-1");
  assert.equal(result.run.requirementVersionId, null);
  assert.equal((result.run.metadata as any).links.assessmentVersionId, "assessment-draft-1");
  const output = result.event.output as any;
  assert.equal(output.project.projectId, "project-draft-1");
  assert.equal(output.assessmentDraft.status, "draft_from_ai");
});

test("harness.usecase: entering formal estimation is rejected outside report v2 ready", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "非法阶段草稿" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v1_ready", status: "waiting" });
  await addHarnessV2ReportArtifact(repo, created.harnessRunId);
  let writerCalls = 0;

  await assert.rejects(() => confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, async () => {
    writerCalls += 1;
    return makeDraftBundle(user);
  }), /invalid_stage_for_formal_estimation/);

  assert.equal(writerCalls, 0);
  assert.equal((await repo.listToolEvents(created.harnessRunId)).length, 0);
});

test("harness.usecase: entering formal estimation requires a v2 report artifact", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "缺少 v2" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  let writerCalls = 0;

  await assert.rejects(() => confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, async () => {
    writerCalls += 1;
    return makeDraftBundle(user);
  }), /v2_report_not_found/);

  assert.equal(writerCalls, 0);
  assert.equal((await repo.listToolEvents(created.harnessRunId)).length, 0);
});

test("harness.usecase: formal estimation rejects mismatched action id and type", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "动作不一致" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  await addHarnessV2ReportArtifact(repo, created.harnessRunId);
  let writerCalls = 0;

  await assert.rejects(() => confirmHarnessAction(user, created.harnessRunId, "act-1", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, async () => {
    writerCalls += 1;
    return makeDraftBundle(user);
  }), /actionId_type_mismatch/);

  assert.equal(writerCalls, 0);
  assert.equal((await repo.listToolEvents(created.harnessRunId)).length, 0);
});

test("project-evaluations: harness draft creation persists project and assessment in one atomic store commit", async () => {
  await withVersionsJsonIsolation(async () => {
    await withFileSnapshotRestoreAsync(versionsStorePath(), async () => {
    fs.writeFileSync(versionsStorePath(), JSON.stringify({ records: [] }, null, 2), "utf-8");
    const originalWriteFileSync = fs.writeFileSync;
    const originalRenameSync = fs.renameSync;
    let tempWrites = 0;
    let commits = 0;
    try {
      (fs as any).writeFileSync = function patchedWriteFileSync(file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) {
        if (String(file).startsWith(`${versionsStorePath()}.tmp-`)) tempWrites += 1;
        return originalWriteFileSync.call(fs, file, data as any, options as any);
      };
      (fs as any).renameSync = function patchedRenameSync(oldPath: fs.PathLike, newPath: fs.PathLike) {
        if (String(newPath) === versionsStorePath()) commits += 1;
        return originalRenameSync.call(fs, oldPath, newPath);
      };

      const result = await createProjectAndAssessmentDraftsFromHarness(activeHarnessUser(), {
        harnessRunId: "run-atomic",
        actionId: "enter_formal_estimation",
        aiSessionId: "session-atomic",
        report: {
          version: "v2",
          sourceFile: "需求.xlsx",
          project: { projectName: "原子写项目", customerName: "原子客户", industry: "制造业" },
          sourceSheets: ["需求清单"],
          requirementFindings: [{ domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] }],
          missingFields: [],
          clarificationQuestions: [],
          answeredQuestions: [],
          risks: [],
          nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
          clarificationSummary: "已确认。",
        },
      });

      assert.equal(tempWrites, 1);
      assert.equal(commits, 1);
      const records = (await loadVersionsStore()).records;
      assert.ok(records.some((record) => record.id === result.project.projectId && record.payload.createdFromHarnessRunId === "run-atomic"));
      assert.ok(records.some((record) => record.id === result.assessmentDraft.recordId && record.payload.harnessActionId === "enter_formal_estimation"));
    } finally {
      (fs as any).writeFileSync = originalWriteFileSync;
      (fs as any).renameSync = originalRenameSync;
    }
    });
  });
});

test("project-evaluations: harness draft creation is idempotent by run and action", async () => {
  await withVersionsJsonIsolation(async () => {
    await withFileSnapshotRestoreAsync(versionsStorePath(), async () => {
    fs.writeFileSync(versionsStorePath(), JSON.stringify({ records: [] }, null, 2), "utf-8");
    const user = activeHarnessUser();
    const input = {
      harnessRunId: "run-idempotent",
      actionId: "enter_formal_estimation",
      aiSessionId: "session-idempotent",
      report: {
        version: "v2",
        sourceFile: "需求.xlsx",
        project: { projectName: "幂等项目", customerName: "幂等客户", industry: "制造业" },
        sourceSheets: ["需求清单"],
        requirementFindings: [{ domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] }],
        missingFields: [],
        clarificationQuestions: [],
        answeredQuestions: [],
        risks: [],
        nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
        clarificationSummary: "已确认。",
      },
    } satisfies Parameters<typeof createProjectAndAssessmentDraftsFromHarness>[1];

    const first = await createProjectAndAssessmentDraftsFromHarness(user, input);
    const second = await createProjectAndAssessmentDraftsFromHarness(user, input);

    assert.equal(second.project.projectId, first.project.projectId);
    assert.equal(second.assessmentDraft.recordId, first.assessmentDraft.recordId);
    const records = (await loadVersionsStore()).records;
    assert.equal(records.filter((record) => record.payload?.createdFromHarnessRunId === "run-idempotent").length, 1);
    assert.equal(records.filter((record) => record.payload?.harnessRunId === "run-idempotent").length, 1);
    });
  });
});

test("project-evaluations: list and detail expose harness trace fields for ai drafts", async () => {
  await withVersionsJsonIsolation(async () => {
    await withFileSnapshotRestoreAsync(versionsStorePath(), async () => {
    fs.writeFileSync(versionsStorePath(), JSON.stringify({ records: [] }, null, 2), "utf-8");
    const user = activeHarnessUser();
    const result = await createProjectAndAssessmentDraftsFromHarness(user, {
      harnessRunId: "run-trace",
      actionId: "enter_formal_estimation",
      aiSessionId: "session-trace",
      report: {
        version: "v2",
        sourceFile: "需求.xlsx",
        project: { projectName: "追溯项目", customerName: "追溯客户", industry: "制造业" },
        sourceSheets: ["需求清单"],
        requirementFindings: [{ domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] }],
        missingFields: [],
        clarificationQuestions: [],
        answeredQuestions: [],
        risks: [],
        nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
        clarificationSummary: "已确认。",
      },
    });

    const list = await listProjectEvaluationsForUser(user);
    const fromList = list.find((item) => item.projectId === result.project.projectId);
    assert.ok(fromList, "ai draft project should appear in list");
    assert.equal(fromList?.createdFromHarnessRunId, "run-trace");
    assert.equal(fromList?.createdFromHarnessActionId, "enter_formal_estimation");
    assert.equal(fromList?.assessmentVersionCode, result.assessmentDraft.versionCode);

    const fromDetail = await getProjectEvaluationForUser(user, result.project.projectId);
    assert.ok(fromDetail, "ai draft project should be fetchable by detail");
    assert.equal(fromDetail?.createdFromHarnessRunId, "run-trace");
    assert.equal(fromDetail?.createdFromHarnessActionId, "enter_formal_estimation");
    assert.equal(fromDetail?.assessmentVersionCode, result.assessmentDraft.versionCode);

    const otherUser = {
      id: "other-user",
      username: "other",
      role: "user",
      status: "active",
      passwordHash: "",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      permissions: [],
    } as AuthUser;
    assert.equal((await getProjectEvaluationForUser(otherUser, result.project.projectId)), null, "non-owner should not access ai draft");
    });
  });
});

test("project-evaluations: manual confirmation of ai assessment draft writes back harness audit", async () => {
  await withVersionsJsonIsolation(async () => {
    await withFileSnapshotRestoreAsync(versionsStorePath(), async () => {
    fs.writeFileSync(versionsStorePath(), JSON.stringify({ records: [] }, null, 2), "utf-8");
    const repo = makeMemoryHarnessRepo();
    const user = activeHarnessUser();
    const run = await repo.createRun({
      ownerUserId: user.id,
      ownerUsername: user.username,
      mode: "interactive",
      stage: "ready_for_estimation",
      status: "waiting",
      title: "AI 草稿人工确认",
      aiSessionId: "session-manual-confirm",
      metadata: { links: { aiSessionId: "session-manual-confirm" } },
    });
    const draft = await createProjectAndAssessmentDraftsFromHarness(user, {
      harnessRunId: run.harnessRunId,
      actionId: "enter_formal_estimation",
      aiSessionId: "session-manual-confirm",
      report: {
        version: "v2",
        sourceFile: "需求.xlsx",
        project: { projectName: "人工确认项目", customerName: "确认客户", industry: "制造业" },
        sourceSheets: ["需求清单"],
        requirementFindings: [{ domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] }],
        missingFields: [],
        clarificationQuestions: [],
        answeredQuestions: [],
        risks: [],
        nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
        clarificationSummary: "已确认。",
      },
    });

    const result = await confirmAiAssessmentDraftForUser(user, draft.assessmentDraft.recordId, { note: "人工审核通过" }, repo);

    assert.equal(result?.harness.status, "confirmed");
    assert.equal(result?.harness.runId, run.harnessRunId);
    assert.equal(result?.harness.actionId, "enter_formal_estimation");
    assert.equal(result?.assessmentDraft.manualConfirmation?.status, "confirmed");
    assert.equal(result?.assessmentDraft.manualConfirmation?.confirmedByUsername, user.username);

    const events = await repo.listToolEvents(run.harnessRunId);
    assert.equal(events.length, 1);
    assert.equal(events[0].toolName, "manual_confirm_ai_draft");
    assert.equal(events[0].eventType, "manual_confirmation");
    assert.equal(events[0].actionId, "enter_formal_estimation");
    assert.equal((events[0].output as { assessmentDraft?: { recordId?: string } })?.assessmentDraft?.recordId, draft.assessmentDraft.recordId);

    const store = await loadVersionsStore();
    const assessmentRecord = store.records.find((record) => record.id === draft.assessmentDraft.recordId);
    const projectRecord = store.records.find((record) => record.id === draft.project.projectId);
    assert.equal((assessmentRecord?.payload?.aiDraftReview as { status?: string } | undefined)?.status, "confirmed");
    assert.equal(projectRecord?.payload?.currentStage, "manual_confirmed");
    assert.equal(projectRecord?.payload?.projectStatus, "reviewing");
    assert.equal(projectRecord?.payload?.aiDraftReviewStatus, "confirmed");
    assert.equal((projectRecord?.payload?.aiDraftReview as { status?: string } | undefined)?.status, "confirmed");

    const updatedRun = await repo.findRunById(run.harnessRunId);
    assert.equal((updatedRun?.metadata as any)?.links?.projectEvaluationId, draft.project.projectId);
    assert.equal((updatedRun?.metadata as any)?.links?.assessmentVersionId, draft.assessmentDraft.recordId);
    assert.equal((updatedRun?.metadata as any)?.links?.assessmentVersionCode, draft.assessmentDraft.versionCode);
    assert.equal((updatedRun?.metadata as any)?.manualConfirmation?.status, "confirmed");
    assert.equal((updatedRun?.metadata as any)?.manualConfirmation?.harnessToolEventId, events[0].harnessToolEventId);

    const second = await confirmAiAssessmentDraftForUser(user, draft.assessmentDraft.recordId, { note: "重复点击" }, repo);
    assert.equal(second?.harness.toolEventId, result?.harness.toolEventId);
    assert.equal(second?.assessmentDraft.manualConfirmation?.note, "人工审核通过");
    assert.equal((await repo.listToolEvents(run.harnessRunId)).length, 1);
    });
  });
});

test("project-evaluations: concurrent manual confirmation creates one audit event", async () => {
  await withVersionsJsonIsolation(async () => {
    await withFileSnapshotRestoreAsync(versionsStorePath(), async () => {
    fs.writeFileSync(versionsStorePath(), JSON.stringify({ records: [] }, null, 2), "utf-8");
    const repo = makeMemoryHarnessRepo();
    const user = activeHarnessUser();
    const run = await repo.createRun({
      ownerUserId: user.id,
      ownerUsername: user.username,
      mode: "interactive",
      stage: "ready_for_estimation",
      status: "waiting",
      title: "AI 草稿并发人工确认",
      aiSessionId: "session-manual-confirm-concurrent",
      metadata: { links: { aiSessionId: "session-manual-confirm-concurrent" } },
    });
    const draft = await createProjectAndAssessmentDraftsFromHarness(user, {
      harnessRunId: run.harnessRunId,
      actionId: "enter_formal_estimation",
      aiSessionId: "session-manual-confirm-concurrent",
      report: {
        version: "v2",
        sourceFile: "需求.xlsx",
        project: { projectName: "并发确认项目", customerName: "确认客户", industry: "制造业" },
        sourceSheets: ["需求清单"],
        requirementFindings: [{ domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] }],
        missingFields: [],
        clarificationQuestions: [],
        answeredQuestions: [],
        risks: [],
        nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
        clarificationSummary: "已确认。",
      },
    });

    const [first, second] = await Promise.all([
      confirmAiAssessmentDraftForUser(user, draft.assessmentDraft.recordId, { note: "第一次确认" }, repo),
      confirmAiAssessmentDraftForUser(user, draft.assessmentDraft.recordId, { note: "第二次确认" }, repo),
    ]);

    assert.equal(first?.harness.toolEventId, second?.harness.toolEventId);
    const events = await repo.listToolEvents(run.harnessRunId);
    assert.equal(events.filter((event) => event.toolName === "manual_confirm_ai_draft").length, 1);
    const store = await loadVersionsStore();
    const assessmentRecord = store.records.find((record) => record.id === draft.assessmentDraft.recordId);
    assert.equal((assessmentRecord?.payload?.aiDraftReview as { note?: string } | undefined)?.note, "第一次确认");
    });
  });
});

test("harness.usecase: repeated formal estimation confirmation returns existing draft result", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "重复确认" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  await addHarnessV2ReportArtifact(repo, created.harnessRunId);
  let writerCalls = 0;
  const writer = async () => {
    writerCalls += 1;
    return makeDraftBundle(user);
  };

  const first = await confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, writer);
  const second = await confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, writer);

  assert.equal(writerCalls, 1);
  assert.equal(first?.event.harnessToolEventId, second?.event.harnessToolEventId);
  assert.equal((second?.event.output as any).project.projectId, "project-draft-1");
  assert.equal((await repo.listToolEvents(created.harnessRunId)).filter((event) => event.status === "confirmed").length, 1);
});

test("harness.usecase: concurrent formal estimation confirmation creates one draft", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "并发确认" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  await addHarnessV2ReportArtifact(repo, created.harnessRunId);
  let writerCalls = 0;
  const writer = async () => {
    writerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return makeDraftBundle(user);
  };

  const [first, second] = await Promise.all([
    confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
      confirmed: true,
      actionType: "enter_formal_estimation",
    }, repo, writer),
    confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
      confirmed: true,
      actionType: "enter_formal_estimation",
    }, repo, writer),
  ]);

  assert.equal(writerCalls, 1);
  assert.equal(first?.event.harnessToolEventId, second?.event.harnessToolEventId);
  assert.equal((await repo.listToolEvents(created.harnessRunId)).filter((event) => event.status === "confirmed").length, 1);
});

test("harness.usecase: formal estimation draft failures leave failed tool event", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "失败审计" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v2_ready", status: "waiting" });
  await addHarnessV2ReportArtifact(repo, created.harnessRunId);

  await assert.rejects(() => confirmHarnessAction(user, created.harnessRunId, "enter_formal_estimation", {
    confirmed: true,
    actionType: "enter_formal_estimation",
  }, repo, async () => {
    throw new Error("draft_write_failed");
  }), /draft_write_failed/);

  const events = await repo.listToolEvents(created.harnessRunId);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "failed");
  assert.equal(events[0].toolName, "enter_formal_estimation");
  assert.match(events[0].errorMessage || "", /draft_write_failed/);
});

test("harness.usecase: retry only works for failed runs", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "重试" }, repo);

  await assert.rejects(() => retryHarnessRun(user, created.harnessRunId, repo), /cannot_retry/);

  await repo.updateRun(created.harnessRunId, { stage: "failed", status: "failed", errorMessage: "timeout" });
  const retried = await retryHarnessRun(user, created.harnessRunId, repo);
  assert.equal(retried.stage, "evidence_ready");
  assert.equal(retried.status, "waiting");
  assert.equal(retried.errorMessage, null);
});

test("harness.usecase: reanalysis is rejected before evidence is ready", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "重新分析" }, repo);
  await assert.rejects(() => reanalyzeHarnessRun(user, created.harnessRunId, repo), /invalid_stage_for_reanalyze/);
});

test("harness.usecase: reanalysis sets force flag and analyzing stage", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "重新分析" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v1_ready", status: "waiting" });
  const result = await reanalyzeHarnessRun(user, created.harnessRunId, repo);
  assert.ok(result);
  assert.equal(result.forceReanalysis, true);
  assert.equal(result.stage, "analyzing");
});

test("harness.usecase: report v2 requires a v1 report artifact", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "无 v1 报告" }, repo);
  await repo.updateRun(created.harnessRunId, {
    stage: "clarifying",
    status: "waiting",
    metadata: { answers: [{ field: "supplement", value: "补充信息", source: "user_chat" }] },
  });

  await assert.rejects(() => generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({ version: "v2", sourceFile: "x.xlsx", project: { projectName: "P", customerName: "C", industry: "I" }, clarificationSummary: "" }),
  })), /v1_report_not_found/);
});

test("harness.usecase: report v2 is rejected before report v1", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "过早 v2" }, repo);

  await assert.rejects(() => generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: "{}",
  })), /invalid_stage_for_report_v2/);
});

test("harness.usecase: report v2 requires clarifying answers after report v1", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "v2 必须补充" }, repo);
  await repo.updateRun(created.harnessRunId, { stage: "report_v1_ready", status: "waiting" });
  await repo.addArtifact({
    harnessRunId: created.harnessRunId,
    artifactType: "requirement_report_v1",
    title: "需求解析报告 v1",
    version: "v1",
    status: "ready",
    content: {
      version: "v1",
      sourceFile: "v2.xlsx",
      project: { projectName: "P", customerName: "C", industry: "I" },
      sourceSheets: [],
      requirementFindings: [],
      missingFields: [],
      clarificationQuestions: [],
      risks: [],
      nextActions: [],
    },
    evidenceIds: [],
    modelRunId: null,
  });

  await assert.rejects(() => generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({ version: "v2", sourceFile: "v2.xlsx", project: { projectName: "P", customerName: "C", industry: "I" } }),
  })), /invalid_stage_for_report_v2/);

  await repo.updateRun(created.harnessRunId, { stage: "clarifying", status: "waiting", metadata: { answers: [] } });
  await assert.rejects(() => generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({ version: "v2", sourceFile: "v2.xlsx", project: { projectName: "P", customerName: "C", industry: "I" } }),
  })), /missing_harness_answers/);
});

test("harness.usecase: generates report v2 from v1 + answers", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "v2 闭环" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, {
    attachmentId: "att-v2-1",
    fileName: "v2评估.xlsx",
  }, repo);
  assert.ok(bindResult);

  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "v2评估.xlsx",
    sheets: ["基础信息"],
    summary: { projectName: "星河项目", customerName: "星河科技", industry: "制造业" },
    items: [{ sourceSheet: "基础信息", sourceCell: "B2", category: "业务需求", text: "优化采购流程" }],
  }, repo);

  await generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({
      version: "v1",
      sourceFile: "v2评估.xlsx",
      project: { projectName: "星河项目", customerName: "星河科技", industry: "制造业" },
      sourceSheets: ["基础信息"],
      requirementFindings: [{ domain: "采购", scenario: "优化采购流程", moduleHint: "供应链云", confidence: 0.8, evidenceRefs: ["基础信息!B2"] }],
      missingFields: [{ field: "实施组织范围", reason: "未说明", priority: "must" }],
      clarificationQuestions: [{ question: "实施组织范围包含几个法人？", targetRole: "客户项目负责人", reason: "影响边界" }],
      risks: [{ title: "范围风险", assumption: "组织范围未锁定", impact: "可能增加人天" }],
      nextActions: [{ label: "补充项目信息", actionType: "supplement_project_info" }],
    }),
  }));

  await submitHarnessAnswers(user, created.harnessRunId, {
    answers: [{ field: "实施组织范围", value: "3 个法人", source: "user_chat" }],
  }, repo);

  let called = 0;
  const detail = await generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async (input) => {
    called += 1;
    assert.match(input.userPrompt, /星河项目/);
    assert.match(input.userPrompt, /3 个法人/);
    return {
      provider: "kimi",
      model: "moonshot-v1-128k",
      content: JSON.stringify({
        version: "v2",
        sourceFile: "v2评估.xlsx",
        project: { projectName: "星河项目", customerName: "星河科技", industry: "制造业" },
        sourceSheets: ["基础信息"],
        requirementFindings: [{ domain: "采购", scenario: "优化采购流程", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["基础信息!B2"] }],
        missingFields: [],
        clarificationQuestions: [],
        answeredQuestions: [{ question: "实施组织范围包含几个法人？", answer: "3 个法人", source: "user_chat" }],
        risks: [{ title: "范围风险", assumption: "组织范围已锁定为 3 个法人", impact: "可控" }],
        nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
        clarificationSummary: "用户已补充实施组织范围为 3 个法人，v2 移除对应缺失项。",
      }),
    };
  });

  assert.ok(detail);
  assert.equal(called, 1);
  assert.equal(detail.run.stage, "report_v2_ready");
  assert.equal(detail.run.promptProfileId, "harness.requirement_report_v2.default");
  const v2Artifact = detail.artifacts.find((artifact) => artifact.artifactType === "requirement_report_v2");
  assert.ok(v2Artifact);
  const v2Content = v2Artifact.content as any;
  assert.equal(v2Content.version, "v2");
  assert.equal(v2Content.nextActions[0].actionType, "enter_formal_estimation");
  assert.equal(v2Content.answeredQuestions[0].answer, "3 个法人");
});

test("harness.usecase: report v2 accepts empty arrays and derives answeredQuestions from metadata", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "空数组 v2" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, { attachmentId: "att-empty-v2", fileName: "空.xlsx" }, repo);
  assert.ok(bindResult);

  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "空.xlsx",
    items: [{ text: "需求" }],
  }, repo);

  await generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({
      version: "v1",
      sourceFile: "空.xlsx",
      project: { projectName: "空项目", customerName: "待补充", industry: "待补充" },
      sourceSheets: [],
      requirementFindings: [],
      missingFields: [],
      clarificationQuestions: [],
      risks: [],
      nextActions: [],
    }),
  }));

  await submitHarnessAnswers(user, created.harnessRunId, { answers: [{ field: "customerName", value: "哈希温控", source: "structured_form" }] }, repo);

  const detail = await generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({
      version: "v2",
      sourceFile: "空.xlsx",
      project: { projectName: "空项目", customerName: "哈希温控", industry: "待补充" },
      sourceSheets: [],
      requirementFindings: [],
      missingFields: [],
      clarificationQuestions: [],
      answeredQuestions: [],
      risks: [],
      nextActions: [],
      clarificationSummary: "",
    }),
  }));

  assert.ok(detail);
  const v2Artifact = detail.artifacts.find((artifact) => artifact.artifactType === "requirement_report_v2");
  assert.ok(v2Artifact);
  assert.deepEqual((v2Artifact.content as any).answeredQuestions, [{ question: "customerName", answer: "哈希温控", source: "structured_form" }]);
});

test("harness.usecase: report v2 retries invalid json and marks schema failure", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "v2 坏 JSON" }, repo);
  const bindResult = await bindHarnessFile(user, created.harnessRunId, { attachmentId: "att-v2-bad", fileName: "坏.xlsx" }, repo);
  assert.ok(bindResult);

  await submitHarnessParseResult(user, created.harnessRunId, {
    fileId: bindResult.file.harnessFileId,
    sourceFile: "坏.xlsx",
    items: [{ text: "需求" }],
  }, repo);

  await generateHarnessRequirementReportV1(user, created.harnessRunId, {}, repo, async () => ({
    provider: "kimi",
    model: "moonshot-v1-128k",
    content: JSON.stringify({
      version: "v1",
      sourceFile: "坏.xlsx",
      project: { projectName: "坏项目", customerName: "待补充", industry: "待补充" },
      sourceSheets: [],
      requirementFindings: [],
      missingFields: [],
      clarificationQuestions: [],
      risks: [],
      nextActions: [],
    }),
  }));

  await submitHarnessAnswers(user, created.harnessRunId, { answers: [{ field: "customerName", value: "C", source: "user_chat" }] }, repo);

  let called = 0;
  await assert.rejects(() => generateHarnessRequirementReportV2(user, created.harnessRunId, {}, repo, async () => {
    called += 1;
    return {
      provider: "kimi",
      model: "moonshot-v1-128k",
      content: called === 1 ? "not-json" : JSON.stringify({ version: "v2", sourceFile: "坏.xlsx" }),
    };
  }), /invalid_model_report_schema/);

  assert.equal(called, 2);
  const updated = await getHarnessRun(user, created.harnessRunId, repo);
  assert.ok(updated);
  assert.equal(updated.stage, "failed_schema_validation");
});
