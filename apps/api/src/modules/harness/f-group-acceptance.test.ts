/**
 * Step 4 F 组验收（RP-047 Batch E）· S3B1 瘦身后仅保留 F4。
 * S3B1（2026-09-01，台账 B4 分诊）：本文件零引用接入 test:harness 前逐条裁决——
 *  - F1（提交后 listActiveRuns > 0）：与 harness-runtime.usecase.test.ts:354
 *    「listActiveRuns only returns the caller's own active runs」重复 → 删；
 *  - F2（三色通知事件流）：与 harness-runtime.usecase.test.ts:203（202 payload
 *    queued status + eventCursor）重叠 → 删；
 *  - F3（回页水合幂等）：L292-311 自写 appendMessages 闭包模拟水合，被测实现
 *    完全不参与，属 §4.11 A-3 假绿；真实水合/去重语义已由
 *    workbench-chat.workflow.test.ts:187（recordToolEffectOnce 幂等）与 :829
 *    （重放语义）覆盖 → 删；
 *  - F4（同会话活跃 run 二次提交 409）：usecase 层无等价用例（routes 层
 *    ai-runs.routes.test.ts:446 是 delete session 的 409，非 submitRun）→ 保留。
 * 常驻回归资产：同会话活跃 run 期间二次提交 → 409 SESSION_HAS_ACTIVE_RUN。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import type { AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import { HarnessRuntimeError } from "./harness-runtime.repository";
import {
  AiRunsConflictError,
  createAiRunsUsecase,
  type AiRunsUsecaseDeps,
} from "./harness-runtime.usecase";

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const id = randomUUID();
  return {
    id,
    username: `f-group-${id}`,
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
    title: "F组测试会话",
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

function makeFakeRepo() {
  const runs: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const repo = {
    calls,
    runs,
    events,
    async createQueuedRun(input: Record<string, unknown>) {
      bump("createQueuedRun");
      const replayed = runs.find((run) => run.ownerUserId === input.ownerUserId && run.submissionKey === input.submissionKey);
      if (replayed) return { run: replayed, created: false };
      const activeStatuses = ["queued", "running", "waiting", "recovering", "cancelling"];
      const hasActive = runs.some((run) =>
        run.aiSessionId === input.aiSessionId &&
        activeStatuses.includes(String(run.status))
      );
      if (hasActive) {
        throw new HarnessRuntimeError("ACTIVE_WORKBENCH_RUN_EXISTS", "active workbench run already exists for this ai session");
      }
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
      events.push({
        harnessEventId: randomUUID(),
        harnessRunId: run.harnessRunId,
        sequence: 1,
        eventType: "run_queued",
        payload: { status: "queued" },
        createdAt: new Date().toISOString(),
      });
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
      const runEvents = events.filter((e) => e.harnessRunId === runId).sort((a, b) => Number(a.sequence) - Number(b.sequence));
      return { run, events: runEvents, attempt: null, checkpoint: null, output: null };
    },
    async hasActiveRunForSession(aiSessionId: string) {
      bump("hasActiveRunForSession");
      return runs.some((run) => run.aiSessionId === aiSessionId && ["queued", "running", "waiting", "recovering", "cancelling"].includes(String(run.status)));
    },
    async listRunEventsAfter(runId: string, after: number) {
      return events
        .filter((e) => e.harnessRunId === runId && Number(e.sequence) > after)
        .sort((a, b) => Number(a.sequence) - Number(b.sequence));
    },
    async appendRunEvent(input: { runId: string; sequence: number; eventType: string; payload: unknown }) {
      bump("appendRunEvent");
      events.push({
        harnessEventId: randomUUID(),
        harnessRunId: input.runId,
        sequence: input.sequence,
        eventType: input.eventType,
        payload: input.payload,
        createdAt: new Date().toISOString(),
      });
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
// F4: 同会话活跃 run 期间二次提交 → 409 SESSION_HAS_ACTIVE_RUN
// ----------------------------------------------------------------

test("f-group: F4 同会话活跃 run 期间二次提交返回 409 SESSION_HAS_ACTIVE_RUN", async () => {
  const deps = makeDeps();
  const user = makeUser();
  const session = makeSession(user);
  deps.sessions.set(session.sessionId, session);
  const usecase = createAiRunsUsecase(deps);

  const first = await usecase.submitRun(user, session.sessionId, {
    submissionKey: randomUUID(),
    content: "第一次提交",
  });
  assert.equal(first.status, 202);

  await assert.rejects(
    usecase.submitRun(user, session.sessionId, {
      submissionKey: randomUUID(),
      content: "第二次提交",
    }),
    (err: unknown) =>
      err instanceof AiRunsConflictError &&
      (err as { status?: number }).status === 409 &&
      (err as { code?: string }).code === "SESSION_HAS_ACTIVE_RUN",
    "同会话活跃 run 期间二次提交必须返回 409 SESSION_HAS_ACTIVE_RUN"
  );
});
