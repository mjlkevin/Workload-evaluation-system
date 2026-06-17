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
import type { HarnessRunRow } from "../db/schema";
import type { AuthUser } from "../types";

const USERS_JSON = path.resolve(__dirname, "../../../../config/auth/users.json");
let originalUsersJson = "";

before(() => {
  originalUsersJson = fs.readFileSync(USERS_JSON, "utf8");
});

after(() => {
  fs.writeFileSync(USERS_JSON, originalUsersJson);
});

function makeApp(repo: HarnessRepository) {
  const app = express();
  app.use(express.json());
  app.use("/harness", createHarnessRouter({ repo }));
  return app;
}

function makeRepo(): HarnessRepository {
  const runs: HarnessRunRow[] = [];
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
    async addFile(input) { return { ...input, harnessFileId: "file-1", createdAt: new Date() } as any; },
    async listFiles() { return []; },
    async addArtifact(input) { return { ...input, harnessArtifactId: "artifact-1", createdAt: new Date(), updatedAt: new Date() } as any; },
    async listArtifacts() { return []; },
    async addToolEvent(input) { return { ...input, harnessToolEventId: "tool-1", createdAt: new Date() } as any; },
    async listToolEvents() { return []; },
    async addModelRun(input) { return { ...input, harnessModelRunId: "model-1", createdAt: new Date() } as any; },
    async listModelRuns() { return []; },
  };
}

function createTempUser(overrides: Partial<AuthUser> = {}): AuthUser {
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

  const store = loadUsersStore();
  store.users.push(user);
  saveUsersStore(store);
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
  const token = createTokenForUser(createTempUser({ role: "admin" }));
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
  const token = createTokenForUser(createTempUser({ role: "admin" }));
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

test("write endpoints return 404 for non-owner runs", async () => {
  const ownerToken = createTokenForUser(createTempUser({ role: "admin" }));
  const otherToken = createTokenForUser(createTempUser({ role: "admin" }));
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
});

test("POST /harness/runs/:id/answers rejects invalid stage", async () => {
  const token = createTokenForUser(createTempUser({ role: "admin" }));
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
  const token = createTokenForUser(createTempUser({ role: "admin" }));
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

test("GET /harness/runs/:id/events reserves SSE contract", async () => {
  const token = createTokenForUser(createTempUser({ role: "admin" }));
  const repo = makeRepo();
  const app = makeApp(repo);
  await request(app).post("/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "事件" });

  const res = await request(app).get("/harness/runs/run-1/events").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 501);
  assert.equal(res.body.code, 50101);
});
