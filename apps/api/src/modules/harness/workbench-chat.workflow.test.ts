/**
 * Step 1 Workflow 适配器守护测试（RP-047 Batch E）。
 * 常驻回归资产：workbench_chat_v1@1.0.0 workflow——
 * 1) 从 executionConfig.content 取输入，复用 dispatch 链路；
 * 2) AI 调用经 recordToolEffectOnce 幂等（重复执行同 step 不产生第二次 AI 调用）；
 * 3) 结果经 outbox 投递 assistant 消息（deduplicationKey = ${runId}:assistant:1）；
 * 4)（Batch E 二次返工 · 新通道消息落库双缺陷修复）outbox payload 携带
 *    projector 契约的 message 字段；用户消息在 dispatch 前幂等落库。
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkbenchChatWorkflow, type WorkbenchChatWorkflowDeps } from "./workbench-chat.workflow";
import type { HarnessWorkflowStepContext } from "./harness-runtime.worker";
import {
  appendAiSessionMessageIdempotent,
  type AppendAiSessionMessageIdempotentInput,
} from "../ai-sessions/ai-sessions.repository";
import type { AiSessionsStore } from "../ai-sessions/ai-sessions.types";

/** 临时目录会话存储（不触碰真实 data/config）：供 C2 用户消息落库用例使用。 */
function makeTempSessionStore(sessionId: string, ownerUserId: string): { storePath: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), "wes-workflow-test-"));
  const storePath = path.join(dir, "ai-sessions.json");
  const store: AiSessionsStore = {
    sessions: [
      {
        sessionId,
        ownerUserId,
        ownerUsername: "workflow-tester",
        title: "workflow 测试会话",
        domain: "business_evaluation",
        workflowKey: "home_workbench",
        businessRole: "pm",
        status: "temporary_chat",
        summary: "",
        messages: [],
        attachments: [],
        artifacts: [],
        pendingActions: [],
        linkedRecords: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  return {
    storePath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function readStoreFile(storePath: string): AiSessionsStore {
  return JSON.parse(readFileSync(storePath, "utf-8")) as AiSessionsStore;
}

/** 不关心用户消息落库的用例使用的 no-op dep。 */
function makeNoOpAppendSessionMessage(): WorkbenchChatWorkflowDeps["appendSessionMessage"] {
  return (input) => ({ found: true, created: false, message: input.message });
}

type FakeEffect = {
  effectKey: string;
  toolName: string;
  input: Record<string, unknown>;
  execute: () => Promise<Record<string, unknown>>;
};

function makeFakeCtx(overrides: {
  run?: Partial<HarnessWorkflowStepContext["run"]>;
  recordToolEffectOnce?: HarnessWorkflowStepContext["recordToolEffectOnce"];
} = {}): HarnessWorkflowStepContext {
  const run = {
    harnessRunId: "run-1",
    ownerUserId: "user-1",
    ownerUsername: "alice",
    aiSessionId: "session-1",
    submissionKey: "sub-1",
    title: "测试",
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
    executionConfig: { content: "你好" },
    status: "running",
    eventSequence: 1,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides.run,
  } as HarnessWorkflowStepContext["run"];

  const effects: FakeEffect[] = [];

  return {
    run,
    attempt: {
      harnessRunAttemptId: "attempt-1",
      harnessRunId: "run-1",
      workerId: "worker-1",
      attemptNo: 1,
      status: "claimed",
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as HarnessWorkflowStepContext["attempt"],
    stepKey: "chat",
    state: {},
    resumeFrom: null,
    abortSignal: new AbortController().signal,
    makeEffectKey: (effectName, ordinal) => `run-1:chat:${effectName}:${ordinal}`,
    recordToolEffectOnce: overrides.recordToolEffectOnce ?? (async (effect) => {
      effects.push(effect);
      const output = await effect.execute();
      return { output, created: true };
    }),
  };
}

test("workbench_chat_v1 workflow 元数据冻结", () => {
  const wf = createWorkbenchChatWorkflow({ dispatch: async () => ({ answer: "ok" } as any), appendSessionMessage: makeNoOpAppendSessionMessage() });
  assert.equal(wf.workflowId, "workbench_chat_v1");
  assert.equal(wf.workflowVersion, "1.0.0");
  assert.equal(wf.firstStepKey, "chat");
  assert.deepEqual(wf.stepKeys, ["chat"]);
});

test("executeStep 从 executionConfig.content 取输入并 dispatch", async () => {
  let dispatchedContent = "";
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      dispatchedContent = input.message;
      return {
        intent: "domain_qa",
        answer: "模型回复",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
  });

  const ctx = makeFakeCtx();
  const outcome = await wf.executeStep("chat", ctx);

  assert.equal(dispatchedContent, "你好");
  assert.equal(outcome.nextStepKey, null, "单步 workflow 执行后应到达终态");
  assert.ok(outcome.outbox);
  assert.equal(outcome.outbox!.length, 1);
  assert.equal(outcome.outbox![0].eventType, "assistant_message");
  assert.equal(outcome.outbox![0].payload.answer, "模型回复");
});

test("recordToolEffectOnce 幂等：重复执行不产生第二次 AI 调用", async () => {
  let callCount = 0;
  const recordedEffects: string[] = [];

  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      intent: "domain_qa",
      answer: "ok",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      suggestedActions: [],
      trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
    } as any),
    appendSessionMessage: makeNoOpAppendSessionMessage(),
  });

  const recordToolEffectOnce = async (effect: FakeEffect) => {
    const key = effect.effectKey;
    if (recordedEffects.includes(key)) {
      return { output: { answer: "cached" }, created: false };
    }
    recordedEffects.push(key);
    callCount += 1;
    const output = await effect.execute();
    return { output, created: true };
  };

  const ctx = makeFakeCtx({ recordToolEffectOnce: recordToolEffectOnce as any });

  // 第一次执行
  await wf.executeStep("chat", ctx);
  assert.equal(callCount, 1);

  // 第二次执行（模拟恢复后重跑同 step）
  await wf.executeStep("chat", ctx);
  assert.equal(callCount, 1, "幂等性保证：第二次不应触发新的 AI 调用");
});

test("outbox deduplicationKey 冻结为 ${runId}:assistant:1", async () => {
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      intent: "domain_qa",
      answer: "hi",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      suggestedActions: [],
      trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
    } as any),
    appendSessionMessage: makeNoOpAppendSessionMessage(),
  });

  const ctx = makeFakeCtx();
  const outcome = await wf.executeStep("chat", ctx);

  assert.equal(outcome.outbox![0].deduplicationKey, "run-1:assistant:1");
});

// ============================================================
// Batch E 二次返工（新通道消息落库双缺陷修复）RED 守护
// ============================================================

test("C1 缺陷 A：outbox payload 携带 projector 契约 message（内容非空且与 answer 一致）", async () => {
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () =>
      ({
        intent: "domain_qa",
        answer: "利润中心是承担损益责任的组织单元",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      }) as any,
    appendSessionMessage: makeNoOpAppendSessionMessage(),
  });

  const outcome = await wf.executeStep("chat", makeFakeCtx());
  const payload = outcome.outbox![0].payload as {
    message?: { role: string; content: string };
    answer?: string;
    intent?: string;
  };

  assert.ok(payload.message, "outbox payload 必须携带 projector 契约的 message 字段（缺陷 A）");
  assert.equal(payload.message!.role, "assistant");
  assert.equal(
    payload.message!.content,
    "利润中心是承担损益责任的组织单元",
    "message.content 必须与 answer 一致，不得落成空消息",
  );
  // 既有键保留（G-E3 口径不回退）
  assert.equal(payload.answer, "利润中心是承担损益责任的组织单元");
  assert.equal(payload.intent, "domain_qa");
});

test("C2 缺陷 B：用户消息在 dispatch 前幂等落库，恢复重放不重复", async () => {
  // makeFakeCtx 默认 run：aiSessionId=session-1 / ownerUserId=user-1 / harnessRunId=run-1
  const { storePath, cleanup } = makeTempSessionStore("session-1", "user-1");
  try {
    const sequence: string[] = [];
    const wf = createWorkbenchChatWorkflow({
      dispatch: async () => {
        sequence.push("dispatch");
        return {
          intent: "domain_qa",
          answer: "ok",
          businessRole: "pre_sales",
          roleLabel: "售前顾问",
          suggestedActions: [],
          trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
        } as any;
      },
      appendSessionMessage: (input) => {
        sequence.push("append-user");
        return appendAiSessionMessageIdempotent({ ...input, storePath });
      },
    });

    const ctx = makeFakeCtx();
    await wf.executeStep("chat", ctx);

    let store = readStoreFile(storePath);
    assert.equal(store.sessions[0].messages.length, 1, "执行后可从会话存储读到本轮 user 消息（缺陷 B）");
    assert.equal(store.sessions[0].messages[0].role, "user");
    assert.equal(store.sessions[0].messages[0].content, "你好");
    const metadata = store.sessions[0].messages[0].metadata as { projectionSource?: { deduplicationKey?: string } };
    assert.equal(metadata.projectionSource?.deduplicationKey, "run-1:user:1", "来源键冻结为 run 维度 deduplicationKey");
    assert.deepEqual(sequence, ["append-user", "dispatch"], "用户消息必须先于 dispatch 落库");

    // 恢复重放：同 step 再执行一次，来源键去重吸收
    await wf.executeStep("chat", ctx);
    store = readStoreFile(storePath);
    assert.equal(store.sessions[0].messages.length, 1, "重复执行不得产生重复用户消息");
  } finally {
    cleanup();
  }
});
