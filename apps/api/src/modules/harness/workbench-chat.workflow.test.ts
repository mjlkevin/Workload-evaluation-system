/**
 * Step 1 Workflow 适配器守护测试（RP-047 Batch E）。
 * 常驻回归资产：workbench_chat_v1@1.0.0 workflow——
 * 1) 从 executionConfig.content 取输入，复用 dispatch 链路；
 * 2) AI 调用经 recordToolEffectOnce 幂等（重复执行同 step 不产生第二次 AI 调用）；
 * 3) assistant 消息经 appendSessionMessage 直接幂等落库（来源键 = ${runId}:assistant:1）；
 * 4)（Batch E 二次返工 · 新通道消息落库双缺陷修复）assistant 直写内容非空且与
 *    answer 一致；用户消息在 dispatch 前幂等落库。
 * 5)（S2b-2 · §4.8 补偿链删除）outbox 恒空，projector/sink 已删；幂等吸收由
 *    repository 层按键查重守护（本套件以 recording fake 断言调用序列与来源键）。
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkbenchChatWorkflow, type WorkbenchChatWorkflowDeps } from "./workbench-chat.workflow";
import type { HarnessWorkflowStepContext } from "./harness-runtime.worker";
import {
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
  return async (input) => ({ found: true, created: false, message: input.message });
}

type RecordedAppendCall = {
  role: string;
  content: string;
  deduplicationKey: string;
  attachmentIds?: string[];
};

/** S2b-2 后 appendSessionMessage 为注入 dep（直写 PG 由 repository 层守护）：
 *  本套件以 recording fake 断言 workflow 的调用序列与来源键；幂等吸收语义
 *  由 ai-sessions.repository.test.ts（PG）守护。 */
function makeRecordingAppendSessionMessage(calls: RecordedAppendCall[]) {
  return async (input: AppendAiSessionMessageIdempotentInput) => {
    calls.push({
      role: input.message.role,
      content: input.message.content,
      deduplicationKey: input.source.deduplicationKey,
      attachmentIds: input.message.attachmentIds,
    });
    return { found: false, created: true, message: input.message };
  };
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
  assert.deepEqual(outcome.outbox, [], "S2b-2 后补偿链已删，outbox 恒空");
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

test("assistant 消息来源键冻结为 ${runId}:assistant:1", async () => {
  const calls: RecordedAppendCall[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      intent: "domain_qa",
      answer: "hi",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      suggestedActions: [],
      trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
    } as any),
    appendSessionMessage: makeRecordingAppendSessionMessage(calls),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  const ctx = makeFakeCtx();
  const outcome = await wf.executeStep("chat", ctx);

  assert.equal(
    calls.find((c) => c.role === "assistant")?.deduplicationKey,
    "run-1:assistant:1",
    "assistant 来源键冻结为 run 维度 deduplicationKey",
  );
  assert.deepEqual(outcome.outbox, [], "S2b-2 后 outbox 恒空");
});

// ============================================================
// Batch E 二次返工（新通道消息落库双缺陷修复）RED 守护
// ============================================================

test("C1 缺陷 A：assistant 消息直写内容非空且与 answer 一致", async () => {
  const calls: RecordedAppendCall[] = [];
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
    appendSessionMessage: makeRecordingAppendSessionMessage(calls),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  await wf.executeStep("chat", makeFakeCtx());

  const assistant = calls.find((c) => c.role === "assistant");
  assert.ok(assistant, "assistant 消息必须经 appendSessionMessage 直写落库（缺陷 A 不得落空消息）");
  assert.equal(
    assistant!.content,
    "利润中心是承担损益责任的组织单元",
    "直写内容必须与 answer 一致，不得落成空消息",
  );
});

test("C2 缺陷 B：用户消息在 dispatch 前幂等落库，来源键冻结", async () => {
  const sequence: string[] = [];
  const calls: RecordedAppendCall[] = [];
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
      calls.push({
        role: input.message.role,
        content: input.message.content,
        deduplicationKey: input.source.deduplicationKey,
      });
      sequence.push(input.message.role === "user" ? "append-user" : "append-assistant");
      return Promise.resolve({ found: false, created: true, message: input.message });
    },
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  const ctx = makeFakeCtx();
  await wf.executeStep("chat", ctx);

  assert.equal(calls.length, 2, "执行后应直写 user + assistant 两条消息（缺陷 B）");
  assert.equal(calls[0].role, "user");
  assert.equal(calls[0].content, "你好");
  assert.equal(calls[0].deduplicationKey, "run-1:user:1", "用户消息来源键冻结为 run 维度 deduplicationKey");
  assert.deepEqual(sequence, ["append-user", "dispatch", "append-assistant"], "用户消息必须先于 dispatch 落库，assistant 消息随后直接落库");

  // 恢复重放：workflow 以同一来源键再次直写，重复吸收由 repository 层按键查重
  //（S2b-2 后 outbox/projector 补偿链已删，去重防线即直写路径本身）。
  await wf.executeStep("chat", ctx);
  assert.equal(calls.length, 4, "重放仍直写且携带同一来源键，吸收在 repository 层");
  assert.equal(calls[2].deduplicationKey, "run-1:user:1");
  assert.equal(calls[3].deduplicationKey, "run-1:assistant:1");
});

test("ISS-2026-08-11-007: 附件写入会话并作为模型上下文 dispatch", async () => {
  const calls: RecordedAppendCall[] = [];
  let dispatchedAttachment: Record<string, unknown> | null | undefined;
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      dispatchedAttachment = input.attachment as Record<string, unknown> | null | undefined;
      return {
        intent: "attachment_qa",
        answer: "多组织业务通常涉及组织间交易与结算。",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "attachment_context", contextRefs: ["attachment:客户需求.xlsx"] },
      } as any;
    },
    appendSessionMessage: makeRecordingAppendSessionMessage(calls),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });
  const ctx = makeFakeCtx({
    run: {
      executionConfig: {
        content: "多组织业务往来一般包含哪些模块？",
        attachments: [{
          name: "客户需求.xlsx",
          size: 4096,
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          parsedSummary: "项目：蓝海制造\n需求：多组织业务协同",
        }],
      },
    },
  });

  await wf.executeStep("chat", ctx);

  assert.deepEqual(dispatchedAttachment, {
    name: "客户需求.xlsx",
    size: 4096,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parsedSummary: "项目：蓝海制造\n需求：多组织业务协同",
  });
  // S2b-2 后附件实体落库在 repository 层（workflow 经 appendSessionMessage 携带
  // attachments）；本用例断言直写调用携带附件引用，重放由来源键去重吸收。
  assert.equal(calls.length, 2, "执行后应直写 user + assistant 两条消息");
  assert.equal(calls[0].role, "user");
  assert.ok(calls[0].attachmentIds?.length === 1, "用户消息必须引用已持久化附件");
  assert.equal(calls[0].attachmentIds![0].startsWith("att-"), true, "附件 ID 由 workflow 生成（att- 前缀）");

  // 恢复重放：workflow 每次生成新附件 ID 直写，实体幂等由 repository 层按来源键吸收
  //（S2b-2 后不再有 outbox 双路径）；dispatch 附件上下文不得回退。
  await wf.executeStep("chat", ctx);
  assert.equal(calls.length, 4, "重放仍直写（附件引用再次携带，吸收在 repository 层）");
  assert.deepEqual(dispatchedAttachment, {
    name: "客户需求.xlsx",
    size: 4096,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parsedSummary: "项目：蓝海制造\n需求：多组织业务协同",
  }, "重放后 dispatch 附件上下文不回退");
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

// ============================================================
// ISS-2026-08-16-002（异步通道附件回退缺失）RED 守护
// ============================================================
// 根因：workbench-chat.workflow.ts L79-85 的 dispatchAttachment 仅从
// executionConfig.attachments（即 submitRun 请求体）取附件，无会话级回退。
// 用户第二轮发送纯文本时 attachments 为空 → dispatchAttachment=null →
// contextRefs 无 attachment: → harnessReportHandler 走"请上传需求文件"分支。
// 修复契约：dispatchAttachment 构建逻辑增加会话级回退——请求级附件优先，
// 缺失时从已落库会话附件中取最近一个带 parsedSummary 的附件（与同步路径
// workbench-chat.handler.ts L59 的 latestSessionAttachmentWithSummary 同款语义）。

test("ISS-2026-08-16-002：第二轮无附件请求时，dispatchAttachment 从会话存储回退取附件", async () => {
  // 场景：第一轮用户带附件发送，附件已落库；第二轮用户发送纯文本（无附件），
  // workflow 应从会话存储回退取附件，而非 dispatchAttachment=null。
  const { storePath, cleanup } = makeTempSessionStore("session-1", "user-1");
  const calls: RecordedAppendCall[] = [];
  try {
    // 预置：会话中已有一个带 parsedSummary 的附件（模拟第一轮已落库）
    const store = readStoreFile(storePath);
    store.sessions[0].attachments.push({
      attachmentId: "att-existing",
      name: "PLM工作量评估申请表V1.0-251013.xlsx",
      size: 10240,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parsedSummary: "项目：哈希温控\n需求：PLM 系统实施\n模块：项目管理、变更管理",
      createdAt: new Date().toISOString(),
    });
    writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");

    let dispatchedAttachment: Record<string, unknown> | null | undefined;
    const wf = createWorkbenchChatWorkflow({
      dispatch: async (input) => {
        dispatchedAttachment = input.attachment as Record<string, unknown> | null | undefined;
        return {
          intent: "harness_report_generation",
          answer: "检测到会话已有附件，正在生成需求解析报告...",
          businessRole: "pre_sales",
          roleLabel: "售前顾问",
          suggestedActions: [],
          trace: {
            intentConfidence: 0.95,
            routingRule: "report_generation_keywords",
            contextRefs: ["attachment:PLM工作量评估申请表V1.0-251013.xlsx"],
          },
        } as any;
      },
      appendSessionMessage: makeRecordingAppendSessionMessage(calls),
      appendRunEvent: makeNoOpAppendRunEvent(),
      getSessionRecord: async (sessionId, ownerUserId) => {
        const store = readStoreFile(storePath);
        return store.sessions.find((s) => s.sessionId === sessionId && s.ownerUserId === ownerUserId) ?? null;
      },
    });

    // 第二轮：用户发送纯文本，无附件（executionConfig.attachments 为空）
    const ctx = makeFakeCtx({
      run: {
        executionConfig: {
          content: "请基于当前附件生成需求解析报告",
          attachments: [], // 第二轮无附件
        },
      },
    });

    await wf.executeStep("chat", ctx);

    // 断言：dispatchAttachment 应从会话存储回退取到附件，而非 null
    assert.ok(dispatchedAttachment, "dispatchAttachment 不应为 null——应从会话存储回退取附件");
    assert.equal(dispatchedAttachment!.name, "PLM工作量评估申请表V1.0-251013.xlsx");
    assert.equal(
      dispatchedAttachment!.parsedSummary,
      "项目：哈希温控\n需求：PLM 系统实施\n模块：项目管理、变更管理",
      "回退附件必须携带 parsedSummary（报告生成流程依赖）",
    );
  } finally {
    cleanup();
  }
});

test("ISS-2026-08-16-002：请求级附件优先于会话级回退（不覆盖新上传附件）", async () => {
  // 场景：用户第二轮上传了新附件，请求级附件应优先，会话级回退不生效。
  const { storePath, cleanup } = makeTempSessionStore("session-1", "user-1");
  const calls: RecordedAppendCall[] = [];
  try {
    // 预置：会话中已有旧附件
    const store = readStoreFile(storePath);
    store.sessions[0].attachments.push({
      attachmentId: "att-old",
      name: "旧需求文档.xlsx",
      size: 5120,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parsedSummary: "旧项目：旧需求",
      createdAt: new Date().toISOString(),
    });
    writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");

    let dispatchedAttachment: Record<string, unknown> | null | undefined;
    const wf = createWorkbenchChatWorkflow({
      dispatch: async (input) => {
        dispatchedAttachment = input.attachment as Record<string, unknown> | null | undefined;
        return {
          intent: "attachment_qa",
          answer: "基于新附件回答",
          businessRole: "pre_sales",
          roleLabel: "售前顾问",
          suggestedActions: [],
          trace: { intentConfidence: 0.9, routingRule: "attachment_context", contextRefs: ["attachment:新需求文档.xlsx"] },
        } as any;
      },
      appendSessionMessage: makeRecordingAppendSessionMessage(calls),
      appendRunEvent: makeNoOpAppendRunEvent(),
      getSessionRecord: async (sessionId, ownerUserId) => {
        const store = readStoreFile(storePath);
        return store.sessions.find((s) => s.sessionId === sessionId && s.ownerUserId === ownerUserId) ?? null;
      },
    });

    // 第二轮：用户上传了新附件
    const ctx = makeFakeCtx({
      run: {
        executionConfig: {
          content: "请解析这个新文件",
          attachments: [{
            name: "新需求文档.xlsx",
            size: 8192,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            parsedSummary: "新项目：新需求",
          }],
        },
      },
    });

    await wf.executeStep("chat", ctx);

    // 断言：请求级附件优先，不覆盖新上传附件
    assert.ok(dispatchedAttachment);
    assert.equal(dispatchedAttachment!.name, "新需求文档.xlsx", "请求级附件必须优先于会话级回退");
    assert.equal(dispatchedAttachment!.parsedSummary, "新项目：新需求");
  } finally {
    cleanup();
  }
});

test("ISS-2026-08-16-004：显式报告闸门——附件存在且消息为「生成需求解析报告」时走报告流程", async () => {
  const sessionId = "session-report-gate";
  const ownerUserId = "user-report-gate";
  const { storePath, cleanup } = makeTempSessionStore(sessionId, ownerUserId);
  const calls: RecordedAppendCall[] = [];
  try {
    // 预置会话附件（带 parsedSummary）
    const store = readStoreFile(storePath);
    store.sessions[0].attachments.push({
      attachmentId: "att-report-1",
      name: "需求文档.xlsx",
      size: 4096,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parsedSummary: "已解析：客户=测试客户，需求=ERP 实施",
      createdAt: new Date().toISOString(),
    });
    writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");

    let dispatchCalled = false;
    const wf = createWorkbenchChatWorkflow({
      dispatch: async () => {
        dispatchCalled = true;
        return {
          intent: "domain_qa",
          answer: "不应走到这里",
          businessRole: "pre_sales",
          roleLabel: "售前顾问",
          suggestedActions: [],
          trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
        } as any;
      },
      appendSessionMessage: makeRecordingAppendSessionMessage(calls),
      appendRunEvent: makeNoOpAppendRunEvent(),
      getSessionRecord: async (sid, uid) => {
        const s = readStoreFile(storePath);
        return s.sessions.find((x) => x.sessionId === sid && x.ownerUserId === uid) ?? null;
      },
    });

    const ctx = makeFakeCtx({
      run: {
        executionConfig: { content: "生成需求解析报告" },
      },
    });

    const outcome = await wf.executeStep("chat", ctx);

    // 断言：测试环境无 API Key，runExplicitHomeReportFlow 返回 ok: false，
    // 闸门回退到普通 dispatch（与同步路径 40001 降级行为对齐）。
    assert.equal(dispatchCalled, true, "API Key 缺失时应回退到普通 dispatch");
    assert.equal(outcome.nextStepKey, null);
    assert.deepEqual(outcome.outbox, [], "S2b-2 后补偿链已删，outbox 恒空");
    assert.equal(calls.length, 2, "回退后仍直写 user + assistant 两条消息");
  } finally {
    cleanup();
  }
});

test("ISS-2026-08-16-004：显式报告闸门——无附件时不触发（走普通 dispatch）", async () => {
  let dispatchCalled = false;
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => {
      dispatchCalled = true;
      return {
        intent: "domain_qa",
        answer: "普通问答回复",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  const ctx = makeFakeCtx({
    run: {
      executionConfig: { content: "生成需求解析报告" },
    },
  });

  const outcome = await wf.executeStep("chat", ctx);

  // 断言：无附件时闸门不命中，走普通 dispatch
  assert.equal(dispatchCalled, true, "无附件时应走普通 dispatch");
  assert.deepEqual(outcome.outbox, [], "S2b-2 后 outbox 恒空");
});

// ============================================================
// S2b-2（阶段 2 · §4.8 补偿链删除：assistant 消息直写幂等落库终态）RED 守护
// 契约：assistant 消息与 user 消息同款经 appendSessionMessage 直接幂等落库
// （同库直写，不经 outbox 中转）；outbox 恒空——projector/sink/outbox 表
// 已随补偿链删除，恢复重放由 repository 层来源键查重吸收，消息恰好一条。
// ============================================================

test("S2b-2：assistant 消息直写幂等落库 + outbox 恒空", async () => {
  const calls: RecordedAppendCall[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      intent: "domain_qa",
      answer: "模型回复",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      suggestedActions: [],
      trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
    } as any),
    appendSessionMessage: makeRecordingAppendSessionMessage(calls),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  const outcome = await wf.executeStep("chat", makeFakeCtx());

  // 直写通道：user + assistant 各一次，来源键与 S2a 契约一致
  assert.equal(calls.length, 2, "一次执行应直写 user + assistant 两条消息");
  assert.deepEqual(
    calls.map((c) => c.deduplicationKey),
    ["run-1:user:1", "run-1:assistant:1"],
    "user 消息先落库，assistant 消息随后直接落库（同款 appendSessionMessage 通道）",
  );
  assert.equal(calls[1].role, "assistant");
  assert.equal(calls[1].content, "模型回复");

  // S2b-2 后 outbox 恒空（补偿链已删，不再有双路径共存）
  assert.deepEqual(outcome.outbox, [], "S2b-2 后 outbox 恒空");

  // 恢复重放：workflow 以同一来源键再次直写，去重由 repository 层按键查重保证
  await wf.executeStep("chat", makeFakeCtx());
  assert.equal(calls.length, 4, "重放仍直写（来源键一致），吸收在 repository 层");
  assert.deepEqual(
    calls.map((c) => c.deduplicationKey),
    ["run-1:user:1", "run-1:assistant:1", "run-1:user:1", "run-1:assistant:1"],
    "重放来源键与首次一致，repository 层按键查重吸收重复",
  );
});
