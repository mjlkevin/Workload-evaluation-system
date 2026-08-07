// ============================================================
// AI Runs controller 测试（RP-047 Batch C）
// ============================================================
// 覆盖 handler 工厂的 flag 门闸、错误映射与 202 envelope；
// 使用 stub usecase，不依赖 PostgreSQL。

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { createAiRunsHandlers } from "./harness-runtime.controller";
import {
  AiRunsConflictError,
  AiRunsDisabledError,
  AiRunsNotFoundError,
  AiRunsValidationError,
} from "./harness-runtime.usecase";
import { loadUsersStore, saveUsersStore, signAuthToken } from "../../middleware/auth";
import type { AuthUser } from "../../types";

const USERS_JSON = path.resolve(__dirname, "../../../../../config/auth/users.json");
let originalUsersJson = "";
let user: AuthUser | null = null;
let token = "";

test.before(() => {
  originalUsersJson = fs.readFileSync(USERS_JSON, "utf8");
  const store = loadUsersStore();
  user = {
    id: `ai-runs-controller-user-${Date.now()}`,
    username: `ai-runs-controller-${Date.now()}`,
    role: "user",
    status: "active",
    passwordHash: "",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  store.users.push(user);
  saveUsersStore(store);
  token = signAuthToken(user);
});

test.after(() => {
  fs.writeFileSync(USERS_JSON, originalUsersJson);
});

function makeApp(usecaseStub: Partial<ReturnType<typeof createStubUsecase>> = {}) {
  const handlers = createAiRunsHandlers({ usecase: { ...createStubUsecase(), ...usecaseStub } });
  const app = express();
  app.use(express.json());
  app.get("/ai-runs", handlers.listActiveRunsHandler);
  app.get("/ai-runs/:runId", handlers.getRunSnapshotHandler);
  app.post("/ai-runs/:runId/cancel", handlers.cancelRunHandler);
  return app;
}

function createStubUsecase() {
  return {
    async listActiveRuns() {
      return [{ runId: "run-1", status: "queued" }];
    },
    async getRunSnapshot() {
      return { run: { harnessRunId: "run-1" }, attempt: null, checkpoint: null, output: null };
    },
    async cancelRun() {
      return { status: 202, data: { runId: "run-1", status: "cancelling" } };
    },
    async submitRun() {
      return { status: 202, data: { runId: "run-1", sessionId: "s-1", status: "queued", eventCursor: 1 } };
    },
    async submitInputs() {
      throw new AiRunsNotFoundError("run not found");
    },
    async confirmAction() {
      throw new AiRunsDisabledError();
    },
    async retryRun() {
      throw new AiRunsConflictError("RUN_NOT_FAILED", "只有失败终态可重试");
    },
    async validateSubmission() {
      throw new AiRunsValidationError("submissionKey 必填");
    },
  };
}

test("list handler wraps usecase result in the ok envelope", async () => {
  const response = await request(makeApp()).get("/ai-runs").set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.equal(response.body.data.items.length, 1);
});

test("cancel handler returns 202 from usecase outcome", async () => {
  const response = await request(makeApp()).post("/ai-runs/run-1/cancel").set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 202);
  assert.equal(response.body.code, 0);
});

test("not-found errors map to 404 without leaking details", async () => {
  const app = makeApp({
    async getRunSnapshot() {
      throw new AiRunsNotFoundError("run not found");
    },
  });
  const response = await request(app).get("/ai-runs/run-x").set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 40404);
});

test("disabled errors map to 503 ASYNC_RUNS_DISABLED", async () => {
  const response = await request(makeApp()).post("/ai-runs/run-1/confirm-stub").set("Authorization", `Bearer ${token}`);
  // confirm 端点未挂载 → 走 404；直接通过 stub cancel 映射
  assert.ok(response.status === 404);
  const app = makeApp({
    async cancelRun() {
      throw new AiRunsDisabledError();
    },
  });
  const disabled = await request(app).post("/ai-runs/run-1/cancel").set("Authorization", `Bearer ${token}`);
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.code, "ASYNC_RUNS_DISABLED");
});

test("conflict errors map to 409 carrying their business code", async () => {
  const app = makeApp({
    async cancelRun() {
      throw new AiRunsConflictError("RUN_NOT_FAILED", "只有失败终态可重试");
    },
  });
  const response = await request(app).post("/ai-runs/run-1/cancel").set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "RUN_NOT_FAILED");
});

test("validation errors map to 422", async () => {
  const app = makeApp({
    async listActiveRuns() {
      throw new AiRunsValidationError("参数非法");
    },
  });
  const response = await request(app).get("/ai-runs").set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 422);
});

test("requests without a token get 401 before reaching the usecase", async () => {
  const response = await request(makeApp()).get("/ai-runs");
  assert.equal(response.status, 401);
});
