// ============================================================
// AI Runs 路由集成测试（RP-047 Batch C · Gate C）
// ============================================================
// 覆盖 Gate C 四条：API 契约与状态码矩阵（G1）、JWT + owner 安全（G2）、
// SSE 回放与断线不取消（G3）、feature flag 与旧路径保护（G4）。
// 依赖 Testcontainers PostgreSQL（TEST_DATABASE_URL）与真实双用户 PG 测试用户池
// 注入（wes-ai-runs-* 前缀，C5 数据集隔离；S1 后 users.json 注入路径已删）。
// ai-sessions 域仍处观察期（S2 才切 PG），其 JSON 快照备份/恢复逻辑保留。
// 缺失 DB 时整体 skip。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";

import { createAiRunsRouter } from "./ai-runs.routes";
import { createAiSessionsRouter } from "./ai-sessions.routes";
import systemRouter from "./system.routes";
import { createHarnessRuntimeRepository, type HarnessRuntimeRepository } from "../modules/harness/harness-runtime.repository";
import type { AiRunsUsecase } from "../modules/harness/harness-runtime.usecase";
import { appendAiSessionEvent, createAiSession, deleteAiSession } from "../modules/ai-sessions/ai-sessions.usecase";
import { signAuthToken } from "../middleware/auth";
import { cleanupTestUsers, createTestUser } from "../test-helpers/test-users";
import { aiSessions, harnessRunEvents, harnessRuns } from "../db/schema";
import type { AuthUser } from "../types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let testDb: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
let alice: AuthUser | null = null;
let bob: AuthUser | null = null;
let admin: AuthUser | null = null;
let aliceToken = "";
let bobToken = "";
let adminToken = "";
const createdRunIds: string[] = [];
const createdSessionIds: string[] = [];

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  testDb = drizzle(pool);
  repo = createHarnessRuntimeRepository(testDb);

  alice = await createTestUser("wes-ai-runs-alice", { role: "user" });
  bob = await createTestUser("wes-ai-runs-bob", { role: "user" });
  admin = await createTestUser("wes-ai-runs-admin", { role: "admin" });
  aliceToken = signAuthToken(alice);
  bobToken = signAuthToken(bob);
  adminToken = signAuthToken(admin);
});

after(async () => {
  if (testDb) {
    for (const runId of createdRunIds.splice(0)) {
      await testDb.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
    }
    // S2b-1（2026-08-27）：ai-sessions 随九开关走 PG，用例级会话按 sessionId 清理
    for (const sessionId of createdSessionIds.splice(0)) {
      await testDb.delete(aiSessions).where(eq(aiSessions.sessionId, sessionId));
    }
    await cleanupTestUsers("wes-ai-runs");
  }
  if (pool) await pool.end();
});

function track(runId: string): string {
  createdRunIds.push(runId);
  return runId;
}

function trackSession(sessionId: string): string {
  createdSessionIds.push(sessionId);
  return sessionId;
}

// claimNextQueuedRun 是 FIFO 全局捞取：循环消费前序测试遗留的 queued run，
// 直到命中目标 runId（遗留 run 仅被 claim 为 running，不改变其业务断言）。
async function claimRunById(runId: string) {
  for (let i = 0; i < 32; i += 1) {
    const claimed = await repo!.claimNextQueuedRun({ workerId: "gate-c-worker", leaseMs: 45_000 });
    assert.ok(claimed, `claim must succeed while hunting ${runId}`);
    if (claimed.run.harnessRunId === runId) return claimed;
  }
  throw new Error(`target run ${runId} never became claimable`);
}

function makeApp(opts: { enabled: boolean; sse?: { heartbeatMs?: number; pollMs?: number; batchLimit?: number } } = { enabled: true }) {
  const usecaseDeps = {
    repo: repo!,
    enabled: opts.enabled,
    heartbeatMs: opts.sse?.heartbeatMs,
    pollMs: opts.sse?.pollMs,
    batchLimit: opts.sse?.batchLimit,
  };
  const app = express();
  app.use(express.json());
  app.use("/ai-sessions", createAiSessionsRouter(usecaseDeps));
  app.use("/ai-runs", createAiRunsRouter(usecaseDeps));
  app.use("/system", systemRouter);
  return app;
}

async function makeSession(owner: AuthUser, title = "集成测试会话"): Promise<string> {
  return trackSession((await createAiSession(owner, { title })).sessionId);
}

async function submitValidRun(token: string, sessionId: string, app: express.Express) {
  const response = await request(app)
    .post(`/ai-sessions/${sessionId}/runs`)
    .set("Authorization", `Bearer ${token}`)
    .send({ submissionKey: randomUUID(), clientMessageId: randomUUID(), content: "请分析这份需求文件" });
  return response;
}

async function driveRunToTerminal(status: "completed" | "failed"): Promise<{ runId: string; attemptId: string }> {
  const created = await repo!.createQueuedRun({
    ownerUserId: alice!.id,
    ownerUsername: alice!.username,
    aiSessionId: `session-${randomUUID()}`,
    submissionKey: `submission-${randomUUID()}`,
    title: "终态驱动",
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
  });
  track(created.run.harnessRunId);
  // claimNextQueuedRun 按 available_at 升序 FIFO：把目标 run 的 availableAt
  // 拉到最早，避免捞到前序 API 测试遗留的 queued run（attempt 归属错位）。
  await testDb!
    .update(harnessRuns)
    .set({ availableAt: new Date(Date.now() - 60_000) })
    .where(eq(harnessRuns.harnessRunId, created.run.harnessRunId));
  const claimed = await repo!.claimNextQueuedRun({ workerId: "gate-c-worker", leaseMs: 45_000 });
  assert.ok(claimed, "claim must succeed");
  assert.equal(claimed.run.harnessRunId, created.run.harnessRunId, "claim must pick the target run");
  await repo!.completeAttemptAndRun({
    attemptId: claimed!.attempt.harnessRunAttemptId,
    runId: created.run.harnessRunId,
    outcome: status === "completed" ? "succeeded" : "failed",
    ...(status === "failed" ? { errorCode: "WORKER_STEP_FAILED", errorMessage: "boom" } : {}),
  });
  return { runId: created.run.harnessRunId, attemptId: claimed!.attempt.harnessRunAttemptId };
}

async function driveRunToWaiting(): Promise<string> {
  const created = await repo!.createQueuedRun({
    ownerUserId: alice!.id,
    ownerUsername: alice!.username,
    aiSessionId: `session-${randomUUID()}`,
    submissionKey: `submission-${randomUUID()}`,
    title: "等待补充",
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
  });
  track(created.run.harnessRunId);
  await testDb!
    .update(harnessRuns)
    .set({ status: "waiting" })
    .where(eq(harnessRuns.harnessRunId, created.run.harnessRunId));
  return created.run.harnessRunId;
}

async function listEvents(runId: string, eventType?: string) {
  const rows = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(
      eventType
        ? and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, eventType))
        : eq(harnessRunEvents.harnessRunId, runId),
    )
    .orderBy(harnessRunEvents.sequence);
  return rows;
}

// ============================================================
// SSE 采集助手：真实 HTTP 连接，支持 abort 与 Last-Event-ID
// ============================================================

type SseEvent = { id?: string; event?: string; data: string };
type SseResult = { statusCode: number; contentType: string; events: SseEvent[]; closedByServer: boolean; body: string };

function collectSse(opts: {
  port: number;
  path: string;
  token: string;
  lastEventId?: string;
  abortAfterMs?: number;
  timeoutMs?: number;
}): Promise<SseResult> {
  return new Promise((resolve, reject) => {
    const events: SseEvent[] = [];
    let buffer = "";
    let statusCode = 0;
    let contentType = "";
    let body = "";
    let settled = false;
    let abortTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = setTimeout(() => {
      finish(false, "timeout");
    }, opts.timeoutMs ?? 10_000);

    const flushBlock = (block: string): void => {
      const lines = block.split("\n");
      const event: Partial<SseEvent> = {};
      for (const line of lines) {
        if (line.startsWith("id:")) event.id = line.slice(3).trim();
        else if (line.startsWith("event:")) event.event = line.slice(6).trim();
        else if (line.startsWith("data:")) event.data = (event.data ?? "") + line.slice(5).trim();
      }
      if (event.data !== undefined) events.push(event as SseEvent);
    };

    const pump = (): void => {
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        if (block.trim()) flushBlock(block);
        separator = buffer.indexOf("\n\n");
      }
    };

    const finish = (closedByServer: boolean, reason?: string): void => {
      if (settled) return;
      settled = true;
      if (abortTimer) clearTimeout(abortTimer);
      clearTimeout(timeoutTimer);
      if (reason === "timeout") {
        req.destroy();
        resolve({ statusCode, contentType, events, closedByServer: false, body });
        return;
      }
      resolve({ statusCode, contentType, events, closedByServer, body });
    };

    const req = http.request(
      {
        host: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: "GET",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "text/event-stream",
          ...(opts.lastEventId !== undefined ? { "Last-Event-ID": opts.lastEventId } : {}),
        },
      },
      (res) => {
        statusCode = res.statusCode ?? 0;
        contentType = String(res.headers["content-type"] ?? "");
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          buffer += chunk;
          pump();
          if (opts.abortAfterMs !== undefined && abortTimer === null) {
            abortTimer = setTimeout(() => {
              req.destroy();
              setTimeout(() => finish(false, "aborted"), 50);
            }, opts.abortAfterMs);
          }
        });
        res.on("end", () => {
          pump();
          finish(true);
        });
        res.on("error", () => finish(false, "res-error"));
      },
    );
    req.on("error", () => {
      if (!settled) finish(false, "req-error");
    });
    req.end();
  });
}

function listen(app: express.Express): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

// ============================================================
// G4 feature flag 关闭：新端点 503、删除保持旧行为
// ============================================================

test("flag off: submit returns 503 ASYNC_RUNS_DISABLED", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: false });
  const sessionId = await makeSession(alice!);
  const response = await submitValidRun(aliceToken, sessionId, app);
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "ASYNC_RUNS_DISABLED");
});

test("flag off: ai-runs endpoints return 503 and session delete keeps legacy behavior", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: false });
  const sessionId = await makeSession(alice!);

  const list = await request(app).get("/ai-runs").set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(list.status, 503);
  const get = await request(app).get(`/ai-runs/${randomUUID()}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(get.status, 503);
  const cancel = await request(app).post(`/ai-runs/${randomUUID()}/cancel`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(cancel.status, 503);

  const del = await request(app).delete(`/ai-sessions/${sessionId}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(del.status, 200, "flag 关闭时删除必须保持旧行为");
  assert.equal(del.body.code, 0);
});

// ============================================================
// G1 提交契约：202 / 幂等 / 422 / 404 / 401
// ============================================================

test("submit returns HTTP 202 with the frozen envelope", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submissionKey = randomUUID();
  const clientMessageId = randomUUID();
  const response = await request(app)
    .post(`/ai-sessions/${sessionId}/runs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ submissionKey, clientMessageId, content: "请分析这份需求文件" });
  assert.equal(response.status, 202);
  assert.equal(response.body.code, 0);
  assert.ok(response.body.data.runId);
  track(response.body.data.runId);
  assert.equal(response.body.data.sessionId, sessionId);
  assert.equal(response.body.data.status, "queued");
  assert.equal(response.body.data.eventCursor, 1);

  const run = await repo!.findRunForOwner(response.body.data.runId, alice!.id);
  assert.equal((run?.metadata as { clientMessageId?: string })?.clientMessageId, clientMessageId, "clientMessageId 必须原样承载于 metadata");
});

test("duplicate submissionKey returns the same runId idempotently", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submissionKey = randomUUID();
  const first = await request(app)
    .post(`/ai-sessions/${sessionId}/runs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ submissionKey, content: "第一次提交" });
  assert.equal(first.status, 202);
  track(first.body.data.runId);
  const second = await request(app)
    .post(`/ai-sessions/${sessionId}/runs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ submissionKey, content: "重放提交" });
  assert.equal(second.status, 202);
  assert.equal(second.body.data.runId, first.body.data.runId);
});

test("submit rejects invalid parameters with 422", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const missingKey = await request(app)
    .post(`/ai-sessions/${sessionId}/runs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ content: "缺少 submissionKey" });
  assert.equal(missingKey.status, 422);
  const blankContent = await request(app)
    .post(`/ai-sessions/${sessionId}/runs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ submissionKey: randomUUID(), content: "   " });
  assert.equal(blankContent.status, 422);
});

test("submit to a foreign session returns 404 without leaking existence", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const response = await submitValidRun(bobToken, sessionId, app);
  assert.equal(response.status, 404);
  const ghost = await submitValidRun(aliceToken, `ghost-${randomUUID()}`, app);
  assert.equal(ghost.status, 404, "不存在的 session 与他人的 session 必须同为 404");
});

test("submit without JWT returns 401", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const response = await request(app).post(`/ai-sessions/${sessionId}/runs`).send({ submissionKey: randomUUID(), content: "匿名" });
  assert.equal(response.status, 401);
});

// ============================================================
// G1/G2 读取：active 列表与 snapshot
// ============================================================

test("active runs list is owner-isolated between two users", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const aliceSession = await makeSession(alice!);
  const bobSession = await makeSession(bob!);
  const aliceSubmit = await submitValidRun(aliceToken, aliceSession, app);
  const bobSubmit = await submitValidRun(bobToken, bobSession, app);
  track(aliceSubmit.body.data.runId);
  track(bobSubmit.body.data.runId);

  const aliceList = await request(app).get("/ai-runs?status=active").set("Authorization", `Bearer ${aliceToken}`);
  const bobList = await request(app).get("/ai-runs?status=active").set("Authorization", `Bearer ${bobToken}`);
  assert.equal(aliceList.status, 200);
  assert.equal(bobList.status, 200);
  const aliceRunIds = (aliceList.body.data.items as Array<{ runId: string }>).map((item) => item.runId);
  const bobRunIds = (bobList.body.data.items as Array<{ runId: string }>).map((item) => item.runId);
  assert.ok(aliceRunIds.includes(aliceSubmit.body.data.runId));
  assert.ok(!aliceRunIds.includes(bobSubmit.body.data.runId), "alice 不得看到 bob 的 Run");
  assert.ok(bobRunIds.includes(bobSubmit.body.data.runId));
  assert.ok(!bobRunIds.includes(aliceSubmit.body.data.runId), "bob 不得看到 alice 的 Run");
});

test("snapshot returns run aggregate for owner and 404 for non-owner", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  const runId = submitted.body.data.runId as string;
  track(runId);

  const ownerView = await request(app).get(`/ai-runs/${runId}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.body.data.run.runId ?? ownerView.body.data.run.harnessRunId, runId);
  assert.ok("attempt" in ownerView.body.data);
  assert.ok("checkpoint" in ownerView.body.data);
  assert.ok("output" in ownerView.body.data);

  const intruderView = await request(app).get(`/ai-runs/${runId}`).set("Authorization", `Bearer ${bobToken}`);
  assert.equal(intruderView.status, 404, "非 owner 必须得到 404");
  const ghostView = await request(app).get(`/ai-runs/${randomUUID()}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(ghostView.status, 404);
});

// ============================================================
// G1 Session 删除 409 保护与重命名不影响 Run
// ============================================================

test("delete session with an active run returns 409 SESSION_HAS_ACTIVE_RUN", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  track(submitted.body.data.runId);

  const blocked = await request(app).delete(`/ai-sessions/${sessionId}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "SESSION_HAS_ACTIVE_RUN");

  const stillThere = await request(app).get(`/ai-sessions/${sessionId}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(stillThere.status, 200, "冲突时会话必须保留");
});

test("delete succeeds once the run reaches a terminal status", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  const runId = submitted.body.data.runId as string;
  track(runId);

  const claimed = await claimRunById(runId);
  await repo!.completeAttemptAndRun({ attemptId: claimed.attempt.harnessRunAttemptId, runId, outcome: "succeeded" });

  const del = await request(app).delete(`/ai-sessions/${sessionId}`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(del.status, 200);
});

test("rename does not affect the active run", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  track(submitted.body.data.runId);

  const renamed = await request(app)
    .patch(`/ai-sessions/${sessionId}`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ title: "改名后的会话" });
  assert.equal(renamed.status, 200);

  const list = await request(app).get("/ai-runs?status=active").set("Authorization", `Bearer ${aliceToken}`);
  const runIds = (list.body.data.items as Array<{ runId: string }>).map((item) => item.runId);
  assert.ok(runIds.includes(submitted.body.data.runId), "重命名后活跃 Run 必须仍在列表");
});

// ============================================================
// G2 全端点跨 owner 404
// ============================================================

test("all action endpoints return 404 for a non-owner", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  const runId = submitted.body.data.runId as string;
  track(runId);

  const cancel = await request(app).post(`/ai-runs/${runId}/cancel`).set("Authorization", `Bearer ${bobToken}`);
  assert.equal(cancel.status, 404);
  const inputs = await request(app)
    .post(`/ai-runs/${runId}/inputs`)
    .set("Authorization", `Bearer ${bobToken}`)
    .send({ input: { answer: "试探" } });
  assert.equal(inputs.status, 404);
  const confirm = await request(app).post(`/ai-runs/${runId}/actions/action-1/confirm`).set("Authorization", `Bearer ${bobToken}`);
  assert.equal(confirm.status, 404);
  const retry = await request(app).post(`/ai-runs/${runId}/retry`).set("Authorization", `Bearer ${bobToken}`);
  assert.equal(retry.status, 404);
});

// ============================================================
// G1 动作契约：cancel / inputs / confirm / retry
// ============================================================

test("cancel accepts an active run and rejects terminal runs with 409", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  const runId = submitted.body.data.runId as string;
  track(runId);

  const accepted = await request(app).post(`/ai-runs/${runId}/cancel`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(accepted.status, 202);
  // 本用例无 worker 认领，Run 无活跃 attempt：没有任何执行者能把 cancelling 收尾，
  // 故直接落 cancelled 终态（有活跃 attempt 时仍走 cancelling，见 repository R10 / worker T 用例）。
  const cancelled = await repo!.findRunForOwner(runId, alice!.id);
  assert.equal(cancelled?.status, "cancelled");
  assert.ok((await listEvents(runId, "cancel_requested")).length > 0);
  assert.ok((await listEvents(runId, "run_cancelled")).length > 0);

  const terminal = await driveRunToTerminal("completed");
  track(terminal.runId);
  const rejected = await request(app).post(`/ai-runs/${terminal.runId}/cancel`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(rejected.status, 409);
});

test("inputs rejects non-waiting runs with 409 and resumes waiting runs to queued", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const queuedSubmit = await submitValidRun(aliceToken, sessionId, app);
  track(queuedSubmit.body.data.runId);
  const rejected = await request(app)
    .post(`/ai-runs/${queuedSubmit.body.data.runId}/inputs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ input: { answer: "补充" } });
  assert.equal(rejected.status, 409, "queued Run 收 inputs 必须 409");

  const invalid = await request(app)
    .post(`/ai-runs/${queuedSubmit.body.data.runId}/inputs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({});
  assert.equal(invalid.status, 422);

  const waitingRunId = await driveRunToWaiting();
  const accepted = await request(app)
    .post(`/ai-runs/${waitingRunId}/inputs`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ input: { answer: "补充信息", scope: "财务模块" } });
  assert.equal(accepted.status, 202);
  const resumed = await repo!.findRunForOwner(waitingRunId, alice!.id);
  assert.equal(resumed?.status, "queued", "waiting 收到 inputs 后必须回到 queued 续跑");
  const inputEvents = await listEvents(waitingRunId, "run_inputs_submitted");
  assert.equal(inputEvents.length, 1);
});

test("confirm is idempotent: second confirmation appends no duplicate event", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const waitingRunId = await driveRunToWaiting();
  const actionId = `action-${randomUUID()}`;

  const first = await request(app)
    .post(`/ai-runs/${waitingRunId}/actions/${actionId}/confirm`)
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(first.status, 202);
  const afterFirst = await repo!.findRunForOwner(waitingRunId, alice!.id);
  assert.equal(afterFirst?.status, "queued");

  // 二次确认：Run 已回到 queued，幂等返回不得追加事件
  const second = await request(app)
    .post(`/ai-runs/${waitingRunId}/actions/${actionId}/confirm`)
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(second.status, 200, "幂等重放必须 200");
  const confirmEvents = await listEvents(waitingRunId, "run_action_confirmed");
  assert.equal(confirmEvents.length, 1, "二次确认不得重复事件");
});

test("confirm rejects non-waiting runs with 409", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  track(submitted.body.data.runId);
  const rejected = await request(app)
    .post(`/ai-runs/${submitted.body.data.runId}/actions/action-1/confirm`)
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(rejected.status, 409);
});

test("retry only allows failed terminal runs, carries retryOfRunId and keeps the original immutable", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });

  const sessionId = await makeSession(alice!);
  const queuedSubmit = await submitValidRun(aliceToken, sessionId, app);
  track(queuedSubmit.body.data.runId);
  const queuedRetry = await request(app).post(`/ai-runs/${queuedSubmit.body.data.runId}/retry`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(queuedRetry.status, 409, "非 failed 终态不得重试");

  const completed = await driveRunToTerminal("completed");
  const completedRetry = await request(app).post(`/ai-runs/${completed.runId}/retry`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(completedRetry.status, 409, "completed 终态不得重试");

  const failed = await driveRunToTerminal("failed");
  const failedBefore = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, failed.runId));
  const retried = await request(app).post(`/ai-runs/${failed.runId}/retry`).set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(retried.status, 202);
  const newRunId = retried.body.data.runId as string;
  track(newRunId);
  assert.notEqual(newRunId, failed.runId);
  assert.equal(retried.body.data.status, "queued");

  const newRun = await repo!.findRunForOwner(newRunId, alice!.id);
  assert.equal(newRun?.retryOfRunId, failed.runId, "新 Run 必须携带 retryOfRunId");
  const failedAfter = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, failed.runId));
  assert.deepEqual(failedAfter, failedBefore, "原 failed Run 行必须零变更");
});

// ============================================================
// G3 SSE 回放：续读、Last-Event-ID、断线不取消、终态关闭
// ============================================================

test("SSE handshake rejects non-owner with 404 before opening the stream", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true, sse: { pollMs: 50, heartbeatMs: 3_000 } });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  track(submitted.body.data.runId);
  const server = await listen(app);
  try {
    const result = await collectSse({
      port: server.port,
      path: `/ai-runs/${submitted.body.data.runId}/events`,
      token: bobToken,
      timeoutMs: 3_000,
    });
    assert.equal(result.statusCode, 404);
    assert.ok(!result.contentType.includes("text/event-stream"), "非 owner 不得建立事件流");
    assert.equal(result.events.length, 0);
  } finally {
    await server.close();
  }
});

test("SSE replay from after cursor loses and duplicates nothing", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true, sse: { pollMs: 50, heartbeatMs: 3_000 } });
  const terminal = await driveRunToTerminal("completed");
  const allEvents = await listEvents(terminal.runId);
  assert.ok(allEvents.length >= 3, "终态 Run 至少应有 queued/claimed/completed 三事件");
  const cursor = allEvents[0].sequence;

  const server = await listen(app);
  try {
    const full = await collectSse({ port: server.port, path: `/ai-runs/${terminal.runId}/events?after=0`, token: aliceToken, timeoutMs: 5_000 });
    assert.equal(full.closedByServer, true, "终态排空后服务端必须主动关闭");
    const fullSequences = full.events.map((event) => Number(event.id));
    assert.deepEqual(fullSequences, allEvents.map((event) => event.sequence), "全量回放必须不丢不重");

    const partial = await collectSse({ port: server.port, path: `/ai-runs/${terminal.runId}/events?after=${cursor}`, token: aliceToken, timeoutMs: 5_000 });
    const partialSequences = partial.events.map((event) => Number(event.id));
    assert.deepEqual(partialSequences, allEvents.filter((event) => event.sequence > cursor).map((event) => event.sequence), "after 游标续读必须严格递增无重复");
    for (let i = 1; i < partialSequences.length; i += 1) {
      assert.ok(partialSequences[i] > partialSequences[i - 1], "sequence 必须严格递增");
    }
  } finally {
    await server.close();
  }
});

test("Last-Event-ID takes precedence over the after query parameter", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true, sse: { pollMs: 50, heartbeatMs: 3_000 } });
  const terminal = await driveRunToTerminal("completed");
  const allEvents = await listEvents(terminal.runId);
  const cursor = allEvents[0].sequence;

  const server = await listen(app);
  try {
    const viaHeader = await collectSse({
      port: server.port,
      path: `/ai-runs/${terminal.runId}/events?after=0`,
      token: aliceToken,
      lastEventId: String(cursor),
      timeoutMs: 5_000,
    });
    const viaQuery = await collectSse({
      port: server.port,
      path: `/ai-runs/${terminal.runId}/events?after=${cursor}`,
      token: aliceToken,
      timeoutMs: 5_000,
    });
    const headerSequences = viaHeader.events.map((event) => Number(event.id));
    const querySequences = viaQuery.events.map((event) => Number(event.id));
    assert.deepEqual(headerSequences, querySequences, "Last-Event-ID 与 after 双通道必须一致");
    assert.ok(headerSequences.every((sequence) => sequence > cursor), "Last-Event-ID 必须优先于 after=0");
  } finally {
    await server.close();
  }
});

test("client disconnect does not cancel the run and replay can resume", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true, sse: { pollMs: 50, heartbeatMs: 3_000 } });
  const sessionId = await makeSession(alice!);
  const submitted = await submitValidRun(aliceToken, sessionId, app);
  const runId = submitted.body.data.runId as string;
  track(runId);

  const server = await listen(app);
  try {
    const aborted = await collectSse({
      port: server.port,
      path: `/ai-runs/${runId}/events`,
      token: aliceToken,
      abortAfterMs: 300,
      timeoutMs: 5_000,
    });
    assert.equal(aborted.closedByServer, false, "必须由客户端主动中断");

    // 给服务端留一点时间，观察是否错误地写入取消语义
    await new Promise((resolve) => setTimeout(resolve, 400));
    const runAfterAbort = await repo!.findRunForOwner(runId, alice!.id);
    assert.equal(runAfterAbort?.status, "queued", "断线后 Run 状态必须不变");
    assert.equal(runAfterAbort?.cancelRequestedAt, null, "断线不得触发 cancel_requested");
    const cancelEvents = await listEvents(runId, "cancel_requested");
    assert.equal(cancelEvents.length, 0, "断线不得写入 cancel_requested 事件");
    const cancelledEvents = await listEvents(runId, "run_cancelled");
    assert.equal(cancelledEvents.length, 0, "断线不得写入 run_cancelled 事件");

    // 重连仍可回放既有事件
    const resumed = await collectSse({ port: server.port, path: `/ai-runs/${runId}/events?after=0`, token: aliceToken, abortAfterMs: 500, timeoutMs: 5_000 });
    assert.ok(resumed.events.some((event) => event.event === "run_queued"), "重连后事件必须可继续回放");
  } finally {
    await server.close();
  }
});

// ============================================================
// S2b-1 补测：system:manage admin 审计聚合（HTTP 装配层）
// ============================================================
// 映射表补测分层：admin 聚合 / 过滤倒序 → ai-runs.routes.test.ts（真实 express 装配）。
// 关键断言全部无条件执行（A-1 判据）；q 用随机前缀限定域，避免共享表依赖。

// ① admin 聚合：GET /system/ai-sessions 跨用户聚合全部会话摘要

test("system:manage admin aggregates ai-sessions across users", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const prefix = `wes-ai-runs-admin-${randomUUID().slice(0, 8)}`;
  const aliceSession = trackSession((await createAiSession(alice!, { title: `${prefix}-alice` })).sessionId);
  const bobSession = trackSession((await createAiSession(bob!, { title: `${prefix}-bob` })).sessionId);

  const response = await request(app).get(`/system/ai-sessions?q=${prefix}`).set("Authorization", `Bearer ${adminToken}`);
  assert.equal(response.status, 200);
  const items = response.body.data.items as Array<{ sessionId: string; ownerUsername: string }>;
  const byId = new Map(items.map((item) => [item.sessionId, item]));
  const aliceSummary = byId.get(aliceSession);
  const bobSummary = byId.get(bobSession);
  assert.ok(aliceSummary, "admin 聚合必须包含 alice 的会话");
  assert.equal(aliceSummary!.ownerUsername, alice!.username);
  assert.ok(bobSummary, "admin 聚合必须包含 bob 的会话");
  assert.equal(bobSummary!.ownerUsername, bob!.username);
  assert.equal("messages" in (aliceSummary as object), false, "审计摘要不得携带消息原文数组");
});

// ② 过滤倒序：q 限定域内按 updatedAt 倒序，status/domain 过滤各自生效

test("system:manage admin list filters by status/domain and orders by updatedAt desc", { skip: !testDatabaseUrl }, async () => {
  const app = makeApp({ enabled: true });
  const prefix = `wes-ai-runs-filter-${randomUUID().slice(0, 8)}`;
  const older = trackSession((await createAiSession(alice!, { title: `${prefix}-older`, status: "standard_review", domain: "standard_governance" })).sessionId);
  const newer = trackSession((await createAiSession(bob!, { title: `${prefix}-newer` })).sessionId);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await appendAiSessionEvent(alice!, older, { message: { role: "user", content: "追加一轮" } });

  const list = await request(app).get(`/system/ai-sessions?q=${prefix}`).set("Authorization", `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  const items = list.body.data.items as Array<{ sessionId: string }>;
  assert.equal(items.length, 2, "q 限定域内应聚合两会话");
  assert.equal(items[0].sessionId, older, "应按 updatedAt 倒序（追加过的 older 排前）");

  const byStatus = await request(app).get(`/system/ai-sessions?q=${prefix}&status=standard_review`).set("Authorization", `Bearer ${adminToken}`);
  assert.equal(byStatus.status, 200);
  const statusItems = byStatus.body.data.items as Array<{ sessionId: string }>;
  assert.equal(statusItems.length, 1, "status 过滤应生效");
  assert.equal(statusItems[0].sessionId, older);

  const byDomain = await request(app).get(`/system/ai-sessions?q=${prefix}&domain=standard_governance`).set("Authorization", `Bearer ${adminToken}`);
  assert.equal(byDomain.status, 200);
  const domainItems = byDomain.body.data.items as Array<{ sessionId: string }>;
  assert.equal(domainItems.length, 1, "domain 过滤应生效");
  assert.equal(domainItems[0].sessionId, older);
});
