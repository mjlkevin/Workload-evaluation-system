import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response } from "express";
import supertest from "supertest";

import { createProjectEvaluationsRouter } from "./project-evaluations.routes";
import { signAuthToken } from "../middleware/auth";
import { cleanupTestUsers, createTestUser } from "../test-helpers/test-users";
import type { AuthUser } from "../types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// 竞态隔离（S1 后形态）：阶段 2 S1（2026-08-25）users 域已切 PG，原 chdir
// 沙箱（isolate-config-root.ts）退役；临时用户注入 PG 测试用户池，after 按
// 前缀条件 DELETE（C5 数据集隔离）。无 DB 时用例整体 skip，钩子不得抛错。
after(async () => {
  if (!testDatabaseUrl) return;
  await cleanupTestUsers("wes-project-eval");
});

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
  return createTestUser("wes-project-eval", { role: "admin", ...overrides });
}

function createTokenForUser(user: AuthUser): string {
  return signAuthToken(user);
}

test("POST /project-evaluations/assessment-drafts/:assessmentId/confirm requires auth before handler", { skip: !testDatabaseUrl }, async () => {
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

test("POST /project-evaluations/assessment-drafts/:assessmentId/confirm requires estimates write capability", { skip: !testDatabaseUrl }, async () => {
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

test("POST /project-evaluations/assessment-drafts/:assessmentId/confirm reaches confirm handler for writers", { skip: !testDatabaseUrl }, async () => {
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

test("POST /project-evaluations lets legacy user create project evaluations", { skip: !testDatabaseUrl }, async () => {
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
