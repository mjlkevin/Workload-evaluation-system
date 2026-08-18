import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";

import { createHarnessRouter } from "./harness.routes";
import { signAuthToken, loadUsersStore, saveUsersStore } from "../middleware/auth";
import type { HarnessRepository } from "../modules/harness/harness.repository";
import type { HarnessFormalEstimationDraftWriter, HarnessModelRunner } from "../modules/harness/harness.usecase";
import type {
  HarnessArtifactRow,
  HarnessEvidenceRow,
  HarnessFileRow,
  HarnessModelRunRow,
  HarnessRunRow,
  HarnessToolEventRow,
} from "../db/schema";
import type { AuthUser } from "../types";

const USERS_JSON = path.resolve(__dirname, "../../../../config/auth/users.json");
let originalUsersJson = "";

before(() => {
  originalUsersJson = fs.readFileSync(USERS_JSON, "utf8");
});

after(() => {
  fs.writeFileSync(USERS_JSON, originalUsersJson);
});

function makeApp(repo: HarnessRepository, extra: { modelRunner?: HarnessModelRunner; formalEstimationDraftWriter?: HarnessFormalEstimationDraftWriter } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/harness", createHarnessRouter({ repo, ...extra }));
  return app;
}

function makeRepo(): HarnessRepository {
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
      const row = {
        harnessRunId: "run-1",
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
      runs.push(row);
      return row;
    },
    async findRunById(id) { return runs.find((run) => run.harnessRunId === id) ?? null; },
    async listRunsForOwner(ownerUserId) { return runs.filter((run) => run.ownerUserId === ownerUserId); },
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
    async listFiles(runId) { return byCreatedAtAsc(files.filter((file) => file.harnessRunId === runId)); },
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
    async listEvidences(runId) { return byCreatedAtAsc(evidences.filter((evidence) => evidence.harnessRunId === runId)); },
    async addArtifact(input) {
      const now = new Date();
      const row = { ...input, harnessArtifactId: `artifact-${artifacts.length + 1}`, createdAt: now, updatedAt: now } as HarnessArtifactRow;
      artifacts.push(row);
      return row;
    },
    async listArtifacts(runId) { return byCreatedAtAsc(artifacts.filter((artifact) => artifact.harnessRunId === runId)); },
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
    async listToolEvents(runId) { return byCreatedAtAsc(toolEvents.filter((event) => event.harnessRunId === runId)); },
    async addModelRun(input) {
      const row = { ...input, harnessModelRunId: `model-${modelRuns.length + 1}`, createdAt: new Date() } as HarnessModelRunRow;
      modelRuns.push(row);
      return row;
    },
    async listModelRuns(runId) { return byCreatedAtAsc(modelRuns.filter((run) => run.harnessRunId === runId)); },
    async createManualTestResult() { throw new Error("not_implemented"); },
    async getManualTestResult() { return null; },
    async listManualTestResults() { return []; },
    async updateManualTestResult() { return null; },
    async deleteManualTestResult() { return false; },
  };
}

async function createTempUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
  const now = new Date().toISOString();
  const uniqueId = randomUUID();
  const user: AuthUser = {
    id: `harness-test-user-${uniqueId}`,
    username: `harness-test-${uniqueId}`,
    role: overrides.role || "admin",
    status: "active",
    passwordHash: "",
    createdAt: now,
    lastLoginAt: now,
    ...overrides,
  };

  const store = await loadUsersStore();
  store.users.push(user);
  await saveUsersStore(store);
  return user;
}

function createTokenForUser(user: AuthUser): string {
  return signAuthToken(user);
}

test("POST /harness/runs requires auth", async () => {
  const app = makeApp(makeRepo());
  const res = await request(app).post("/harness/runs").send({ title: "未登录" });
  assert.equal(res.status, 401);
});

test("POST /harness/runs creates a run", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const app = makeApp(makeRepo());
  const res = await request(app)
    .post("/harness/runs")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "哈希温控评估", mode: "interactive" });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.run.title, "哈希温控评估");
  assert.equal(res.body.data.run.stage, "uploaded");
});

test("POST /harness/runs/:id/files binds a file and moves run to parsing", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "文件" });

  const res = await request(app)
    .post("/harness/runs/run-1/files")
    .set("Authorization", `Bearer ${token}`)
    .send({ attachmentId: "att-1", fileName: "申请.xlsx", fileSize: 100 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.run.stage, "parsing");
  assert.equal(res.body.data.file.fileName, "申请.xlsx");
});

test("POST /harness/runs/:id/parse-result stores evidence and returns detail", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "解析" });
  const fileRes = await request(app)
    .post("/harness/runs/run-1/files")
    .set("Authorization", `Bearer ${token}`)
    .send({ attachmentId: "att-parse", fileName: "申请.xlsx", fileSize: 100 });

  const res = await request(app)
    .post("/harness/runs/run-1/parse-result")
    .set("Authorization", `Bearer ${token}`)
    .send({
      fileId: fileRes.body.data.file.harnessFileId,
      sourceFile: "申请.xlsx",
      sheets: ["3.业务需求及问题一览表"],
      items: [{ sourceSheet: "3.业务需求及问题一览表", sourceCell: "B12", text: "自动生成凭证", category: "财务核算" }],
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.run.stage, "evidence_ready");
  assert.equal(res.body.data.evidences.length, 2);
  assert.equal(res.body.data.artifacts[0].artifactType, "file_understanding");
});

test("POST /harness/runs/:id/report-v1 generates model-backed report", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo, {
    modelRunner: async () => ({
      provider: "kimi",
      model: "moonshot-v1-128k",
      content: JSON.stringify({
        version: "v1",
        sourceFile: "申请.xlsx",
        project: { projectName: "哈希温控项目评估", customerName: "哈希温控", industry: "制造业" },
        sourceSheets: ["3.业务需求及问题一览表"],
        requirementFindings: [{ domain: "财务核算", scenario: "自动生成凭证", moduleHint: "总账", confidence: 0.8, evidenceRefs: ["3.业务需求及问题一览表!B12"] }],
        missingFields: [{ field: "规则数量", reason: "文件未明确", priority: "must" }],
        clarificationQuestions: [{ question: "自动凭证规则多少条？", targetRole: "财务关键用户", reason: "影响评估" }],
        risks: [{ title: "规则风险", assumption: "规则未锁定", impact: "可能增加人天" }],
        nextActions: [{ label: "补充项目信息", actionType: "supplement_project_info" }],
      }),
    }),
  });
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "报告" });
  const fileRes = await request(app).post("/harness/runs/run-1/files").set("Authorization", `Bearer ${token}`).send({ attachmentId: "att-report", fileName: "申请.xlsx" });
  await request(app)
    .post("/harness/runs/run-1/parse-result")
    .set("Authorization", `Bearer ${token}`)
    .send({
      fileId: fileRes.body.data.file.harnessFileId,
      sourceFile: "申请.xlsx",
      items: [{ sourceSheet: "3.业务需求及问题一览表", sourceCell: "B12", text: "自动生成凭证" }],
    });

  const res = await request(app).post("/harness/runs/run-1/report-v1").set("Authorization", `Bearer ${token}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.data.run.stage, "report_v1_ready");
  assert.equal(res.body.data.modelRuns.length, 1);
  assert.equal(res.body.data.artifacts.at(-1).artifactType, "requirement_report_v1");
});

test("POST /harness/runs/:id/report-v1 maps kimi rate limit to 429", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo, {
    modelRunner: async () => {
      throw new Error("kimi_rate_limited");
    },
  });
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "报告" });
  const fileRes = await request(app).post("/harness/runs/run-1/files").set("Authorization", `Bearer ${token}`).send({ attachmentId: "att-report", fileName: "申请.xlsx" });
  await request(app)
    .post("/harness/runs/run-1/parse-result")
    .set("Authorization", `Bearer ${token}`)
    .send({
      fileId: fileRes.body.data.file.harnessFileId,
      sourceFile: "申请.xlsx",
      items: [{ sourceSheet: "3.业务需求及问题一览表", sourceCell: "B12", text: "自动生成凭证" }],
    });

  const res = await request(app).post("/harness/runs/run-1/report-v1").set("Authorization", `Bearer ${token}`).send({});

  assert.equal(res.status, 429);
  assert.equal(res.body.code, 42901);
  assert.equal(res.body.details[0].reason, "kimi_rate_limited");
});

test("POST /harness/runs/:id/report-v2 generates v2 report from v1 artifact", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo, {
    modelRunner: async () => ({
      provider: "kimi",
      model: "moonshot-v1-128k",
      content: JSON.stringify({
        version: "v2",
        sourceFile: "申请.xlsx",
        project: { projectName: "哈希温控项目评估", customerName: "哈希温控", industry: "制造业" },
        sourceSheets: ["3.业务需求及问题一览表"],
        requirementFindings: [{ domain: "财务核算", scenario: "自动生成凭证", moduleHint: "总账", confidence: 0.9, evidenceRefs: ["3.业务需求及问题一览表!B12"] }],
        missingFields: [],
        clarificationQuestions: [],
        answeredQuestions: [{ question: "自动凭证规则数量", answer: "10 条", source: "user_chat" }],
        risks: [{ title: "规则风险", assumption: "规则已锁定", impact: "可控" }],
        nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
        clarificationSummary: "已补充规则数量。",
      }),
    }),
  });
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "报告" });
  await repo.updateRun("run-1", { stage: "report_v1_ready", status: "waiting" });
  await repo.addArtifact({
    harnessRunId: "run-1",
    artifactType: "requirement_report_v1",
    title: "需求解析报告 v1",
    version: "v1",
    status: "ready",
    content: {
      version: "v1",
      sourceFile: "申请.xlsx",
      project: { projectName: "哈希温控项目评估", customerName: "哈希温控", industry: "制造业" },
      sourceSheets: ["3.业务需求及问题一览表"],
      requirementFindings: [{ domain: "财务核算", scenario: "自动生成凭证", moduleHint: "总账", confidence: 0.8, evidenceRefs: ["3.业务需求及问题一览表!B12"] }],
      missingFields: [{ field: "自动凭证规则数量", reason: "文件未明确", priority: "must" }],
      clarificationQuestions: [{ question: "自动凭证规则多少条？", targetRole: "财务关键用户", reason: "影响评估" }],
      risks: [{ title: "规则风险", assumption: "规则未锁定", impact: "可能增加人天" }],
      nextActions: [{ label: "补充项目信息", actionType: "supplement_project_info" }],
    },
    evidenceIds: [],
    modelRunId: null,
  });
  await request(app)
    .post("/harness/runs/run-1/answers")
    .set("Authorization", `Bearer ${token}`)
    .send({ answers: [{ field: "自动凭证规则数量", value: "10 条", source: "user_chat" }] });

  const res = await request(app).post("/harness/runs/run-1/report-v2").set("Authorization", `Bearer ${token}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.data.run.stage, "report_v2_ready");
  assert.equal(res.body.data.artifacts.at(-1).artifactType, "requirement_report_v2");
  assert.equal(res.body.data.artifacts.at(-1).content.nextActions[0].actionType, "enter_formal_estimation");
});

test("POST /harness/runs/:id/report-v2 rejects invalid stage", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "v2 阶段错误" });

  const res = await request(app).post("/harness/runs/run-1/report-v2").set("Authorization", `Bearer ${token}`).send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 40001);
});

test("POST /harness/runs/:id/actions/:actionId/confirm creates project and assessment draft links", async () => {
  const user = await createTempUser({ role: "admin" });
  const token = createTokenForUser(user);
  const repo = makeRepo();
  const app = makeApp(repo, {
    formalEstimationDraftWriter: async ({ report }) => ({
      project: {
        projectId: "project-route-1",
        projectName: report.project.projectName,
        customerName: report.project.customerName,
        industry: report.project.industry,
        currentStage: "assessment_draft",
        status: "draft",
        ownerUserId: user.id,
        ownerUsername: user.username,
        versionCode: "GL-08-001",
        participantUserIds: [],
        currentAssessmentVersionId: "assessment-route-1",
        createdFromSessionId: undefined,
        sourceGlobalVersionRecordId: "project-route-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      assessmentDraft: {
        recordId: "assessment-route-1",
        versionCode: "IA-AI-DRAFT-ROUTE",
        status: "draft_from_ai",
      },
    }),
  });
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "正式评估草稿" });
  await repo.updateRun("run-1", { stage: "report_v2_ready", status: "waiting" });
  await repo.addArtifact({
    harnessRunId: "run-1",
    artifactType: "requirement_report_v2",
    title: "需求解析报告 v2",
    version: "v2",
    status: "ready",
    content: {
      version: "v2",
      sourceFile: "申请.xlsx",
      project: { projectName: "蓝海制造项目", customerName: "蓝海制造", industry: "制造业" },
      sourceSheets: ["需求清单"],
      requirementFindings: [{ domain: "供应链", scenario: "采购闭环", moduleHint: "供应链云", confidence: 0.9, evidenceRefs: ["需求清单!B12"] }],
      missingFields: [],
      clarificationQuestions: [],
      answeredQuestions: [{ question: "实施范围", answer: "一期", source: "user_chat" }],
      risks: [],
      nextActions: [{ label: "进入正式评估", actionType: "enter_formal_estimation" }],
      clarificationSummary: "已补充范围。",
    },
    evidenceIds: [],
    modelRunId: null,
  });

  const res = await request(app)
    .post("/harness/runs/run-1/actions/enter_formal_estimation/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({ confirmed: true, actionType: "enter_formal_estimation" });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.run.stage, "ready_for_estimation");
  assert.equal(res.body.data.run.projectEvaluationId, "project-route-1");
  assert.equal(res.body.data.run.metadata.links.assessmentVersionId, "assessment-route-1");
  assert.equal(res.body.data.event.output.project.projectId, "project-route-1");
  assert.equal(res.body.data.event.output.assessmentDraft.status, "draft_from_ai");
});

test("write endpoints return 404 for non-owner runs", async () => {
  const ownerToken = createTokenForUser(await createTempUser({ role: "admin" }));
  const otherToken = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${ownerToken}`).send({ title: "私有运行" });
  await repo.updateRun("run-1", { stage: "failed", status: "failed", errorMessage: "timeout" });

  const bindFile = await request(app)
    .post("/harness/runs/run-1/files")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ attachmentId: "att-1", fileName: "申请.xlsx" });
  assert.equal(bindFile.status, 404);

  const answers = await request(app)
    .post("/harness/runs/run-1/answers")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ answers: [{ field: "customerName", value: "哈希温控", source: "structured_form" }] });
  assert.equal(answers.status, 404);

  const confirm = await request(app)
    .post("/harness/runs/run-1/actions/action-1/confirm")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ confirmed: true, actionType: "create_project_evaluation" });
  assert.equal(confirm.status, 404);

  const retry = await request(app)
    .post("/harness/runs/run-1/retry")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({});
  assert.equal(retry.status, 404);

  const reanalyze = await request(app)
    .post("/harness/runs/run-1/reanalyze")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({});
  assert.equal(reanalyze.status, 404);

  const parseResult = await request(app)
    .post("/harness/runs/run-1/parse-result")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ sourceFile: "私有.xlsx" });
  assert.equal(parseResult.status, 404);

  const reportV1 = await request(app)
    .post("/harness/runs/run-1/report-v1")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({});
  assert.equal(reportV1.status, 404);

  const answersV2 = await request(app)
    .post("/harness/runs/run-1/answers")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({ answers: [{ field: "customerName", value: "C", source: "user_chat" }] });
  assert.equal(answersV2.status, 404);

  const reportV2 = await request(app)
    .post("/harness/runs/run-1/report-v2")
    .set("Authorization", `Bearer ${otherToken}`)
    .send({});
  assert.equal(reportV2.status, 404);
});

test("POST /harness/runs/:id/answers rejects invalid stage", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "补充" });

  const res = await request(app)
    .post("/harness/runs/run-1/answers")
    .set("Authorization", `Bearer ${token}`)
    .send({ answers: [{ field: "customerName", value: "哈希温控", source: "structured_form" }] });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 40001);
});

test("POST /harness/runs/:id/reanalyze rejects invalid stage", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "重分析" });

  const res = await request(app)
    .post("/harness/runs/run-1/reanalyze")
    .set("Authorization", `Bearer ${token}`)
    .send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 40001);
});

test("POST /harness/runs/:id/actions/:actionId/confirm maps terminal stage to 400", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "终态确认" });
  await repo.updateRun("run-1", { stage: "failed_schema_validation", status: "failed" });

  const res = await request(app)
    .post("/harness/runs/run-1/actions/action-1/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({ confirmed: true, actionType: "create_project_evaluation" });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 40001);
  assert.equal(res.body.details[0].reason, "invalid_stage_for_action_confirmation");
});

test("GET /harness/runs/:id/events returns SSE snapshot", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "事件" });

  const res = await request(app).get("/harness/runs/run-1/events").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/event-stream/);
  assert.match(res.text, /event: run_state/);
  assert.match(res.text, /"stage":"uploaded"/);
});

// ============================================================
// Manual Test Results Tests
// ============================================================

function makeRepoWithManualTestResults() {
  const baseRepo = makeRepo();
  const results: Array<{
    manualTestResultId: string;
    harnessRunId: string | null;
    harnessToolEventId: string | null;
    testCaseKey: string | null;
    executorName: string;
    environment: string;
    account: string | null;
    screenshotUrl: string | null;
    resultStatus: "passed" | "failed" | "blocked" | "skipped";
    notes: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  return {
    ...baseRepo,
    async createManualTestResult(input: any) {
      const now = new Date();
      const row = {
        manualTestResultId: `mtr-${results.length + 1}`,
        harnessRunId: input.harnessRunId ?? null,
        harnessToolEventId: input.harnessToolEventId ?? null,
        testCaseKey: input.testCaseKey ?? null,
        executorName: input.executorName,
        environment: input.environment,
        account: input.account ?? null,
        screenshotUrl: input.screenshotUrl ?? null,
        resultStatus: input.resultStatus as "passed" | "failed" | "blocked" | "skipped",
        notes: input.notes ?? null,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      results.push(row);
      return row;
    },
    async getManualTestResult(id: string) {
      return results.find((r) => r.manualTestResultId === id) ?? null;
    },
    async listManualTestResults(runId: string | null, opts?: { status?: string; limit?: number; offset?: number }) {
      let items = results;
      if (runId) items = items.filter((r) => r.harnessRunId === runId);
      if (opts?.status) items = items.filter((r) => r.resultStatus === opts.status);
      return items;
    },
    async updateManualTestResult(id: string, patch: any) {
      const idx = results.findIndex((r) => r.manualTestResultId === id);
      if (idx < 0) return null;
      results[idx] = { ...results[idx], ...patch, updatedAt: new Date() };
      return results[idx];
    },
    async deleteManualTestResult(id: string) {
      const idx = results.findIndex((r) => r.manualTestResultId === id);
      if (idx < 0) return false;
      results.splice(idx, 1);
      return true;
    },
  };
}

test("POST /harness/runs/:runId/test-results creates a manual test result", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepoWithManualTestResults();
  const app = makeApp(repo);

  const res = await request(app)
    .post("/harness/runs/run-1/test-results")
    .set("Authorization", `Bearer ${token}`)
    .send({
      executorName: "张三",
      environment: "staging",
      account: "test-user-01",
      resultStatus: "passed",
      notes: "测试通过",
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.result.executorName, "张三");
  assert.equal(res.body.data.result.environment, "staging");
  assert.equal(res.body.data.result.resultStatus, "passed");
});

test("POST /harness/runs/:runId/test-results validates required fields", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepoWithManualTestResults();
  const app = makeApp(repo);

  const res = await request(app)
    .post("/harness/runs/run-1/test-results")
    .set("Authorization", `Bearer ${token}`)
    .send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 40001);
});

test("GET /harness/runs/:runId/test-results lists results", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepoWithManualTestResults();
  const app = makeApp(repo);

  await repo.createManualTestResult({
    harnessRunId: "run-1",
    executorName: "李四",
    environment: "local",
    resultStatus: "failed",
  });

  const res = await request(app)
    .get("/harness/runs/run-1/test-results")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 1);
  assert.equal(res.body.data.items[0].executorName, "李四");
});

test("PATCH /harness/runs/:runId/test-results/:resultId updates a result", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepoWithManualTestResults();
  const app = makeApp(repo);

  const created = await repo.createManualTestResult({
    harnessRunId: "run-1",
    executorName: "王五",
    environment: "local",
    resultStatus: "blocked",
  });

  const res = await request(app)
    .patch(`/harness/runs/run-1/test-results/${created.manualTestResultId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ resultStatus: "passed", notes: "已修复" });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.result.resultStatus, "passed");
  assert.equal(res.body.data.result.notes, "已修复");
});

test("DELETE /harness/runs/:runId/test-results/:resultId deletes a result", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const repo = makeRepoWithManualTestResults();
  const app = makeApp(repo);

  const created = await repo.createManualTestResult({
    harnessRunId: "run-1",
    executorName: "赵六",
    environment: "local",
    resultStatus: "skipped",
  });

  const res = await request(app)
    .delete(`/harness/runs/run-1/test-results/${created.manualTestResultId}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.deleted, true);
});
