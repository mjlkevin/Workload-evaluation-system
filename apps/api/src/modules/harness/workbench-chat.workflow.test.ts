/**
 * Step 1 Workflow 适配器守护测试（RP-047 Batch E）。
 * 常驻回归资产：workbench_chat_v1@1.0.0 workflow——
 * 1) 从 executionConfig.content 取输入，复用 dispatch 链路；
 * 2) AI 调用经 recordToolEffectOnce 幂等（重复执行同 step 不产生第二次 AI 调用）；
 * 3) 结果经 outbox 投递 assistant 消息（deduplicationKey = ${runId}:assistant:1）。
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createWorkbenchChatWorkflow } from "./workbench-chat.workflow";
import type { HarnessWorkflowStepContext } from "./harness-runtime.worker";

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
  const wf = createWorkbenchChatWorkflow({ dispatch: async () => ({ answer: "ok" } as any) });
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
  });

  const ctx = makeFakeCtx();
  const outcome = await wf.executeStep("chat", ctx);

  assert.equal(outcome.outbox![0].deduplicationKey, "run-1:assistant:1");
});
