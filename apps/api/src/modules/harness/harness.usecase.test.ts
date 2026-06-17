import test from "node:test";
import assert from "node:assert/strict";

import {
  isHarnessRunStage,
  normalizeHarnessRunMode,
  canRetryHarnessStage,
  HARNESS_RUN_STAGES,
  expectedStatusForHarnessStage,
  isValidHarnessStageStatus,
  nextStageForConfirmedAction,
} from "./harness.types";

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

import type { HarnessRunRow, HarnessFileRow, HarnessArtifactRow, HarnessToolEventRow, HarnessModelRunRow } from "../../db/schema";
import type { AuthUser } from "../../types";
import {
  createHarnessRun,
  getHarnessRun,
  listHarnessRuns,
  bindHarnessFile,
  submitHarnessAnswers,
  confirmHarnessAction,
  retryHarnessRun,
  reanalyzeHarnessRun,
} from "./harness.usecase";

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

test("harness.repository: repository contract exposes create and list functions", () => {
  const repo: Pick<HarnessRepository, "createRun" | "listRunsForOwner"> = {
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
    }),
    listRunsForOwner: async () => [],
  };

  assert.equal(typeof repo.createRun, "function");
  assert.equal(typeof repo.listRunsForOwner, "function");
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

function makeMemoryHarnessRepo(): HarnessRepository {
  const runs: HarnessRunRow[] = [];
  const files: HarnessFileRow[] = [];
  const artifacts: HarnessArtifactRow[] = [];
  const toolEvents: HarnessToolEventRow[] = [];
  const modelRuns: HarnessModelRunRow[] = [];

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
      return files.filter((file) => file.harnessRunId === runId);
    },
    async addArtifact(input) {
      const now = new Date();
      const row = { ...input, harnessArtifactId: `artifact-${artifacts.length + 1}`, createdAt: now, updatedAt: now } as HarnessArtifactRow;
      artifacts.push(row);
      return row;
    },
    async listArtifacts(runId) {
      return artifacts.filter((artifact) => artifact.harnessRunId === runId);
    },
    async addToolEvent(input) {
      const row = { ...input, harnessToolEventId: `tool-${toolEvents.length + 1}`, createdAt: new Date() } as HarnessToolEventRow;
      toolEvents.push(row);
      return row;
    },
    async listToolEvents(runId) {
      return toolEvents.filter((event) => event.harnessRunId === runId);
    },
    async addModelRun(input) {
      const row = { ...input, harnessModelRunId: `model-${modelRuns.length + 1}`, createdAt: new Date() } as HarnessModelRunRow;
      modelRuns.push(row);
      return row;
    },
    async listModelRuns(runId) {
      return modelRuns.filter((run) => run.harnessRunId === runId);
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
  const result = await confirmHarnessAction(user, created.harnessRunId, "act-1", { confirmed: true, actionType: "create_project_evaluation" }, repo);

  assert.ok(result);
  assert.equal(result.run.stage, "project_link_pending");
  assert.equal(result.event.actionId, "act-1");
  assert.equal(result.event.status, "confirmed");
  assert.equal(result.event.toolName, "create_project_evaluation");
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
  const result = await confirmHarnessAction(user, created.harnessRunId, "act-3", { confirmed: true, actionType: "create_requirement_draft" }, repo);

  assert.ok(result);
  assert.equal(result.run.stage, "requirement_draft_pending");
});

test("harness.usecase: retry only works for failed runs", async () => {
  const repo = makeMemoryHarnessRepo();
  const user = activeHarnessUser();
  const created = await createHarnessRun(user, { title: "重试" }, repo);

  await assert.rejects(() => retryHarnessRun(user, created.harnessRunId, repo), /cannot_retry/);

  await repo.updateRun(created.harnessRunId, { stage: "failed", status: "failed", errorMessage: "timeout" });
  const retried = await retryHarnessRun(user, created.harnessRunId, repo);
  assert.equal(retried.stage, "analyzing");
  assert.equal(retried.status, "running");
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
  await repo.updateRun(created.harnessRunId, { stage: "evidence_ready", status: "waiting" });
  const result = await reanalyzeHarnessRun(user, created.harnessRunId, repo);
  assert.ok(result);
  assert.equal(result.forceReanalysis, true);
  assert.equal(result.stage, "analyzing");
});
