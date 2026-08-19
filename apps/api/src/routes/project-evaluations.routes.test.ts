import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import supertest from "supertest";

import { createProjectEvaluationsRouter } from "./project-evaluations.routes";
import { loadUsersStore, saveUsersStore, signAuthToken } from "../middleware/auth";
import { enterIsolatedConfigRoot, exitIsolatedConfigRoot } from "../test-helpers/isolate-config-root";
import type { AuthUser } from "../types";

// 竞态隔离（main CI flake 修复）：原 before 备份 / after 恢复真实 users.json
// 的模式在多文件并行下会互相覆盖（整存 RMW 丢失更新），改为 chdir 隔离根；
// 详见 test-helpers/isolate-config-root.ts。
before(() => enterIsolatedConfigRoot("wes-project-evaluations-routes-"));
after(() => exitIsolatedConfigRoot());

function miniApp(confirmHandler: (req: Request, res: Response) => void) {
  const app = express();
  app.use(express.json());
  app.use("/project-evaluations", createProjectEvaluationsRouter({
    listProjectEvaluations: (_req, res) => res.json({ code: 0, data: { items: [] } }),
    createProjectEvaluation: (_req, res) => res.json({ code: 0, data: { project: {} } }),
    getProjectEvaluation: (_req, res) => res.json({ code: 0, data: { project: {} } }),
    confirmAiAssessmentDraft: confirmHandler,
  }));
  return app;
}

async function createTempUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
  const now = new Date().toISOString();
  const uniqueId = randomUUID();
  const user: AuthUser = {
    id: `project-eval-route-user-${uniqueId}`,
    username: `project-eval-route-${uniqueId}`,
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

test("POST /project-evaluations/assessment-drafts/:assessmentId/confirm requires auth before handler", async () => {
  let reached = false;
  const response = await supertest(miniApp((_req, res) => {
    reached = true;
    res.json({ code: 0 });
  }))
    .post("/project-evaluations/assessment-drafts/assessment-1/confirm")
    .send({ note: "confirm" });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 40101);
  assert.equal(reached, false);
});

test("POST /project-evaluations/assessment-drafts/:assessmentId/confirm requires estimates write capability", async () => {
  const token = createTokenForUser(await createTempUser({ role: "user" }));
  let reached = false;

  const response = await supertest(miniApp((_req, res) => {
    reached = true;
    res.json({ code: 0 });
  }))
    .post("/project-evaluations/assessment-drafts/assessment-1/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({ note: "confirm" });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 40301);
  assert.equal(response.body.details[0].required, "estimates:write");
  assert.equal(reached, false);
});

test("POST /project-evaluations/assessment-drafts/:assessmentId/confirm reaches confirm handler for writers", async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  let reachedAssessmentId = "";

  const response = await supertest(miniApp((req, res) => {
    const assessmentId = String(req.params.assessmentId);
    reachedAssessmentId = assessmentId;
    res.json({
      code: 0,
      message: "ok",
      data: {
        project: { projectId: "project-1" },
        assessmentDraft: { recordId: assessmentId },
        harness: { toolEventId: "tool-1" },
      },
    });
  }))
    .post("/project-evaluations/assessment-drafts/assessment-1/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({ note: "confirm" });

  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.equal(response.body.data.assessmentDraft.recordId, "assessment-1");
  assert.equal(response.body.data.harness.toolEventId, "tool-1");
  assert.equal(reachedAssessmentId, "assessment-1");
});

test("POST /project-evaluations lets legacy user create project evaluations", async () => {
  const token = createTokenForUser(await createTempUser({ role: "user" }));
  let reached = false;

  const response = await supertest(miniApp((_req, res) => {
    res.json({ code: 0 });
  }))
    .post("/project-evaluations")
    .set("Authorization", `Bearer ${token}`)
    .send({ projectName: "广州波达通信项目" });

  reached = response.status === 200;
  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.equal(reached, true);
});
