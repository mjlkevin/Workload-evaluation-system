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

/** 不关心流式事件的用例使用的 no-op dep（ISS-2026-08-10-004 层 2 接线后 deps 必填）。 */
function makeNoOpAppendRunEvent(): WorkbenchChatWorkflowDeps["appendRunEvent"] {
  return async (input) => input;
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
  const wf = createWorkbenchChatWorkflow({ dispatch: async () => ({ answer: "ok" } as any), appendSessionMessage: makeNoOpAppendSessionMessage(), appendRunEvent: makeNoOpAppendRunEvent() });
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
    appendRunEvent: makeNoOpAppendRunEvent(),
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
    appendRunEvent: makeNoOpAppendRunEvent(),
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
    appendRunEvent: makeNoOpAppendRunEvent(),
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
    appendRunEvent: makeNoOpAppendRunEvent(),
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
      appendRunEvent: makeNoOpAppendRunEvent(),
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

// ============================================================
// ISS-2026-08-10-004（层 2：异步通道接入流式事件）RED 守护
// ============================================================
// 根因：异步 worker 调 deps.dispatch 未传 streamingAdapter，run 事件流
// 从无 text.delta/thought → 前端订阅建立也无逐字/思考内容。
// 修复契约：execute 内 dispatch 入参携带 streamingAdapter；onToken 逐 chunk
// 经 deps.appendRunEvent 写事件——contentDelta → text.delta（payload.delta），
// reasoningContentDelta → thought（payload.text）；onComplete/onError 不写事件
// （终态事件由 runtime 既有链路发射）。

test("ISS-004 层 2：dispatch 入参携带 streamingAdapter，onToken 逐 chunk 写 text.delta/thought 事件", async () => {
  const appended: Array<{ runId: string; eventType: string; payload: Record<string, unknown> }> = [];
  let seenAdapter: { onToken: (chunk: Record<string, unknown>) => void } | undefined;

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      seenAdapter = input.streamingAdapter as typeof seenAdapter;
      // 模拟生产模型流式路径回调（model-answer 在 adapter + modelChatStream 齐备时逐 chunk 触发）
      input.streamingAdapter?.onToken({ contentDelta: "你好", reasoningContentDelta: "" });
      input.streamingAdapter?.onToken({ contentDelta: "", reasoningContentDelta: "先拆解问题" });
      input.streamingAdapter?.onToken({ contentDelta: "世界" });
      return {
        intent: "domain_qa",
        answer: "你好世界",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: async (event) => {
      appended.push(event as (typeof appended)[number]);
      return event;
    },
  });

  await wf.executeStep("chat", makeFakeCtx());

  assert.ok(seenAdapter, "dispatch 入参必须携带 streamingAdapter（异步通道逐字流式前提）");
  assert.deepEqual(
    appended.map((event) => [event.runId, event.eventType, event.payload]),
    [
      ["run-1", "text.delta", { delta: "你好" }],
      ["run-1", "thought", { text: "先拆解问题" }],
      ["run-1", "text.delta", { delta: "世界" }],
    ],
    "contentDelta → text.delta(payload.delta)，reasoningContentDelta → thought(payload.text)，空增量不写事件",
  );
});

test("ISS-004 层 2：恢复重放跳过 execute，流式事件不重复发射（幂等天然成立）", async () => {
  const appended: Array<{ runId: string; eventType: string; payload: Record<string, unknown> }> = [];
  const recordedEffects: string[] = [];

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.streamingAdapter?.onToken({ contentDelta: "逐字" });
      return {
        intent: "domain_qa",
        answer: "逐字",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: async (event) => {
      appended.push(event as (typeof appended)[number]);
      return event;
    },
  });

  const recordToolEffectOnce = async (effect: FakeEffect) => {
    if (recordedEffects.includes(effect.effectKey)) {
      return { output: { answer: "cached" }, created: false };
    }
    recordedEffects.push(effect.effectKey);
    const output = await effect.execute();
    return { output, created: true };
  };
  const ctx = makeFakeCtx({ recordToolEffectOnce: recordToolEffectOnce as any });

  await wf.executeStep("chat", ctx);
  assert.equal(appended.length, 1, "首次执行发射 1 条 text.delta");

  // 恢复重放：recordToolEffectOnce 命中缓存跳过 execute，流式副作用不得重放
  await wf.executeStep("chat", ctx);
  assert.equal(appended.length, 1, "恢复重放不得重复发射流式事件");
});
