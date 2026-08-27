// ============================================================
// AI Runs 异步 Run usecase 测试（RP-047 Batch C · C1/C3 契约）
// ============================================================
// RED 先行：提交 202 契约、submissionKey 幂等、flag 503、session 404、
// 删除冲突 409、cancel/inputs/confirm/retry 状态矩阵。
// 使用内存 fake repository，不依赖 PostgreSQL。
// C10（2026-08-25）：deleteAiSession 契约用例依赖 ai-sessions 存储断言。
// S2b-1（2026-08-27）：两用例已随九开关走 PG（断言经 getAiSession 读回、
// fixture 经 createAiSession 种入，构造与读取同源），是文件内仅有的 DB
// 依赖用例——缺失 TEST_DATABASE_URL 时按 C4 诚实 skip；其余用例仍为内存
// fake repository。

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import type { AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import {
  AiRunsConflictError,
  AiRunsDisabledError,
  createAiRunsUsecase,
  isDurableRunsEnabledFromEnv,
  type AiRunsUsecaseDeps,
} from "./harness-runtime.usecase";

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const id = randomUUID();
  return {
    id,
    username: `ai-runs-${id}`,
    role: "user",
    status: "active",
    passwordHash: "",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(user: AuthUser, overrides: Partial<AiSessionRecord> = {}): AiSessionRecord {
  const now = new Date().toISOString();
  return {
    sessionId: randomUUID(),
    ownerUserId: user.id,
    ownerUsername: user.username,
    title: "测试会话",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    summary: "",
    messages: [],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    harnessRunId: randomUUID(),
    ownerUserId: "owner-1",
    ownerUsername: "owner",
    mode: "interactive",
    stage: "uploaded",
    status: "queued",
    title: "run",
    aiSessionId: "session-1",
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    runKind: "workbench_chat",
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
    currentStepKey: null,
    submissionKey: null,
    eventSequence: 1,
    availableAt: now,
    recoveryCount: 0,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    lastCheckpointId: null,
    executionConfig: {},
    retryOfRunId: null,
    ...overrides,
  };
}

type FakeRepoOptions = {
  activeRunForSession?: boolean;
};

function makeFakeRepo(options: FakeRepoOptions = {}) {
  const runs: Array<Record<string, unknown>> = [];
  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const repo = {
    calls,
    runs,
    async createQueuedRun(input: Record<string, unknown>) {
      bump("createQueuedRun");
      const replayed = runs.find((run) => run.ownerUserId === input.ownerUserId && run.submissionKey === input.submissionKey);
      if (replayed) return { run: replayed, created: false };
      const run = makeRunRow({
        ownerUserId: input.ownerUserId,
        ownerUsername: input.ownerUsername,
        aiSessionId: input.aiSessionId,
        submissionKey: input.submissionKey,
        title: input.title,
        workflowId: input.workflowId,
        workflowVersion: input.workflowVersion,
        executionConfig: input.executionConfig ?? {},
        metadata: input.metadata ?? {},
        retryOfRunId: input.retryOfRunId ?? null,
      });
      runs.push(run);
      return { run, created: true };
    },
    async findRunForOwner(runId: string, ownerUserId: string) {
      bump("findRunForOwner");
      return runs.find((run) => run.harnessRunId === runId && run.ownerUserId === ownerUserId) ?? null;
    },
    async listActiveRunsForOwner(ownerUserId: string) {
      bump("listActiveRunsForOwner");
      return runs.filter((run) => run.ownerUserId === ownerUserId && ["queued", "running", "waiting", "recovering", "cancelling"].includes(String(run.status)));
    },
    async getRunSnapshot(runId: string) {
      bump("getRunSnapshot");
      const run = runs.find((item) => item.harnessRunId === runId) ?? null;
      if (!run) return null;
      return { run, attempt: null, checkpoint: null, output: null };
    },
    async hasActiveRunForSession(aiSessionId: string) {
      bump("hasActiveRunForSession");
      if (options.activeRunForSession) return true;
      return runs.some((run) => run.aiSessionId === aiSessionId && ["queued", "running", "waiting", "recovering", "cancelling"].includes(String(run.status)));
    },
    async listRunEventsAfter() {
      return [];
    },
    async requestRunCancel(input: { runId: string }) {
      bump("requestRunCancel");
      const run = runs.find((item) => item.harnessRunId === input.runId);
      if (!run) throw new Error("not found");
      if (["completed", "failed", "cancelled"].includes(String(run.status))) return { changed: false, run };
      run.status = "cancelling";
      return { changed: true, run };
    },
    async submitRunInput() {
      bump("submitRunInput");
      throw new Error("not implemented in fake");
    },
    async confirmRunAction() {
      bump("confirmRunAction");
      throw new Error("not implemented in fake");
    },
  };
  return repo;
}

type TestDeps = AiRunsUsecaseDeps & {
  repo: ReturnType<typeof makeFakeRepo>;
  sessions: Map<string, AiSessionRecord>;
};

function makeDeps(overrides: Partial<AiRunsUsecaseDeps> = {}): TestDeps {
  const repo = makeFakeRepo();
  const sessions = new Map<string, AiSessionRecord>();
  return {
    repo,
    enabled: true,
    findSession: async (user: AuthUser, sessionId: string) => {
      const session = sessions.get(sessionId);
      return session && session.ownerUserId === user.id ? session : null;
    },
    sessions,
    ...overrides,
  } as unknown as TestDeps;
}

// ----------------------------------------------------------------
// C1 提交契约
// ----------------------------------------------------------------

test("submitRun returns 202 payload with queued status and eventCursor", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  const result = await usecase.submitRun(user, session.sessionId, {
    submissionKey: randomUUID(),
    clientMessageId: randomUUID(),
    content: "请分析这份需求文件",
  });

  assert.equal(result.status, 202);
  assert.equal(result.data.status, "queued");
  assert.equal(result.data.sessionId, session.sessionId);
  assert.equal(result.data.eventCursor, 1);
  assert.ok(result.data.runId);
});

test("ISS-2026-08-11-007: submitRun persists normalized attachments in executionConfig", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  const result = await usecase.submitRun(user, session.sessionId, {
    submissionKey: randomUUID(),
    content: "请分析附件",
    attachments: [{
      name: "客户需求.xlsx",
      size: 4096,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parsedSummary: "项目：蓝海制造\n需求：多组织业务协同",
    }],
  } as any);

  const run = deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === result.data.runId);
  assert.deepEqual((run?.executionConfig as Record<string, unknown>)?.attachments, [{
    name: "客户需求.xlsx",
    size: 4096,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parsedSummary: "项目：蓝海制造\n需求：多组织业务协同",
  }]);
});

test("ISS-2026-08-11-007: submitRun bounds attachment count and parsed summary length", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  const result = await usecase.submitRun(user, session.sessionId, {
    submissionKey: randomUUID(),
    content: "请分析附件",
    attachments: Array.from({ length: 6 }, (_, index) => ({
      name: `附件-${index + 1}.txt`,
      parsedSummary: "需".repeat(9_000),
    })),
  } as any);

  const run = deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === result.data.runId);
  const attachments = (run?.executionConfig as { attachments?: Array<{ parsedSummary?: string }> })?.attachments ?? [];
  assert.equal(attachments.length, 5);
  assert.equal(attachments[0].parsedSummary?.length, 8_000);
  assert.match(attachments[0].parsedSummary ?? "", /…\[truncated\]$/);
});

test("submitRun replays the same runId for a duplicate submissionKey", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submissionKey = randomUUID();

  const first = await usecase.submitRun(user, session.sessionId, { submissionKey, content: "第一次" });
  const second = await usecase.submitRun(user, session.sessionId, { submissionKey, content: "第二次重放" });

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(second.data.runId, first.data.runId);
});

test("submitRun rejects a foreign session with 404 without leaking existence", async () => {
  const deps = makeDeps();
  const owner = makeUser();
  const intruder = makeUser();
  const session = makeSession(owner);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  await assert.rejects(
    usecase.submitRun(intruder, session.sessionId, { submissionKey: randomUUID(), content: "试探" }),
    (err: unknown) => err instanceof AiRunsConflictError === false && (err as { status?: number }).status === 404,
  );
});

test("submitRun rejects invalid parameters with 422", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  await assert.rejects(
    usecase.submitRun(user, session.sessionId, { content: "缺少 submissionKey" }),
    (err: unknown) => (err as { status?: number }).status === 422,
  );
  await assert.rejects(
    usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "   " }),
    (err: unknown) => (err as { status?: number }).status === 422,
  );
});

test("submitRun returns 503 ASYNC_RUNS_DISABLED when the flag is off", async () => {
  const deps = makeDeps({ enabled: false });
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  await assert.rejects(
    usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "被 flag 拦截" }),
    (err: unknown) => err instanceof AiRunsDisabledError && (err as { code?: string }).code === "ASYNC_RUNS_DISABLED",
  );
});

test("isDurableRunsEnabledFromEnv defaults to false and only accepts true", () => {
  const previous = process.env.WES_AI_DURABLE_RUNS_ENABLED;
  try {
    delete process.env.WES_AI_DURABLE_RUNS_ENABLED;
    assert.equal(isDurableRunsEnabledFromEnv(), false);
    process.env.WES_AI_DURABLE_RUNS_ENABLED = "false";
    assert.equal(isDurableRunsEnabledFromEnv(), false);
    process.env.WES_AI_DURABLE_RUNS_ENABLED = "1";
    assert.equal(isDurableRunsEnabledFromEnv(), false);
    process.env.WES_AI_DURABLE_RUNS_ENABLED = "true";
    assert.equal(isDurableRunsEnabledFromEnv(), true);
  } finally {
    if (previous === undefined) delete process.env.WES_AI_DURABLE_RUNS_ENABLED;
    else process.env.WES_AI_DURABLE_RUNS_ENABLED = previous;
  }
});

// ----------------------------------------------------------------
// C1 读取契约
// ----------------------------------------------------------------

test("listActiveRuns only returns the caller's own active runs", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const other = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  await usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "我的任务" });

  const otherSession = makeSession(other);
  deps.sessions.set(otherSession.sessionId, otherSession);
  await usecase.submitRun(other, otherSession.sessionId, { submissionKey: randomUUID(), content: "别人的任务" });

  const mine = await usecase.listActiveRuns(user);
  const theirs = await usecase.listActiveRuns(other);
  assert.equal(mine.length, 1);
  assert.equal(theirs.length, 1);
  assert.notEqual(mine[0].runId, theirs[0].runId);
});

test("getRunSnapshot returns 404 for a non-owner", async () => {
  const deps = makeDeps();
  const owner = makeUser();
  const intruder = makeUser();
  const session = makeSession(owner);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submitted = await usecase.submitRun(owner, session.sessionId, { submissionKey: randomUUID(), content: "owner 的任务" });

  await assert.rejects(
    usecase.getRunSnapshot(intruder, submitted.data.runId),
    (err: unknown) => (err as { status?: number }).status === 404,
  );
  const snapshot = await usecase.getRunSnapshot(owner, submitted.data.runId);
  assert.equal(snapshot.run.harnessRunId, submitted.data.runId);
});

// ----------------------------------------------------------------
// C1 Session 删除 409 保护（可选 checker，向后兼容）
// S2b-1：断言经 getAiSession 读回（与 createAiSession 同仓储单例），
// 缺失 DB 时 skip；createAiSession 以 makeUser 随机 UUID 为 owner，
// finally 幂等清理不触碰其他数据。
// ----------------------------------------------------------------

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("deleteAiSession stays backward compatible without a checker", { skip: !testDatabaseUrl }, async () => {
  const { createAiSession, deleteAiSession, getAiSession } = await import("../ai-sessions/ai-sessions.usecase");
  const user = makeUser();
  const session = await createAiSession(user, { title: "待删除" });
  try {
    assert.equal(await deleteAiSession(user, session.sessionId), true, "缺省路径保持原有布尔语义（await 解包）");
    assert.equal(await getAiSession(user, session.sessionId), null, "删除后按 owner 查询必须为空");
  } finally {
    await deleteAiSession(user, session.sessionId);
  }
});

test("deleteAiSession rejects deletion with 409 SESSION_HAS_ACTIVE_RUN when a checker reports an active run", { skip: !testDatabaseUrl }, async () => {
  const { createAiSession, deleteAiSession, getAiSession } = await import("../ai-sessions/ai-sessions.usecase");
  const user = makeUser();
  const session = await createAiSession(user, { title: "有活跃 Run" });
  try {
    await assert.rejects(
      deleteAiSession(user, session.sessionId, { activeRunChecker: async () => true }),
      (err: unknown) =>
        err instanceof AiRunsConflictError &&
        (err as { code?: string }).code === "SESSION_HAS_ACTIVE_RUN" &&
        (err as { status?: number }).status === 409,
    );
    assert.notEqual(await getAiSession(user, session.sessionId), null, "冲突时不得删除会话");

    assert.equal(await deleteAiSession(user, session.sessionId, { activeRunChecker: async () => false }), true);
  } finally {
    await deleteAiSession(user, session.sessionId);
  }
});

// ----------------------------------------------------------------
// C3 动作契约（RED 占位：fake repo 未实现 → 失败）
// ----------------------------------------------------------------

test("cancelRun returns 202 for an active run", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submitted = await usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "待取消" });

  const result = await usecase.cancelRun(user, submitted.data.runId);
  assert.equal(result.status, 202);
});

test("cancelRun rejects a terminal run with 409", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submitted = await usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "已完成" });
  const run = deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === submitted.data.runId);
  if (run) run.status = "completed";

  await assert.rejects(
    usecase.cancelRun(user, submitted.data.runId),
    (err: unknown) => (err as { status?: number }).status === 409,
  );
});

test("cancelRun returns 404 for a non-owner", async () => {
  const deps = makeDeps();
  const owner = makeUser();
  const intruder = makeUser();
  const session = makeSession(owner);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submitted = await usecase.submitRun(owner, session.sessionId, { submissionKey: randomUUID(), content: "owner" });

  await assert.rejects(
    usecase.cancelRun(intruder, submitted.data.runId),
    (err: unknown) => (err as { status?: number }).status === 404,
  );
});

test("retryRun creates a new run carrying retryOfRunId and leaves the original untouched", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submitted = await usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "会失败的任务" });
  const run = deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === submitted.data.runId);
  if (run) {
    run.status = "failed";
    run.errorCode = "WORKER_STEP_FAILED";
  }
  const failedSnapshot = JSON.stringify(run);

  const retried = await usecase.retryRun(user, submitted.data.runId);
  assert.equal(retried.status, 202);
  assert.notEqual(retried.data.runId, submitted.data.runId);
  const newRun = deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === retried.data.runId);
  assert.equal(newRun?.retryOfRunId, submitted.data.runId);
  assert.equal(JSON.stringify(deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === submitted.data.runId)), failedSnapshot, "原 Run 行必须零变更");
});

test("retryRun rejects non-failed runs with 409", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const submitted = await usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "还在排队" });

  await assert.rejects(
    usecase.retryRun(user, submitted.data.runId),
    (err: unknown) => (err as { status?: number }).status === 409,
  );
});
