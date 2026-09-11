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
  AiRunsValidationError,
  createAiRunsUsecase,
  isDurableRunsEnabledFromEnv,
  type AiRunsUsecaseDeps,
} from "./harness-runtime.usecase";
import { HarnessRuntimeError } from "./harness-runtime.repository";

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
  /** 批次 2b-1：模拟仓储在入队时以「载荷超 1 MiB」抛错（真仓储在事务内做这个校验） */
  failWithPayloadTooLarge?: boolean;
};

function makeFakeRepo(options: FakeRepoOptions = {}) {
  const runs: Array<Record<string, unknown>> = [];
  /** 批次 2b-1：记录每次 createQueuedRun 的**原始入参**，用于断言正文取值来源 */
  const queuedInputs: Array<Record<string, unknown>> = [];
  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const repo = {
    calls,
    runs,
    queuedInputs,
    async createQueuedRun(input: Record<string, unknown>) {
      bump("createQueuedRun");
      queuedInputs.push(input);
      if (options.failWithPayloadTooLarge) {
        throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_TOO_LARGE", "payload exceeds 1 MiB JSON limit");
      }
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

function makeDeps(overrides: Partial<AiRunsUsecaseDeps> = {}, repoOptions: FakeRepoOptions = {}): TestDeps {
  const repo = makeFakeRepo(repoOptions);
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

// ----------------------------------------------------------------
// 批次 2b-1 / 2b-2：提交原文与会话消息信封必须整体带进队载荷（不取自 title）
// ----------------------------------------------------------------
// title 是 `content.slice(0, 80)`——它今天恰好是正文的前 80 字，但语义是标题。
// 2b-1 消灭的是「正文从 title 抄」；2b-2 进一步要求载荷带齐信封（messageId /
// createdAt / attachmentIds / metadata），因为 2b-3 之后重建历史只能读事件流。
// 用例让正文长过 80 字、并带首尾空白，再断言载荷正文与 executionConfig.content
// 逐字节相同（后者是 workflow 落 ai_sessions 用户消息时读的同一份）。

/** 从入队记录里取出按某个假想 runId 构造的载荷。 */
function queuedUserMessageFact(queued: Record<string, unknown>, runId: string): Record<string, unknown> {
  const build = queued.userMessageFact as ((id: string) => Record<string, unknown>) | undefined;
  assert.ok(typeof build === "function", "对话提交必须传 userMessageFact 构造器（不传即不写事件）");
  return build(runId);
}

test("批次2b-1: submitRun 把提交原文整体带入载荷，且与 title 解耦", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  const longBody = `第一轮请先看这段：${"需求细节".repeat(30)}\n第二行含换行`;
  const result = await usecase.submitRun(user, session.sessionId, {
    submissionKey: randomUUID(),
    content: `  ${longBody}  `,
  });
  assert.equal(result.status, 202);

  const queued = deps.repo.queuedInputs[0];
  const executionConfig = queued.executionConfig as {
    content: string;
    conversationFact?: { userMessage?: { messageId?: string; createdAt?: string }; attachments?: unknown[] };
  };
  const payload = queuedUserMessageFact(queued, "run-fixture-1");

  assert.equal(payload.content, longBody, "载荷正文必须是提交原文（首尾空白按既有 content 口径归一）");
  assert.equal(
    executionConfig.content,
    payload.content,
    "正文与会话消息读的是同一份：两份不一致，事件就会与 ai_sessions 逐字节对不上",
  );
  assert.equal(queued.title, longBody.slice(0, 80), "title 仍是 80 字标题，本批不改它的语义");
  assert.notEqual(payload.content, queued.title, "正文长度明显超过 title，两者相等即为「从 title 抄」的回归");

  // 批次 2b-2：信封四要素齐备，且身份字段来自**随 Run 持久化**的那份（重放要读回它）
  assert.equal(payload.role, "user");
  assert.deepEqual(payload.attachmentIds, [], "attachmentIds 恒在（无附件为空数组）");
  assert.equal(payload.messageId, executionConfig.conversationFact?.userMessage?.messageId, "messageId 取自持久化信封");
  assert.equal(payload.createdAt, executionConfig.conversationFact?.userMessage?.createdAt, "createdAt 取自持久化信封");
  assert.ok(
    String(payload.createdAt).length > 0 && String(payload.messageId).startsWith("msg-"),
    "信封身份必须是提交时刻 mint 的正式 id",
  );
  assert.deepEqual(
    (payload.metadata as { projectionSource?: unknown }).projectionSource,
    { deduplicationKey: "run-fixture-1:user:1", runId: "run-fixture-1", eventType: "user_message" },
    "runId 由仓储在入队事务内给出，载荷的来源键必须跟着它走",
  );
});

test("批次2b-1: retryRun 从原 Run 带出正文，重试出的新 Run 同样有用户正文", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);
  const body = "会失败的那一轮正文，重试后仍要能在事件流里读到";
  const submitted = await usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: body });
  const run = deps.repo.runs.find((item: Record<string, unknown>) => item.harnessRunId === submitted.data.runId);
  if (run) {
    run.status = "failed";
    run.errorCode = "WORKER_STEP_FAILED";
  }

  await usecase.retryRun(user, submitted.data.runId);
  const retryQueued = deps.repo.queuedInputs[1];
  const retryPayload = queuedUserMessageFact(retryQueued, "run-retry-1");
  assert.equal(retryPayload.content, body, "retry 提交的仍是同一轮用户正文，不得因换个 Run 就丢掉");

  // 批次 2b-2：重试是新一轮会话消息，信封**必须重新 mint**。复用原 Run 的 messageId
  // 会让会话里两条用户消息同 id——那比「同正文重复两轮」更难查（看板 risks-5）。
  const originalPayload = queuedUserMessageFact(deps.repo.queuedInputs[0], "run-original-1");
  assert.notEqual(
    retryPayload.messageId,
    originalPayload.messageId,
    "retry 必须另起 messageId，否则会话里两条消息按 id 分不清",
  );
  // createdAt **不断言不等**：两次 mint 可能落在同一毫秒（实取 2026-09-11 同一秒内
  // 两条 ISO 完全相同），那是时钟分辨率而非本批要保证的性质，写成不等会偶发误红。
  // 这里要钉的是「各自的 createdAt 来自各自的信封」，由上面 messageId 那条覆盖。
  const retryFact = (retryQueued.executionConfig as { conversationFact?: { userMessage?: { createdAt?: string } } })
    .conversationFact?.userMessage;
  assert.equal(retryPayload.createdAt, retryFact?.createdAt, "重试轮的 createdAt 取自重试时新 mint 的信封");
  assert.deepEqual(
    (retryPayload.metadata as { projectionSource?: { deduplicationKey?: string } }).projectionSource
      ?.deduplicationKey,
    "run-retry-1:user:1",
    "来源键按各自 Run 构造（会话侧正是靠它吸收/区分）",
  );
});

test("批次2b-1: 正文超事件载荷闸门时映射为 422 校验错误，不是不透明的 500", async () => {
  const deps = makeDeps({}, { failWithPayloadTooLarge: true });
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  await assert.rejects(
    usecase.submitRun(user, session.sessionId, { submissionKey: randomUUID(), content: "x".repeat(1024 * 1024) }),
    (err: unknown) => {
      assert.ok(err instanceof AiRunsValidationError, `应为 AiRunsValidationError(422)，实为 ${String(err)}`);
      assert.match(err.message, /正文/, "报错要点名是「正文」出问题，而不是笼统的提交失败");
      assert.match(err.message, /载荷上限/, "要说清触发了事件载荷上限");
      assert.match(err.message, /回滚/, "要说明本次提交整体回滚（没有半提交的 Run）");
      return true;
    },
  );
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
