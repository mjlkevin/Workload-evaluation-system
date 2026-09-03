/**
 * Step 1 Workflow 适配器守护测试（RP-047 Batch E）。
 * 常驻回归资产：workbench_chat_v1@1.0.0 workflow——
 * 1) 从 executionConfig.content 取输入，复用 dispatch 链路；
 * 2) AI 调用经 recordToolEffectOnce 幂等（重复执行同 step 不产生第二次 AI 调用）；
 * 3) assistant 消息经 appendSessionMessage 直接幂等落库（来源键 = ${runId}:assistant:1）；
 * 4)（Batch E 二次返工 · 新通道消息落库双缺陷修复）assistant 直写内容非空且与
 *    answer 一致；用户消息在 dispatch 前幂等落库。
 * 5)（S2b-2 · §4.8 补偿链删除，S7 收口）projector/sink 已删，workflow 返回
 *    结构不再包含 outbox 键（不只看「恒空」，而是结构上不可能非空）；
 *    幂等吸收由 repository 层按键查重守护（本套件以 recording fake 断言调用序列与来源键）。
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
import type { AiSessionRecord, AiSessionsStore } from "../ai-sessions/ai-sessions.types";
import type { HomeMessageInput } from "../../services/ai/handlers/workbench-shared";
import { buildWorkbenchChatModelInput } from "../../services/ai/handlers/workbench-shared";
import {
  WorkbenchModelRequestInvariantError,
  assertWorkbenchModelRequestMatchesStorage,
} from "../../services/ai/workbench-request-invariant";

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
  assert.ok(!("outbox" in outcome), "S7 起返回结构不再包含 outbox 键（补偿链已于 S2b-2 删除）");
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
  assert.ok(!("outbox" in outcome), "S7 起返回结构不再包含 outbox 键");
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
    assert.ok(!("outbox" in outcome), "S7 起返回结构不再包含 outbox 键（补偿链已于 S2b-2 删除）");
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
  assert.ok(!("outbox" in outcome), "S7 起返回结构不再包含 outbox 键");
});

// ============================================================
// S2b-2（阶段 2 · §4.8 补偿链删除：assistant 消息直写幂等落库终态）RED 守护
// 契约：assistant 消息与 user 消息同款经 appendSessionMessage 直接幂等落库
// （同库直写，不经 outbox 中转）；S7 起返回结构已无 outbox 键——projector/sink/outbox 表
// 已随补偿链删除，恢复重放由 repository 层来源键查重吸收，消息恰好一条。
// ============================================================

test("S2b-2：assistant 消息直写幂等落库 + 返回结构无 outbox 键", async () => {
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

  // S7 起 outbox 键已从返回结构移除（不再是「存在但为空」，而是结构上不存在）
  assert.ok(!("outbox" in outcome), "S7 起返回结构不再包含 outbox 键");

  // 恢复重放：workflow 以同一来源键再次直写，去重由 repository 层按键查重保证
  await wf.executeStep("chat", makeFakeCtx());
  assert.equal(calls.length, 4, "重放仍直写（来源键一致），吸收在 repository 层");
  assert.deepEqual(
    calls.map((c) => c.deduplicationKey),
    ["run-1:user:1", "run-1:assistant:1", "run-1:user:1", "run-1:assistant:1"],
    "重放来源键与首次一致，repository 层按键查重吸收重复",
  );
});

// ============================================================
// RP-030 真实链路覆盖（2026-08-28）：异步通道 trace 归档缺口修复
// ============================================================
// 背景：前端 AI 工作台走 ai-runs 异步通道（本 workflow），但 trace 归档
// 只存在于旧同步/流式 handler，导致真实问答不写 traces 表（断链）。
// 修复口径：deps 增加可选 recordTurnTrace / recordTurnFailureTrace，
// 生产接线注入 trace.usecase 真实实现；写入置于 recordToolEffectOnce
// 的 execute 内——恢复重放跳过 execute，幂等天然成立（同流式事件口径）。

test("RP-030 覆盖：dispatch 成功经 recordTurnTrace 归档 trace（与同步路径同口径）", async () => {
  const traceCalls: any[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      intent: "domain_qa",
      answer: "模型回复",
      suggestedActions: [],
      trace: { intentConfidence: 0.9, routingRule: "mock_rule", contextRefs: ["ref-1"] },
    } as any),
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeNoOpAppendRunEvent(),
    recordTurnTrace: async (input) => {
      traceCalls.push(input);
      return {} as any;
    },
  });

  await wf.executeStep("chat", makeFakeCtx());

  assert.equal(traceCalls.length, 1, "成功 turn 必须归档一条 trace");
  assert.equal(traceCalls[0].ownerUserId, "user-1");
  assert.equal(traceCalls[0].ownerUsername, "alice");
  assert.equal(traceCalls[0].aiSessionId, "session-1");
  assert.equal(traceCalls[0].userInputSummary, "你好");
  assert.equal(traceCalls[0].dispatchTrace.routingRule, "mock_rule");
  assert.deepEqual(traceCalls[0].dispatchTrace.contextRefs, ["ref-1"]);
});

test("RP-030 覆盖：dispatch 失败经 recordTurnFailureTrace 归档失败 trace 并重抛", async () => {
  const failCalls: any[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => {
      throw new Error("model_down");
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeNoOpAppendRunEvent(),
    recordTurnFailureTrace: async (input) => {
      failCalls.push(input);
      return {} as any;
    },
  });

  await assert.rejects(() => wf.executeStep("chat", makeFakeCtx()), /model_down/, "失败必须重抛给 runtime 标记 run failed");
  assert.equal(failCalls.length, 1, "失败 turn 必须归档一条 failure trace");
  assert.equal(failCalls[0].ownerUsername, "alice");
  assert.equal(failCalls[0].aiSessionId, "session-1");
});

test("RP-030 覆盖：恢复重放跳过 execute，trace 不重复写（幂等天然成立）", async () => {
  const traceCalls: any[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      answer: "模型回复",
      trace: { intentConfidence: 0.9, routingRule: "mock_rule", contextRefs: [] },
    } as any),
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeNoOpAppendRunEvent(),
    recordTurnTrace: async (input) => {
      traceCalls.push(input);
      return {} as any;
    },
  });

  // 重放语义：recordToolEffectOnce 命中既有 effect，直接返回 output 不执行 execute
  const replayCtx = makeFakeCtx({
    recordToolEffectOnce: async () => ({
      output: { answer: "缓存回复", intent: "domain_qa", suggestedActions: [], trace: { intentConfidence: 0.9, routingRule: "mock_rule", contextRefs: [] } },
      created: false,
    }),
  });
  await wf.executeStep("chat", replayCtx);

  assert.equal(traceCalls.length, 0, "恢复重放不得重复归档 trace");
});

test("RP-030 覆盖：recordTurnTrace 写入失败不影响主链路（静默吸收）", async () => {
  const calls: RecordedAppendCall[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async () => ({
      answer: "模型回复",
      trace: { intentConfidence: 0.9, routingRule: "mock_rule", contextRefs: [] },
    } as any),
    appendSessionMessage: makeRecordingAppendSessionMessage(calls),
    appendRunEvent: makeNoOpAppendRunEvent(),
    recordTurnTrace: async () => {
      throw new Error("trace_store_down");
    },
  });

  const outcome = await wf.executeStep("chat", makeFakeCtx());
  assert.equal(outcome.nextStepKey, null, "trace 写入失败不得阻断主链路");
  // §4.8 随动项（S2b-2）：assistant 正文不再经 outbox 中转，改由
  // appendSessionMessage 同库直写，故「主链路仍完成它该做的持久化」这一层
  // 断言随终态改造为直写调用观测（outbox 恒空的不变量由本文件 S2b-2 守护用例断）。
  const assistantCalls = calls.filter((c) => c.role === "assistant");
  assert.equal(assistantCalls.length, 1, "trace 写入失败仍须直写恰好一条 assistant 消息");
  assert.equal(assistantCalls[0].content, "模型回复", "assistant 正文不得因 trace 归档失败而丢失");
});

// ============================================================
// DEF-2026-08-27-001：异步 Run 通道必须携带会话历史与记忆项目
// 契约：①历史必须取自「当前用户消息落库之后」的会话记录（workbench-shared
//   的历史整形是覆盖末条而非追加，落库前取会把上一轮 assistant 覆盖丢失）；
// ②口径与同步路径一致（含当前轮，末条即当前 user）；
// ③projectId 与蒸馏钩子同表达式，供记忆注入；
// ④memoryRef 经显式判别 chunk（kind=metadata）透出，不得写成 run 事件流，
//   并落 assistant 顶层 metadata（前端 messageFormatter 只读顶层）。
// ============================================================

type HistoryDispatchInput = {
  message: string;
  messages?: HomeMessageInput[];
  projectId?: string;
};

function makeInMemorySession(sessionId: string, ownerUserId: string, seed: Array<{ role: "user" | "assistant"; content: string }> = []): AiSessionRecord {
  const nowIso = new Date().toISOString();
  return {
    sessionId,
    ownerUserId,
    ownerUsername: "workflow-tester",
    title: "历史注入测试会话",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    summary: "",
    messages: seed.map((m, i) => ({ messageId: `msg-seed-${i}`, role: m.role, content: m.content, createdAt: nowIso })),
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

test("DEF-2026-08-27-001：第二轮 dispatch 入参含第一轮 user+assistant，且历史取自当前轮落库之后", async () => {
  const session = makeInMemorySession("session-1", "user-1", [
    { role: "user", content: "第一轮：帮我评估 PLM 项目工作量" },
    { role: "assistant", content: "第一轮回答：已完成初步评估" },
  ]);
  const dispatchInputs: HistoryDispatchInput[] = [];

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      dispatchInputs.push({ message: input.message, messages: input.messages, projectId: input.projectId });
      return {
        intent: "domain_qa",
        answer: "第二轮回答：实施周期约 6 个月",
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      } as any;
    },
    // 真实模拟仓储：落库即写入会话，getSessionRecord 读回同一份——
    // 若 workflow 在 append 之前取历史，读到的末条就是第一轮 assistant。
    appendSessionMessage: async (input) => {
      session.messages.push(input.message);
      if (input.attachments) session.attachments.push(...input.attachments);
      return { found: true, created: true, message: input.message };
    },
    appendRunEvent: makeNoOpAppendRunEvent(),
    getSessionRecord: async () => session,
  });

  await wf.executeStep("chat", makeFakeCtx({
    run: { executionConfig: { content: "第二轮：那实施周期多久" } },
  }));

  assert.equal(dispatchInputs.length, 1, "本轮必须恰好一次 dispatch");
  const history = dispatchInputs[0].messages;
  assert.ok(Array.isArray(history), "异步通道 dispatch 必须收到 messages 历史（不得只发当前轮）");
  const texts = history!.map((m) => m.content);
  assert.equal(texts.length, 3, `历史窗口应为[第一轮 user, 第一轮 assistant, 当前 user]，实取 ${JSON.stringify(texts)}`);
  assert.equal(texts[0], "第一轮：帮我评估 PLM 项目工作量", "历史必须含第一轮 user 原文");
  assert.equal(texts[1], "第一轮回答：已完成初步评估", "历史必须含第一轮 assistant——落库前取会被「覆盖末条」丢掉");
  assert.equal(texts[2], "第二轮：那实施周期多久", "末条必须是刚落库的当前用户轮（证明取历史发生在落库之后）");
});

test("DEF-2026-08-27-001：projectId 与蒸馏钩子同表达式（无项目时为 default）", async () => {
  const captured: HistoryDispatchInput[] = [];
  const buildWf = () => createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      captured.push({ message: input.message, messages: input.messages, projectId: input.projectId });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeRecordingAppendSessionMessage([]),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  await buildWf().executeStep("chat", makeFakeCtx());
  assert.equal(captured[0].projectId, "default", "run 无项目归属时 projectId 必须为 default（与蒸馏钩子同口径）");

  await buildWf().executeStep("chat", makeFakeCtx({ run: { projectEvaluationId: "proj-9" } }));
  assert.equal(captured[1].projectId, "proj-9", "run.projectEvaluationId 存在时必须作为记忆注入项目");

  await buildWf().executeStep("chat", makeFakeCtx({ run: { metadata: { projectId: "meta-7" } } }));
  assert.equal(captured[2].projectId, "meta-7", "run.metadata.projectId 为次优先取值");
});

test("DEF-2026-08-27-001：kind=metadata chunk 不写 run 事件，memoryRef 落 assistant 顶层 metadata", async () => {
  const runEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const appended: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> = [];

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      // 模拟 boot 的 modelChatStream：先透出显式 metadata chunk（无 contentDelta），再发正文增量
      input.streamingAdapter!.onToken({ kind: "metadata", contentDelta: "", memoryRef: { scenesCount: 1, atomsCount: 2 } } as any);
      input.streamingAdapter!.onToken({ contentDelta: "模", model: "kimi-test" } as any);
      input.streamingAdapter!.onToken({ contentDelta: "型回复", model: "kimi-test" } as any);
      return {
        answer: "模型回复",
        intent: "domain_qa",
        suggestedActions: [],
        trace: { intentConfidence: 0.9, routingRule: "mock", contextRefs: [] },
      } as any;
    },
    appendSessionMessage: async (input) => {
      appended.push({ role: input.message.role, content: input.message.content, metadata: input.message.metadata as Record<string, unknown> | undefined });
      return { found: true, created: true, message: input.message };
    },
    appendRunEvent: async (input) => {
      runEvents.push({ eventType: input.eventType, payload: input.payload });
      return input;
    },
  });

  await wf.executeStep("chat", makeFakeCtx({ run: { executionConfig: { content: "追问" } } }));

  assert.deepEqual(
    runEvents.map((e) => `${e.eventType}:${JSON.stringify(e.payload)}`),
    ['text.delta:{"delta":"模"}', 'text.delta:{"delta":"型回复"}'],
    "metadata chunk 不得进入 run 事件流（既非 text.delta 也非 thought）",
  );
  const assistant = appended.find((c) => c.role === "assistant");
  assert.ok(assistant, "assistant 消息必须落库");
  assert.deepEqual(assistant!.metadata?.memoryRef, { scenesCount: 1, atomsCount: 2 }, "memoryRef 必须写在 assistant 消息 metadata 顶层");
});

// ============================================================
// 批次 0 · ④：工具副作用必须逐次独立编号（修复固定 effectKey）
// ============================================================
// 修复前 dispatch 侧只有 `workbench_chat_answer` 一个固定 effect；多轮工具调用下
// 若沿用固定 key，后几轮会命中同一 effect 被跳过 → 副作用互相吞。
// 本用例锁定：① dispatch 入参携带 recordToolEffect；② ordinal → 独立 effectKey；
// ③ 重放同一 Run 命中各自轮次的 effect，不重复执行。
test("批次0·④：recordToolEffect 逐 ordinal 落独立 effectKey，重放不重复执行工具", async () => {
  type Recorder = NonNullable<Parameters<WorkbenchChatWorkflowDeps["dispatch"]>[0]["recordToolEffect"]>;
  let recorder: Recorder | undefined;

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      recorder = input.recordToolEffect;
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeRecordingAppendSessionMessage([]),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  const TOOL_EFFECT = "workbench_chat_tool_call";
  const recordedKeys: string[] = [];
  const store = new Map<string, Record<string, unknown>>();
  let toolExecutions = 0;

  const ctx = makeFakeCtx({
    // 复刻 worker 真实语义：命中既有 key 直接返回存量 output，不调用 execute
    recordToolEffectOnce: async (effect) => {
      recordedKeys.push(effect.effectKey);
      const existing = store.get(effect.effectKey);
      if (existing) return { output: existing, created: false };
      if (effect.effectKey.includes(TOOL_EFFECT)) toolExecutions += 1;
      const output = await effect.execute();
      store.set(effect.effectKey, output);
      return { output, created: true };
    },
  });

  await wf.executeStep("chat", ctx);
  assert.ok(recorder, "dispatch 入参必须注入 recordToolEffect（未注入则工具轮次无幂等）");

  const runEffect = (ordinal: number) =>
    recorder!(ordinal, async () => ({ ok: true, data: ordinal }), { toolName: `t${ordinal}`, arguments: {} });

  const first1 = await runEffect(1);
  const first2 = await runEffect(2);
  assert.deepEqual(first1, { ok: true, data: 1 });
  assert.deepEqual(first2, { ok: true, data: 2 });
  assert.equal(toolExecutions, 2, "两个 ordinal 必须各自真正执行一次");
  assert.deepEqual(
    recordedKeys.filter((key) => key.includes(TOOL_EFFECT)),
    [`run-1:chat:${TOOL_EFFECT}:1`, `run-1:chat:${TOOL_EFFECT}:2`],
    "effectKey 必须逐 ordinal 独立（固定 key 会让第 2 轮命中第 1 轮被跳过）",
  );

  // 重放：同 ordinal 命中各自已记录 effect，不重复执行、产出与首跑一致
  const replay1 = await runEffect(1);
  const replay2 = await runEffect(2);
  assert.equal(toolExecutions, 2, "重放不得重复执行工具");
  assert.deepEqual(replay1, { ok: true, data: 1 });
  assert.deepEqual(replay2, { ok: true, data: 2 });

  // 外层整轮 effect 冻结口径不变（ordinal 恒为 1），重放仍然吸收整轮
  assert.ok(
    recordedKeys.includes("run-1:chat:workbench_chat_answer:1"),
    "workbench_chat_answer 的 key 形态必须保持冻结",
  );
});

// ============================================================
// 批次 0 · ⑤：异步 Run 通道必须注入「存储侧当场重取」钩子
// ============================================================
// 对账本体由 workbench-request-invariant.test.ts 守护（含红→绿配对）。本组用例
// 只锁 workflow 侧接线契约，防两种让断言退化为形式的失效：
//  ① 钩子不下发 → 全链路无人对账，且不会报错（与 DEF-001 同一种静默失效）；
//  ② 钩子复用发送侧组装时的快照 → 两侧同源、断言永真，等于没有断言。
test("批次0·⑤：注入 getSessionRecord 时下发 readSessionForInvariant，且钩子当场重取存储", async () => {
  type DispatchInput = Parameters<WorkbenchChatWorkflowDeps["dispatch"]>[0];
  let hook: DispatchInput["readSessionForInvariant"];
  let sentHistory: HomeMessageInput[] | undefined;

  const session = makeInMemorySession("session-1", "user-1", [
    { role: "user", content: "第一轮：帮我评估 PLM 项目工作量" },
    { role: "assistant", content: "第一轮回答：已完成初步评估" },
  ]);

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      hook = input.readSessionForInvariant;
      sentHistory = input.messages;
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: async (input) => {
      session.messages.push(input.message);
      return { found: true, created: true, message: input.message };
    },
    appendRunEvent: makeNoOpAppendRunEvent(),
    getSessionRecord: async () => session,
  });

  await wf.executeStep("chat", makeFakeCtx({
    run: { executionConfig: { content: "第二轮：那实施周期多久" } },
  }));

  assert.ok(hook, "具备存储读取能力时 dispatch 必须收到 readSessionForInvariant，否则无人对账");
  assert.equal(sentHistory?.length, 3, "发送侧基线应为[第一轮 user, 第一轮 assistant, 当前 user]");

  // 存储侧的权威时点＝钩子被调用的那一刻。workflow 在 dispatch 之后才写 assistant，
  // 故 executeStep 结束后存储已有 4 条而发送侧组装时只有 3 条；若实现复用了组装期
  // 快照，这里读回仍是 3。
  const stored = await hook!();
  assert.equal(stored?.messages.length, 4, "钩子必须当场重取存储侧，而非复用发送侧组装时的快照");
});

test("批次0·⑤：未注入 getSessionRecord 时不下发钩子（additive 契约，行为同修复前）", async () => {
  let hookDelivered = false;
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      hookDelivered = input.readSessionForInvariant !== undefined;
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeRecordingAppendSessionMessage([]),
    appendRunEvent: makeNoOpAppendRunEvent(),
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.equal(hookDelivered, false, "无存储读取能力时不得凭空下发钩子（条件展开契约）");
});

test("批次0·⑤：接线点上生产 builder + 生产断言为绿，管道丢历史即红", async () => {
  const SYSTEM_PROMPT = "你是售前顾问的 AI 工作助手。";
  let greenPassed = false;
  let redReason = "";

  const session = makeInMemorySession("session-1", "user-1", [
    { role: "user", content: "第一轮：帮我评估 PLM 项目工作量" },
    { role: "assistant", content: "第一轮回答：已完成初步评估" },
  ]);

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      // 复刻 harness-boot.modelChatStream 的构造点：发送侧用生产 builder 组装，
      // 存储侧用钩子当场重取，再交给生产断言对账。
      const sent = await buildWorkbenchChatModelInput(input.user, {
        systemPrompt: SYSTEM_PROMPT,
        userContent: input.message,
        messages: input.messages,
      });
      assertWorkbenchModelRequestMatchesStorage({
        sent: sent.messages,
        session: await input.readSessionForInvariant!(),
        userContent: input.message,
      });
      greenPassed = true;

      // DEF-2026-08-27-001 第一层根因形态：中间管道把历史丢掉。
      const dropped = await buildWorkbenchChatModelInput(input.user, {
        systemPrompt: SYSTEM_PROMPT,
        userContent: input.message,
        messages: [],
      });
      try {
        assertWorkbenchModelRequestMatchesStorage({
          sent: dropped.messages,
          session: await input.readSessionForInvariant!(),
          userContent: input.message,
        });
      } catch (err) {
        redReason = err instanceof WorkbenchModelRequestInvariantError ? err.reason : `unexpected:${String(err)}`;
      }
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: async (input) => {
      session.messages.push(input.message);
      return { found: true, created: true, message: input.message };
    },
    appendRunEvent: makeNoOpAppendRunEvent(),
    getSessionRecord: async () => session,
  });

  await wf.executeStep("chat", makeFakeCtx({
    run: { executionConfig: { content: "第二轮：那实施周期多久" } },
  }));

  assert.equal(greenPassed, true, "接线点两侧一致时必须为绿");
  assert.equal(redReason, "history_length_mismatch: sent=1 expected=3", "发送侧丢历史必须当场红并给出结构差异");
});

// ============================================================
// 批次 0.5 · ②：工具调用四类事件必须写入异步 run 事件流
// ============================================================
// 批次 0 让工作台真正执行了只读工具，但调用对用户完全不可见——事件只到
// onEvent 接缝（无消费者）即蒸发。本批把四类 tool.call.* 经 deps.appendRunEvent
// 落 harness_run_events，复用既有单调 sequence 与串行写链（不自建去重）。
// 口径：
//  · 只异步通道发射（同步通道是历史兜底，批次 2 合并即删）；
//  · tool.call.progress 是本轮唯一真正新增的状态，由「执行中」超时心跳派生——
//    批次 0 冻结了 AgentEvent 词汇表（不自造 kind），循环侧不新增事件类型；
//  · 副作用位于 recordToolEffectOnce 的 execute 内，恢复重放天然吸收。

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RecordedRunEvent = { runId: string; eventType: string; payload: Record<string, unknown> };

function makeRecordingAppendRunEvent(sink: RecordedRunEvent[]) {
  return async (input: { runId: string; eventType: string; payload: Record<string, unknown> }) => {
    // 复刻 repository 的 1 MiB 闸门：payload 超限即丢弃（本批必须靠截断避免）
    sink.push(input as RecordedRunEvent);
    return input;
  };
}

/** 把连续 progress 折叠为一条，使顺序断言不受心跳次数影响 */
function collapseProgress(events: RecordedRunEvent[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (event.eventType === "tool.call.progress" && out[out.length - 1] === "tool.call.progress") continue;
    out.push(event.eventType);
  }
  return out;
}

test("批次0.5·②：工具调用经 appendRunEvent 落 started→progress→completed，顺序与载荷形状冻结", async () => {
  const appended: RecordedRunEvent[] = [];
  let toolEventCount = 0;

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      toolEventCount += 1;
      input.onToolEvent?.({ kind: "tool_call", name: "list_estimates", arguments: { keyword: "PLM" } });
      await sleep(45);
      input.onToolEvent?.({ kind: "tool_result", name: "list_estimates", ok: true, data: { total: 3 } });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 15,
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.equal(toolEventCount, 1, "dispatch 必须收到 onToolEvent（未下发则事件无处产生）");

  assert.deepEqual(
    collapseProgress(appended),
    ["tool.call.started", "tool.call.progress", "tool.call.completed"],
    "长耗时工具必须依次发射 started → progress → completed",
  );
  assert.ok(
    appended.every((event) => event.runId === "run-1"),
    "工具事件必须挂在本次 Run 的事件流上",
  );

  const started = appended.find((event) => event.eventType === "tool.call.started")!;
  assert.deepEqual(
    { callIndex: started.payload.callIndex, name: started.payload.name, arguments: started.payload.arguments },
    { callIndex: 1, name: "list_estimates", arguments: { keyword: "PLM" } },
    "started 载荷 = { callIndex, name, arguments }：参数供 UI 展示（模型侧不得可见）",
  );

  const progressEvents = appended.filter((event) => event.eventType === "tool.call.progress");
  assert.ok(progressEvents.length >= 1, "执行时长超过心跳间隔必须至少发出一条 progress");
  for (const event of progressEvents) {
    assert.equal(event.payload.callIndex, 1);
    assert.equal(event.payload.name, "list_estimates");
    assert.equal(typeof event.payload.elapsedMs, "number", "progress 必须携带已耗时供 UI 展示进度");
  }

  const completed = appended.find((event) => event.eventType === "tool.call.completed")!;
  assert.equal(completed.payload.callIndex, 1);
  assert.equal(completed.payload.name, "list_estimates");
  assert.equal(typeof completed.payload.elapsedMs, "number", "completed 必须携带总耗时");
  assert.ok(String(completed.payload.resultPreview).includes("total"), "completed 载荷须含结果摘要供 UI 展示");
});

test("批次0.5·②：工具执行失败落 tool.call.failed 并携带 error", async () => {
  const appended: RecordedRunEvent[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.onToolEvent?.({ kind: "tool_call", name: "query_knowledge_base", arguments: { query: "x" } });
      input.onToolEvent?.({ kind: "tool_result", name: "query_knowledge_base", ok: false, error: "权限不足" });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 10_000,
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.deepEqual(
    appended.map((event) => event.eventType),
    ["tool.call.started", "tool.call.failed"],
    "ok=false 必须落 failed，不得伪装成 completed",
  );
  assert.equal(appended[1].payload.error, "权限不足");
  assert.equal(appended[1].payload.callIndex, 1);
});

test("批次0.5·②：多次调用 callIndex 逐次递增；非工具类 AgentEvent 不产工具事件", async () => {
  const appended: RecordedRunEvent[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.onToolEvent?.({ kind: "final", content: "不该产生事件" });
      input.onToolEvent?.({ kind: "need_confirm", name: "create_estimate", arguments: {} });
      input.onToolEvent?.({ kind: "tool_call", name: "t1", arguments: { a: 1 } });
      input.onToolEvent?.({ kind: "tool_result", name: "t1", ok: true, data: "r1" });
      input.onToolEvent?.({ kind: "tool_call", name: "t2", arguments: { b: 2 } });
      input.onToolEvent?.({ kind: "tool_result", name: "t2", ok: true, data: "r2" });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 10_000,
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.deepEqual(
    appended.map((event) => [event.eventType, event.payload.callIndex, event.payload.name]),
    [
      ["tool.call.started", 1, "t1"],
      ["tool.call.completed", 1, "t1"],
      ["tool.call.started", 2, "t2"],
      ["tool.call.completed", 2, "t2"],
    ],
    "callIndex 必须逐次递增以支持 UI 配对；final/need_confirm 不属本批四类",
  );
});

test("批次0.5·②：短调用不触发 progress 心跳（心跳是长耗时信号，不是每次调用的噪音）", async () => {
  const appended: RecordedRunEvent[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.onToolEvent?.({ kind: "tool_call", name: "t", arguments: {} });
      await sleep(10);
      input.onToolEvent?.({ kind: "tool_result", name: "t", ok: true, data: 1 });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 500,
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.deepEqual(
    appended.map((event) => event.eventType),
    ["tool.call.started", "tool.call.completed"],
    "未达心跳间隔不得发 progress",
  );
});

test("批次0.5·②：progress 定时器在结果返回后必须停止（不得在 Run 结束后继续写事件）", async () => {
  const appended: RecordedRunEvent[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.onToolEvent?.({ kind: "tool_call", name: "slow_tool", arguments: {} });
      await sleep(60);
      input.onToolEvent?.({ kind: "tool_result", name: "slow_tool", ok: true, data: 1 });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 15,
  });

  await wf.executeStep("chat", makeFakeCtx());
  const before = appended.length;
  await sleep(60);
  assert.equal(appended.length, before, "completed 之后不得再有 progress 写入（定时器未清理 = 事件泄漏）");
});

test("批次0.5·②：超大工具结果必须截断，不得整条被 1 MiB 闸门丢弃", async () => {
  const appended: RecordedRunEvent[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.onToolEvent?.({ kind: "tool_call", name: "big", arguments: { blob: "x".repeat(200_000) } });
      input.onToolEvent?.({ kind: "tool_result", name: "big", ok: true, data: { rows: "y".repeat(2_000_000) } });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: async (input) => {
      const size = Buffer.byteLength(JSON.stringify(input.payload), "utf-8");
      if (size > 1024 * 1024) throw new Error("payload exceeds 1 MiB JSON limit");
      appended.push(input as RecordedRunEvent);
      return input;
    },
    toolCallProgressIntervalMs: 10_000,
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.deepEqual(
    appended.map((event) => event.eventType),
    ["tool.call.started", "tool.call.completed"],
    "事件必须存活到落库——丢弃等于回到本批要消灭的不可见",
  );
  assert.ok(
    JSON.stringify(appended[0].payload.arguments).length < 10_000,
    "arguments 必须截断后透出（String(object) 恒为 [object Object]，故按序列化长度断言）",
  );
  assert.ok(String(appended[1].payload.resultPreview).length < 10_000, "resultPreview 必须截断后透出");
});

test("批次0.5·②：未注入 appendRunEvent 时 onToolEvent 为空操作，不抛错也不阻断主链路", async () => {
  let fired = 0;
  const calls: RecordedAppendCall[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      assert.ok(input.onToolEvent, "即使未注入 appendRunEvent，接缝也应下发（additive 契约）");
      input.onToolEvent?.({ kind: "tool_call", name: "t", arguments: {} });
      fired += 1;
      input.onToolEvent?.({ kind: "tool_result", name: "t", ok: true, data: 1 });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeRecordingAppendSessionMessage(calls),
  });

  const ctx = makeFakeCtx();
  const outcome = await wf.executeStep("chat", ctx);
  assert.equal(fired, 1);
  assert.equal(outcome.nextStepKey, null, "无事件写入能力时不得抛错中断 Run");
  const assistant = calls.find((call) => call.role === "assistant");
  assert.equal(assistant?.content, "ok", "无事件写入能力时回答主链路不受影响");
});

test("批次0.5·②：恢复重放命中既有 effect 时不重发工具事件", async () => {
  const appended: RecordedRunEvent[] = [];
  const recordedEffects: string[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.onToolEvent?.({ kind: "tool_call", name: "t", arguments: {} });
      input.onToolEvent?.({ kind: "tool_result", name: "t", ok: true, data: 1 });
      return { answer: "ok", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 10_000,
  });

  const recordToolEffectOnce = async (effect: FakeEffect) => {
    if (recordedEffects.includes(effect.effectKey)) return { output: { answer: "cached" }, created: false };
    recordedEffects.push(effect.effectKey);
    return { output: await effect.execute(), created: true };
  };
  const ctx = makeFakeCtx({ recordToolEffectOnce: recordToolEffectOnce as any });

  await wf.executeStep("chat", ctx);
  assert.equal(appended.length, 2, "首跑发射 started + completed");
  await wf.executeStep("chat", ctx);
  assert.equal(appended.length, 2, "重放跳过 execute，工具事件不得重发");
});

test("批次0.5·②：工具事件与 text.delta 共用同一写链，顺序即模型真实产生顺序", async () => {
  const appended: RecordedRunEvent[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      input.streamingAdapter?.onToken({ contentDelta: "先查" });
      input.onToolEvent?.({ kind: "tool_call", name: "list_estimates", arguments: {} });
      input.onToolEvent?.({ kind: "tool_result", name: "list_estimates", ok: true, data: 1 });
      input.streamingAdapter?.onToken({ contentDelta: "再答" });
      return { answer: "先查再答", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeNoOpAppendSessionMessage(),
    appendRunEvent: makeRecordingAppendRunEvent(appended),
    toolCallProgressIntervalMs: 10_000,
  });

  await wf.executeStep("chat", makeFakeCtx());
  assert.deepEqual(
    appended.map((event) => event.eventType),
    ["text.delta", "tool.call.started", "tool.call.completed", "text.delta"],
    "两条事件族必须共用串行链，否则 sequence 会反映错误的时序",
  );
});

// ============================================================
// 批次 0.5 · ③：会话消息必须顶层镜像 toolCalls（重后可见）
// ============================================================
// ② 只解决「流式期间可见」。前端 messageFormatter.mapSessionMessages 只读
// metadata.toolCalls **顶层**（MS3 口径），而 trace.toolCalls 嵌在 metadata.trace
// 下——故刷新页面/重开会话后三态全部消失，可视化只在一次 SSE 连接内存活。
// 本组用例锁：① 顶层镜像落库；② UI 专用载荷（完整参数、resultPreview）不得
// 进消息（列表随会话持久化，与模型可见面同源受约束）；③ source 按名合并，
// 「· 经发现」不因镜像而丢；④ 无调用时不写键（保持既有静默）；⑤ 恢复重放
// 跳过 execute，只有把结果放进 execute 返回值才能保证两次写出同一份 metadata
// （与 DEF-2026-08-27-001 的 memoryRef 同构）。

type AppendedMessage = { role: string; content: string; metadata?: Record<string, unknown> };

function makeMessageCapturingAppendSessionMessage(sink: AppendedMessage[]): WorkbenchChatWorkflowDeps["appendSessionMessage"] {
  return async (input) => {
    sink.push({
      role: input.message.role,
      content: input.message.content,
      metadata: input.message.metadata as Record<string, unknown> | undefined,
    });
    return { found: true, created: true, message: input.message };
  };
}

type WorkbenchDispatchInput = Parameters<WorkbenchChatWorkflowDeps["dispatch"]>[0];

/** 只工具调用、不出正文的 dispatch，用于聚焦 metadata 镜像 */
function makeToolOnlyDispatch(events: Array<(input: WorkbenchDispatchInput) => void>) {
  return async (input: WorkbenchDispatchInput) => {
    for (const fire of events) fire(input);
    return {
      answer: "已处理",
      intent: "domain_qa",
      suggestedActions: [],
      trace: { toolCalls: [{ name: "list_estimates", source: "list_tools" }] },
    } as any;
  };
}

test("批次0.5·③：assistant 消息顶层镜像 toolCalls 三态，UI 专用载荷不得进消息", async () => {
  const messages: AppendedMessage[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: makeToolOnlyDispatch([
      (input) => input.onToolEvent?.({ kind: "tool_call", name: "list_estimates", arguments: { keyword: "PLM项目工作量参数很长" } }),
      (input) => input.onToolEvent?.({ kind: "tool_result", name: "list_estimates", ok: true, data: { rows: "结果不应进消息".repeat(10) } }),
      (input) => input.onToolEvent?.({ kind: "tool_call", name: "create_project", arguments: {} }),
      (input) => input.onToolEvent?.({ kind: "tool_result", name: "create_project", ok: false, error: "工作台仅开放只读工具，create_project 未获准执行" }),
    ]),
    appendSessionMessage: makeMessageCapturingAppendSessionMessage(messages),
    appendRunEvent: makeNoOpAppendRunEvent(),
    toolCallProgressIntervalMs: 10_000,
  });

  await wf.executeStep("chat", makeFakeCtx());

  const assistant = messages.find((c) => c.role === "assistant");
  assert.ok(assistant, "assistant 消息必须落库");
  const toolCalls = assistant!.metadata?.toolCalls;
  assert.ok(Array.isArray(toolCalls), "metadata.toolCalls 必须是顶层数组，否则重后前端读不到");
  assert.deepEqual(
    (toolCalls as Array<Record<string, unknown>>).map((call) => call.name),
    ["list_estimates", "create_project"],
    "镜像必须按调用顺序覆盖全部工具",
  );
  assert.deepEqual(
    (toolCalls as Array<Record<string, unknown>>).map((call) => call.status),
    ["completed", "failed"],
    "三态必须在镜像里还原（started→running→completed/failed 的终态）",
  );
  assert.deepEqual(
    (toolCalls as Array<Record<string, unknown>>).map((call) => call.callIndex),
    [1, 2],
    "callIndex 必须随镜像落库，供前端与既有归一化配对",
  );
  assert.equal(
    (toolCalls as Array<Record<string, unknown>>)[0].source,
    "list_tools",
    "trace.toolCalls 的 source 必须按名合并进镜像，否则「· 经发现」在重后丢失",
  );

  const serialized = JSON.stringify(toolCalls);
  assert.ok(!serialized.includes("arguments"), "完整工具参数属 UI 事件专用面，不得进会话消息");
  assert.ok(!serialized.includes("resultPreview"), "结果预览属 UI 事件专用面，不得进会话消息");
  assert.ok(!serialized.includes("结果不应进消息"), "工具返回内容不得经镜像回灌会话消息");
  assert.ok(
    (toolCalls as Array<Record<string, unknown>>).every(
      (call) => typeof call.elapsedMs === "number" && (call.elapsedMs as number) >= 0,
    ),
    "耗时必须随镜像落库（重后仍展示耗时，不只是状态词）",
  );
  assert.equal(
    typeof (toolCalls as Array<Record<string, unknown>>)[1].errorPreview,
    "string",
    "失败原因必须进镜像，否则重后只剩「失败」二字、无因可循",
  );
});

test("批次0.5·③：无工具调用时不写 toolCalls 键（保持既有静默，不制造空数组）", async () => {
  const messages: AppendedMessage[] = [];
  const wf = createWorkbenchChatWorkflow({
    dispatch: makeToolOnlyDispatch([]),
    appendSessionMessage: makeMessageCapturingAppendSessionMessage(messages),
    appendRunEvent: makeNoOpAppendRunEvent(),
    toolCallProgressIntervalMs: 10_000,
  });

  await wf.executeStep("chat", makeFakeCtx());
  const assistant = messages.find((c) => c.role === "assistant");
  assert.ok(assistant, "assistant 消息必须落库");
  assert.equal(
    "toolCalls" in (assistant!.metadata ?? {}),
    false,
    "缺数据时不得写键：前端 normalizeToolCalls 对空数组返回 undefined，写空数组只会制造 diff 噪音",
  );
});

test("批次0.5·③：恢复重放吸收整轮 effect 后，metadata.toolCalls 与首跑逐字节一致", async () => {
  const messages: AppendedMessage[] = [];
  const store = new Map<string, Record<string, unknown>>();
  let dispatchCalls = 0;

  const wf = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      dispatchCalls += 1;
      input.onToolEvent?.({ kind: "tool_call", name: "list_estimates", arguments: { a: 1 } });
      input.onToolEvent?.({ kind: "tool_result", name: "list_estimates", ok: true, data: { total: 3 } });
      return { answer: "已处理", intent: "domain_qa", suggestedActions: [], trace: {} } as any;
    },
    appendSessionMessage: makeMessageCapturingAppendSessionMessage(messages),
    appendRunEvent: makeNoOpAppendRunEvent(),
    toolCallProgressIntervalMs: 10_000,
  });

  // 复刻 worker 真实语义：命中既有 key 直接返回存量 output，不调用 execute
  const replayCtx = makeFakeCtx({
    recordToolEffectOnce: async (effect) => {
      const existing = store.get(effect.effectKey);
      if (existing) return { output: existing, created: false };
      const output = await effect.execute();
      store.set(effect.effectKey, output);
      return { output, created: true };
    },
  });

  await wf.executeStep("chat", replayCtx);
  await wf.executeStep("chat", replayCtx);

  assert.equal(dispatchCalls, 1, "整轮 effect 必须吸收重放，否则工具会被执行两次");
  const assistants = messages.filter((c) => c.role === "assistant");
  assert.equal(assistants.length, 2, "两次执行各写一条 assistant 消息");
  // 先确立首跑镜像非空：否则下面的 deepEqual 会退化成 undefined === undefined 永真
  const firstMirror = assistants[0].metadata?.toolCalls;
  assert.ok(Array.isArray(firstMirror) && firstMirror.length === 1, "首跑必须写出单条镜像");
  assert.equal(
    (firstMirror as Array<Record<string, unknown>>)[0].status,
    "completed",
    "首跑镜像必须是终态",
  );
  assert.deepEqual(
    assistants[1].metadata?.toolCalls,
    assistants[0].metadata?.toolCalls,
    "镜像必须经 execute 返回值传递：重放跳过 execute，只靠 sink 内存态会写出空列表",
  );
});
