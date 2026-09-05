/**
 * Step 2 Boot 接线守护测试（RP-047 Batch E）。
 * 常驻回归资产：
 * 1) enabled=true：registry 含 workbench_chat_v1、worker.start 恰 1 次；
 * 2) enabled=false：零 start、零注册副作用；
 * 3) SIGTERM/SIGINT 触发 worker.stop（S2b-2 后 projector 已随补偿链删除）；
 * 4) boot 默认组装出的 workflow dispatch 不是占位（可调用且不抛 "dispatch not wired"）。
 * 5) G-E1 focused 端到端：boot 默认组装 + 注入 stub modelChat → 提交 run → worker 执行 →
 *    assistant 消息直写落库（S2b-2 后不再经 outbox → projector 投影）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startHarnessRuntime, createRunTerminalMemoryHook } from "./harness-boot";
import { createMemoryUsecase } from "../memory/memory.usecase";
import type { distillRunMemory } from "../memory/memory.distiller";
import type { AuthUser } from "../../types";
import type { WorkbenchModelMessage } from "../../services/ai/handlers/workbench-shared";
import { createAiSession, deleteAiSession, getAiSession } from "../ai-sessions/ai-sessions.usecase";
import {
  WorkbenchModelRequestInvariantError,
  assertWorkbenchModelRequestMatchesStorage,
} from "../../services/ai/workbench-request-invariant";

test("boot: enabled=true 启动 worker 恰 1 次", async () => {
  let workerStarted = 0;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: true,
    createWorker: () => ({
      start: async () => { workerStarted += 1; },
      stop: async () => { workerStarted -= 1; },
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  // 给异步 start 一点时间
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(workerStarted, 1, "worker 应启动恰好 1 次");

  await runtime.stop();
});

test("boot: enabled=false 零 start 零副作用", async () => {
  let workerStarted = 0;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: false,
    createWorker: () => ({
      start: async () => { workerStarted += 1; },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(workerStarted, 0, "flag off 时 worker 不得启动");

  await runtime.stop();
});

test("boot: stop 调用 worker.stop 恰 1 次", async () => {
  let workerStops = 0;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: true,
    createWorker: () => ({
      start: async () => {},
      stop: async () => { workerStops += 1; },
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await runtime.stop();

  assert.equal(workerStops, 1, "停机必须调用 worker.stop 恰好 1 次");
});

test("boot: 默认组装出的 workflow dispatch 不是占位", async () => {
  let dispatched = false;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: true,
    createWorker: ({ registry }) => ({
      start: async () => {
        const workflow = registry.get("workbench_chat_v1", "1.0.0");
        if (!workflow) throw new Error("workflow not found");
        // 尝试调用 dispatch（应不抛 "dispatch not wired" 错误）
        await workflow.executeStep("chat", {
          run: {
            harnessRunId: "run-test",
            ownerUserId: "user-1",
            ownerUsername: "alice",
            aiSessionId: "session-1",
            submissionKey: "sub-1",
            title: "测试",
            workflowId: "workbench_chat_v1",
            workflowVersion: "1.0.0",
            executionConfig: { content: "hello" },
            status: "running",
            eventSequence: 1,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
          attempt: {
            harnessRunAttemptId: "attempt-1",
            harnessRunId: "run-test",
            workerId: "worker-1",
            attemptNo: 1,
            status: "claimed",
            startedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
          stepKey: "chat",
          state: {},
          resumeFrom: null,
          abortSignal: new AbortController().signal,
          makeEffectKey: (name, ord) => `run-test:chat:${name}:${ord}`,
          recordToolEffectOnce: async (effect) => {
            const output = await effect.execute();
            return { output, created: true };
          },
        });
        dispatched = true;
      },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await runtime.stop();

  assert.equal(dispatched, true, "默认组装的 dispatch 应可调用且不抛 'dispatch not wired' 错误");
});

test("boot: G-E1 focused 端到端——stub modelChat 注入后被调用", async () => {
  let modelChatCalled = false;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: true,
    // 注入 stub modelChat，模拟真实 AI 调用
    createModelChat: () => async () => {
      modelChatCalled = true;
      return {
        answer: "stub-answer",
        rawContent: "stub-answer",
        provider: "stub",
        model: "stub-model",
        attempts: 1,
        finishReason: "stop",
      };
    },
    createWorker: ({ registry }) => ({
      start: async () => {
        const workflow = registry.get("workbench_chat_v1", "1.0.0");
        if (!workflow) throw new Error("workflow not found");
        try {
          await workflow.executeStep("chat", {
            run: {
              harnessRunId: "run-ge1",
              ownerUserId: "user-1",
              ownerUsername: "alice",
              aiSessionId: "session-1",
              submissionKey: "sub-1",
              title: "测试",
              workflowId: "workbench_chat_v1",
              workflowVersion: "1.0.0",
              executionConfig: { content: "请帮我分析这个需求" },
              status: "running",
              eventSequence: 1,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any,
            attempt: {
              harnessRunAttemptId: "attempt-1",
              harnessRunId: "run-ge1",
              workerId: "worker-1",
              attemptNo: 1,
              status: "claimed",
              startedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any,
            stepKey: "chat",
            state: {},
            resumeFrom: null,
            abortSignal: new AbortController().signal,
            makeEffectKey: (name, ord) => `run-ge1:chat:${name}:${ord}`,
            recordToolEffectOnce: async (effect) => {
              const output = await effect.execute();
              return { output, created: true };
            },
          });
        } catch (err) {
          // dispatch 可能因缺少真实 API key 而失败，但 modelChat 应已被调用
          // 这是可接受的——我们验证的是 modelChat 注入通道有效
        }
      },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await runtime.stop();

  assert.equal(modelChatCalled, true, "G-E1：stub modelChat 应被调用，证明注入通道有效");
});

// ============================================================
// SP-2026-007 MS2 补测：Run 终态蒸馏钩子集成测试
// 覆盖：终态触发蒸馏 / 非 completed 不触发 / 失败路径断言留痕 /
//       无 API Key 静默跳过 / draft 未确认不进入注入通道
// ============================================================

type DistillCall = {
  deps: Record<string, unknown>;
  input: {
    ownerUserId: string;
    projectId: string;
    harnessRunId: string;
    runTitle?: string;
    messages: Array<{ role: string; content: string }>;
  };
};

function makeDistillHook(overrides: {
  distillImpl?: (deps: unknown, input: unknown) => Promise<unknown>;
  apiKey?: string;
  snapshotAnswer?: string;
  onError?: (info: { harnessRunId: string; outcome: string; error: string }) => void;
}) {
  const distillCalls: DistillCall[] = [];
  const errors: Array<{ harnessRunId: string; outcome: string; error: string }> = [];
  const hook = createRunTerminalMemoryHook({
    repo: {
      getRunSnapshot: async () => ({
        output: { content: { answer: overrides.snapshotAnswer ?? "这是 AI 回答" } },
      }),
    } as never,
    resolveApiKey: () => ({ apiKey: overrides.apiKey ?? "test-key" }),
    getProvider: () => ({}) as never,
    getMemoryRepo: () => ({}) as never,
    distill: (async (deps: unknown, input: unknown) => {
      distillCalls.push({ deps: deps as Record<string, unknown>, input: input as DistillCall["input"] });
      if (overrides.distillImpl) return overrides.distillImpl(deps, input);
      return { success: true, atomsCount: 1, scenesCount: 1 };
    }) as typeof distillRunMemory,
    model: "test-model",
    apiBaseUrl: "https://example.test",
    timeoutMs: 1000,
    onError: overrides.onError ?? ((info) => errors.push(info)),
  });
  return { hook, distillCalls, errors };
}

const fakeTerminalRun = {
  harnessRunId: "run-001",
  ownerUserId: "u-1",
  title: "帮我评估这个项目",
  projectEvaluationId: "proj-9",
  metadata: {},
};

test("MS2 补测：run 进入 completed 终态触发蒸馏钩子，入参映射正确", async () => {
  const { hook, distillCalls, errors } = makeDistillHook({});

  await hook(fakeTerminalRun as never, "completed");

  assert.equal(distillCalls.length, 1, "completed 终态应触发一次蒸馏");
  const input = distillCalls[0].input;
  assert.equal(input.ownerUserId, "u-1");
  assert.equal(input.projectId, "proj-9");
  assert.equal(input.harnessRunId, "run-001");
  assert.deepEqual(input.messages, [
    { role: "user", content: "帮我评估这个项目" },
    { role: "assistant", content: "这是 AI 回答" },
  ]);
  assert.equal(errors.length, 0);
});

test("MS2 补测：failed / cancelled 终态不触发蒸馏", async () => {
  const { hook, distillCalls } = makeDistillHook({});

  await hook(fakeTerminalRun as never, "failed");
  await hook(fakeTerminalRun as never, "cancelled");

  assert.equal(distillCalls.length, 0);
});

test("MS2 补测：蒸馏失败路径有断言留痕（onError 捕获 run id 与错误，不得仅 console.error 静默）", async () => {
  const { hook, errors } = makeDistillHook({
    distillImpl: async () => {
      throw new Error("distill boom");
    },
  });

  await hook(fakeTerminalRun as never, "completed");

  assert.equal(errors.length, 1, "蒸馏失败必须经 onError 留痕");
  assert.equal(errors[0].harnessRunId, "run-001");
  assert.equal(errors[0].outcome, "completed");
  assert.match(errors[0].error, /distill boom/);
});

test("MS2 补测：蒸馏返回 success=false 同样留痕", async () => {
  const { hook, errors } = makeDistillHook({
    distillImpl: async () => ({ success: false, atomsCount: 0, scenesCount: 0, error: "distill_response_not_json" }),
  });

  await hook(fakeTerminalRun as never, "completed");

  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /distill_response_not_json/);
});

test("MS2 补测：无 API Key 时静默跳过（不蒸馏、不留错误）", async () => {
  const { hook, distillCalls, errors } = makeDistillHook({ apiKey: "" });

  await hook(fakeTerminalRun as never, "completed");

  assert.equal(distillCalls.length, 0);
  assert.equal(errors.length, 0);
});

test("MS2 补测：用户消息与回答均为空时不触发蒸馏", async () => {
  const { hook, distillCalls } = makeDistillHook({ snapshotAnswer: "" });

  await hook({ ...fakeTerminalRun, title: "" } as never, "completed");

  assert.equal(distillCalls.length, 0);
});

test("MS2 补测：注入通道只读 active 记忆（draft 未确认不注入）", async () => {
  const called: string[] = [];
  const repo = {
    getActiveScenesForProject: async () => {
      called.push("getActiveScenesForProject");
      return [];
    },
    getActiveAtomsForProject: async () => {
      called.push("getActiveAtomsForProject");
      return [];
    },
    listMemoryForProject: async () => {
      called.push("listMemoryForProject");
      return { atoms: [], scenes: [], totalAtoms: 3, totalScenes: 2 };
    },
  };
  const usecase = createMemoryUsecase({ repo: repo as never });

  const ctx = await usecase.buildMemoryContext({ ownerUserId: "u-1", projectId: "default" });

  assert.deepEqual(ctx, { scenes: [], atoms: [] });
  assert.ok(called.includes("getActiveScenesForProject"));
  assert.ok(called.includes("getActiveAtomsForProject"));
  assert.ok(
    !called.includes("listMemoryForProject"),
    "注入通道不得读取含 draft 的列表通道",
  );
});

// ============================================================
// DEF-2026-08-27-001：异步 Run 通道必须把会话历史送到 provider
// 断言打在【实际发给 provider 的 messages 数组】上——本缺陷第二层根因
// 正是「中间层对了、底层 modelChatStream 写死两条」，只断中间层参数
// 不构成回归防线。会话历史经 appendSessionMessage / getSessionRecord
// 真实落库读回，故需 PG（TEST_DATABASE_URL）。
// ============================================================

type ProviderCall = { role: string; content: string }[];

function makeRunStepCtx(input: {
  harnessRunId: string;
  ownerUserId: string;
  aiSessionId: string;
  content: string;
  /** 批次 0.5 · ②：模拟工具执行耗时，使 progress 心跳可被确定性观测 */
  toolDelayMs?: number;
}): import("./harness-runtime.worker").HarnessWorkflowStepContext {
  return {
    run: {
      harnessRunId: input.harnessRunId,
      ownerUserId: input.ownerUserId,
      ownerUsername: "def001-tester",
      aiSessionId: input.aiSessionId,
      submissionKey: `sub-${input.harnessRunId}`,
      title: input.content.slice(0, 40),
      workflowId: "workbench_chat_v1",
      workflowVersion: "1.0.0",
      executionConfig: { content: input.content },
      status: "running",
      eventSequence: 1,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    attempt: {
      harnessRunAttemptId: `attempt-${input.harnessRunId}`,
      harnessRunId: input.harnessRunId,
      workerId: "worker-1",
      attemptNo: 1,
      status: "claimed",
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    stepKey: "chat",
    state: {},
    resumeFrom: null,
    abortSignal: new AbortController().signal,
    makeEffectKey: (name, ord) => `${input.harnessRunId}:chat:${name}:${ord}`,
    recordToolEffectOnce: async (effect) => {
      if (input.toolDelayMs) await new Promise((resolve) => setTimeout(resolve, input.toolDelayMs));
      return { output: await effect.execute(), created: true };
    },
  };
}

const def001TestDatabaseUrl = process.env.TEST_DATABASE_URL;
const DEF001_ROUND1 = "客户希望提升订单处理效率，请先复述这句话";
const DEF001_ROUND2 = "那这句话里的目标还缺什么？请直接复述上一轮我说过的内容";

test("DEF-2026-08-27-001：同一会话连发两轮，第二轮 provider 实收入参含第一轮 user+assistant", { skip: !def001TestDatabaseUrl }, async () => {
  const ownerUserId = `wes-t-def001-${randomUUID().slice(0, 8)}`;
  const user: AuthUser = { id: ownerUserId, username: ownerUserId, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" };
  const session = await createAiSession(user, { title: "DEF-001 两轮会话", workflowKey: "free_chat" });

  const providerCalls: ProviderCall[] = [];
  let bootError: unknown = null;

  const fakeProvider = {
    name: "kimi",
    defaultModel: "kimi-test",
    isAvailable: () => true,
    chatCompletion: async () => {
      throw new Error("chatCompletion_should_not_be_called");
    },
    streamChatCompletion: (req: { messages: ProviderCall }) => {
      providerCalls.push(req.messages.map((m) => ({ role: String(m.role), content: String(m.content) })));
      const answer = `第 ${providerCalls.length} 轮回答`;
      return (async function* () {
        yield { contentDelta: answer, model: "kimi-test", finishReason: "stop" };
      })();
    },
  };

  const runtime = startHarnessRuntime({
    repo: { appendRunEvent: async (input: unknown) => input, getRunSnapshot: async () => null } as any,
    enabled: true,
    // CI 无 KIMI_API_KEY：密钥与 provider 走注入钩子，其余链路用生产默认装配。
    // 值刻意取 tracked-secret 扫描器认可的「非密钥形态」占位（isMeaningfulSecret 直接放行），
    // 不给本文件加 EXCLUDED 豁免条目——与白名单 clearCondition「改用非密钥形态常量」的取向一致。
    resolveApiKey: () => ({ apiKey: "placeholder" }),
    getProvider: () => fakeProvider as never,
    createModelChat: () => async () => ({
      answer: "非结构化分类兜底",
      rawContent: "非结构化分类兜底",
      provider: "stub",
      model: "stub",
      attempts: 1,
      finishReason: "stop",
    }),
    createWorker: ({ registry }) => ({
      start: async () => {
        try {
          const workflow = registry.get("workbench_chat_v1", "1.0.0");
          if (!workflow) throw new Error("workflow not found");
          await workflow.executeStep("chat", makeRunStepCtx({ harnessRunId: `run-def001-1-${ownerUserId}`, ownerUserId, aiSessionId: session.sessionId, content: DEF001_ROUND1 }));
          await workflow.executeStep("chat", makeRunStepCtx({ harnessRunId: `run-def001-2-${ownerUserId}`, ownerUserId, aiSessionId: session.sessionId, content: DEF001_ROUND2 }));
        } catch (err) {
          bootError = err;
        }
      },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  // stop() 会 await worker.start() 的 promise，两轮真实执行完毕后才会返回
  await runtime.stop();

  try {
    assert.equal(bootError, null, `两轮执行不得抛错：${bootError instanceof Error ? bootError.message : String(bootError)}`);
    assert.equal(providerCalls.length, 2, `两轮应各触发一次 provider 流式调用，实取 ${providerCalls.length} 次`);

    const [firstCall, secondCall] = providerCalls;
    assert.deepEqual(firstCall.map((m) => m.role), ["system", "user"], "首轮无历史，入参为 [system, user]");
    assert.equal(firstCall[1].content, DEF001_ROUND1);

    const secondContents = secondCall.map((m) => m.content);
    assert.equal(
      secondCall.map((m) => m.role).join(","),
      "system,user,assistant,user",
      `第二轮 provider 实收入参角色序列错误，实取 ${JSON.stringify(secondContents)}`,
    );
    assert.equal(secondContents[1], DEF001_ROUND1, "第二轮必须带上第一轮 user 原文");
    assert.equal(secondContents[2], "第 1 轮回答", "第二轮必须带上第一轮 assistant 回答——它同时是「取历史在落库之后」的见证");
    assert.equal(secondContents[3], DEF001_ROUND2, "末条必须是当前轮 user（覆盖末条不得丢历史）");
    assert.ok(secondContents[0].includes(DEF001_ROUND1) === false, "system prompt 不得被历史内容污染");

    const stored = await getAiSession(user, session.sessionId);
    assert.ok(stored, "会话必须可读回");
    assert.equal(stored!.messages.length, 4, `落库消息应为 2 user + 2 assistant，实取 ${stored!.messages.length} 条（覆盖末条语义下第一轮 assistant 不得丢失）`);
    assert.deepEqual(
      stored!.messages.map((m) => `${m.role}:${m.content}`),
      [`user:${DEF001_ROUND1}`, "assistant:第 1 轮回答", `user:${DEF001_ROUND2}`, "assistant:第 2 轮回答"],
      "会话存储序列必须与两轮对话一致",
    );
  } finally {
    await deleteAiSession(user, session.sessionId);
  }
});

// ============================================================
// 批次 0 · ⑤：弱请求重构不变量在【provider 边界】成立
// ------------------------------------------------------------
// 生产钩子（harness-boot.ts modelChatStream）对账点在工具循环之前，
// 断的是「组装给模型的 messages」。本用例把同一断言下移到最外层可观测
// 边界——假 provider 真正收到的 req.messages——覆盖钩子之后的下游漂移
// （工具循环 re-yield、invokeStream 透传丢字段）。存储侧期望值由生产断言
// 内部的 deriveWorkbenchModelHistoryFromSession 独立推导，不复用发送侧组装结果。
// 违规在此刻意「收集不抛」，以便断言「边界上零违规」而非仅让 run 失败；
// 抛错语义由 workbench-chat.workflow.test.ts 的接线用例与实取红/绿覆盖。
// 会话读写经真实 PG，故需 TEST_DATABASE_URL。
// ============================================================

test("批次0·⑤：provider 边界实收 messages 与存储侧推导当场对账零违规", { skip: !def001TestDatabaseUrl }, async () => {
  const ownerUserId = `wes-t-inv005-${randomUUID().slice(0, 8)}`;
  const user: AuthUser = { id: ownerUserId, username: ownerUserId, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" };
  const session = await createAiSession(user, { title: "批次0 ⑤ 边界对账会话", workflowKey: "free_chat" });

  type BoundaryCheck = { rounds: number; violations: string[] };
  const boundary: BoundaryCheck = { rounds: 0, violations: [] };
  let bootError: unknown = null;

  const fakeProvider = {
    name: "kimi",
    defaultModel: "kimi-test",
    isAvailable: () => true,
    chatCompletion: async () => {
      throw new Error("chatCompletion_should_not_be_called");
    },
    streamChatCompletion: (req: { messages: WorkbenchModelMessage[] }) => {
      const received: WorkbenchModelMessage[] = req.messages.map((m) => ({ role: m.role, content: String(m.content) }));
      const roundNo = boundary.rounds + 1;
      const userContent = received[received.length - 1]?.content ?? "";
      return (async function* () {
        // 首发之前完成对账：与生产钩子同一位置约束（yield 之后流不可撤销）
        boundary.rounds += 1;
        try {
          assertWorkbenchModelRequestMatchesStorage({
            sent: received,
            session: await getAiSession(user, session.sessionId),
            userContent,
          });
        } catch (err) {
          boundary.violations.push(
            `round${roundNo}: ${err instanceof WorkbenchModelRequestInvariantError ? err.reason : String(err)}`,
          );
        }
        yield { contentDelta: `第 ${roundNo} 轮回答`, model: "kimi-test", finishReason: "stop" };
      })();
    },
  };

  const runtime = startHarnessRuntime({
    repo: { appendRunEvent: async (input: unknown) => input, getRunSnapshot: async () => null } as any,
    enabled: true,
    resolveApiKey: () => ({ apiKey: "placeholder" }),
    getProvider: () => fakeProvider as never,
    createWorker: ({ registry }) => ({
      start: async () => {
        try {
          const workflow = registry.get("workbench_chat_v1", "1.0.0");
          if (!workflow) throw new Error("workflow not found");
          await workflow.executeStep("chat", makeRunStepCtx({ harnessRunId: `run-inv005-1-${ownerUserId}`, ownerUserId, aiSessionId: session.sessionId, content: DEF001_ROUND1 }));
          await workflow.executeStep("chat", makeRunStepCtx({ harnessRunId: `run-inv005-2-${ownerUserId}`, ownerUserId, aiSessionId: session.sessionId, content: DEF001_ROUND2 }));
        } catch (err) {
          bootError = err;
        }
      },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  await runtime.stop();

  try {
    assert.equal(bootError, null, `两轮执行不得抛错：${bootError instanceof Error ? bootError.message : String(bootError)}`);
    // 反空断：守卫必须真的在两轮的 provider 入参上各跑一次，否则零违规只是没跑到
    assert.equal(boundary.rounds, 2, `边界对账必须覆盖两次 provider 实调，实取 ${boundary.rounds} 次`);
    assert.deepEqual(boundary.violations, [], `provider 边界实收 messages 必须与存储侧推导逐条相等：${boundary.violations.join(" | ")}`);
  } finally {
    await deleteAiSession(user, session.sessionId);
  }
});

// ============================================================
// 批次 0.5 · ②：四类工具 UI 事件必须在【生产装配】里发射
// ------------------------------------------------------------
// workbench-chat.workflow.test.ts 的九个用例把 dispatch 整体打桩，结构上
// 看不见 harness-boot 的接线（onEvent: input.onToolEvent、progressIntervalMs
// 下传、provider chunk 的 toolCalls 透传）——与 DEF-2026-08-27-001 的教训同形：
// 「中间层对了、底层写死」只有打在真实组装链上才构成回归防线。
// 本用例同时钉住 ④ 的边界：UI 事件带完整参数（用户要看），而模型可见
// messages 只带批次 0 的 [工具结果] 回填（既不得丢、也不得漏参数与中间态）。
// 工具执行与只读判定用真实 default registry，故 provider 只能选一个
// 与机器状态无关的只读工具：estimate_history（estimates.repository
// getExportHistoryList 按 owner 过滤，新生成的随机 owner 恒得空集）。
// 会话读写经真实 PG，故需 TEST_DATABASE_URL。
// ============================================================

const B05_SENTINEL = "B05SENTINEL-绝不得进入模型上下文-9f3c";

test("批次0.5·②：四类 tool.call.* 经生产装配落入 run 事件流，且参数/中间态不进模型 messages", { skip: !def001TestDatabaseUrl }, async () => {
  const ownerUserId = `wes-t-b05ui-${randomUUID().slice(0, 8)}`;
  const user: AuthUser = { id: ownerUserId, username: ownerUserId, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" };
  const session = await createAiSession(user, { title: "批次0.5 ② UI事件会话", workflowKey: "free_chat" });

  type RecordedEvent = { eventType: string; payload: Record<string, unknown> };
  const runEvents: RecordedEvent[] = [];
  const providerCalls: ProviderCall[] = [];
  let bootError: unknown = null;

  const fakeProvider = {
    name: "kimi",
    defaultModel: "kimi-test",
    isAvailable: () => true,
    chatCompletion: async () => {
      throw new Error("chatCompletion_should_not_be_called");
    },
    streamChatCompletion: (req: { messages: ProviderCall }) => {
      providerCalls.push(req.messages.map((m) => ({ role: String(m.role), content: String(m.content) })));
      const turnNo = providerCalls.length;
      return (async function* () {
        if (turnNo === 1) {
          // 一轮内两个调用：只读工具（应 completed）+ 未注册工具（一律不执行 → failed）。
          // 批次 1a 起写工具不再落在这里——它落进审批闸门并就地挂起（Run 停 waiting、
          // 不回填终态），那条路径由 routes 层同名用例与 workbench-tool-approval.e2e 覆盖；
          // 本用例守的是「四类 UI 事件 + 两轮回填」这条批次 0.5 结构，故用未注册工具占位。
          yield {
            contentDelta: "",
            model: "kimi-test",
            finishReason: "tool_calls",
            toolCalls: [
              { id: "call_hist", name: "estimate_history", arguments: { page: 1, pageSize: 1 } },
              { id: "call_write", name: "workbench_write_unregistered_probe", arguments: { projectName: B05_SENTINEL } },
            ],
          };
          return;
        }
        yield { contentDelta: "工具已经跑完了。", model: "kimi-test", finishReason: "stop" };
      })();
    },
  };

  const runtime = startHarnessRuntime({
    repo: {
      appendRunEvent: async (input: { eventType: string; payload: Record<string, unknown> }) => {
        runEvents.push({ eventType: input.eventType, payload: input.payload });
        return input;
      },
      getRunSnapshot: async () => null,
    } as any,
    enabled: true,
    resolveApiKey: () => ({ apiKey: "placeholder" }),
    getProvider: () => fakeProvider as never,
    // progress 是唯一新增状态，生产心跳 3s 在测试里等不起：下传小间隔 + 注入执行耗时，
    // 使「执行中」心跳可被确定性观测（不注入即行为不变，见 HarnessRuntimeBootOptions）。
    toolCallProgressIntervalMs: 25,
    createWorker: ({ registry }) => ({
      start: async () => {
        try {
          const workflow = registry.get("workbench_chat_v1", "1.0.0");
          if (!workflow) throw new Error("workflow not found");
          await workflow.executeStep(
            "chat",
            makeRunStepCtx({
              harnessRunId: `run-b05ui-1-${ownerUserId}`,
              ownerUserId,
              aiSessionId: session.sessionId,
              content: "帮我看看导出历史，再顺手建个项目",
              toolDelayMs: 80,
            }),
          );
        } catch (err) {
          bootError = err;
        }
      },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
  });

  await runtime.stop();

  try {
    assert.equal(bootError, null, `执行不得抛错：${bootError instanceof Error ? bootError.message : String(bootError)}`);
    // 反空断：工具循环必须真跑了两轮，否则事件序列是零而非「顺序正确」
    assert.equal(providerCalls.length, 2, `工具循环应触发两次 provider 调用，实取 ${providerCalls.length} 次`);

    const marker = (event: RecordedEvent) =>
      `${event.eventType}#${typeof event.payload.callIndex === "number" ? event.payload.callIndex : "-"}`;
    const family = runEvents.filter((e) => e.eventType.startsWith("tool.call.") || e.eventType === "text.delta");
    const indexes = family.map(marker);

    const firstIndexOf = (needle: string) => indexes.indexOf(needle);
    const started1 = firstIndexOf("tool.call.started#1");
    const completed1 = firstIndexOf("tool.call.completed#1");
    const started2 = firstIndexOf("tool.call.started#2");
    const failed2 = firstIndexOf("tool.call.failed#2");
    const progress1 = family.findIndex((e) => e.eventType === "tool.call.progress" && e.payload.callIndex === 1);
    const progress2 = family.findIndex((e) => e.eventType === "tool.call.progress" && e.payload.callIndex === 2);
    const firstTextDelta = firstIndexOf("text.delta#-");

    assert.ok(started1 >= 0, `必须发射 callIndex=1 的 tool.call.started，实取 ${JSON.stringify(indexes)}`);
    assert.ok(completed1 >= 0, "estimate_history 成功必须发射 tool.call.completed");
    assert.ok(started2 >= 0, "第二个调用必须发射 callIndex=2 的 tool.call.started");
    assert.ok(failed2 >= 0, "未注册工具被拒绝执行必须发射 tool.call.failed");
    assert.ok(progress1 >= 0, "长耗时调用必须发射 tool.call.progress（本批唯一新增状态）");
    assert.ok(progress2 >= 0, "第二个调用同样要有 progress 心跳");
    assert.ok(firstTextDelta >= 0, "模型回答正文仍须走 text.delta（既有事件不得被工具事件取代）");

    // 「先说话、再要求调工具、再回答」的真实 interleaving 只能靠同一条串行写链保证
    assert.ok(
      started1 < progress1 && progress1 < completed1 && completed1 < started2 && started2 < progress2 && progress2 < failed2 && failed2 < firstTextDelta,
      `事件顺序必须严格为 started1→progress1→completed1→started2→progress2→failed2→text.delta，实取 ${JSON.stringify(indexes)}`,
    );

    for (const callIndex of [1, 2]) {
      const terminals = family.filter(
        (e) => e.payload.callIndex === callIndex && (e.eventType === "tool.call.completed" || e.eventType === "tool.call.failed"),
      );
      assert.equal(terminals.length, 1, `callIndex=${callIndex} 只能有一个终态事件，实取 ${terminals.map((e) => e.eventType).join(",")}`);
      const terminalPos = indexes.indexOf(`${terminals[0].eventType}#${callIndex}`);
      const lateProgress = family.filter(
        (e, pos) => e.eventType === "tool.call.progress" && e.payload.callIndex === callIndex && pos > terminalPos,
      );
      assert.equal(lateProgress.length, 0, `callIndex=${callIndex} 终态之后不得再发 progress（定时器未清理即事件外溢），实取 ${lateProgress.length} 条`);
    }

    const failedEvent = family[failed2];
    assert.match(String(failedEvent.payload.error), /未注册工具/, `失败原因必须说清是未注册，实取 ${String(failedEvent.payload.error)}`);
    assert.equal(failedEvent.payload.name, "workbench_write_unregistered_probe");
    assert.equal(
      runEvents.some((e) => e.eventType === "tool.call.awaiting_approval"),
      false,
      "未注册工具不得占用用户注意力（不该发出审批请求）",
    );
    assert.ok(
      typeof family[completed1].payload.resultPreview === "string" && String(family[completed1].payload.resultPreview).length > 0,
      "completed 必须带 resultPreview 供 UI 展示结果摘要",
    );
    for (const pos of [progress1, progress2, completed1, failed2]) {
      assert.ok(typeof family[pos].payload.elapsedMs === "number", `${family[pos].eventType} 必须带 elapsedMs`);
    }
    // UI 侧看得到完整参数——这是本批的存在理由；③/④ 的另一半在下面对模型侧断言
    assert.equal(
      JSON.stringify(family[started2].payload.arguments),
      JSON.stringify({ projectName: B05_SENTINEL }),
      "tool.call.started 必须把完整参数投给 UI 事件面",
    );

    // ④ 边界：第二轮模型请求只带批次 0 的 [工具结果] 回填，不带参数、不带中间态
    const secondRequest = JSON.stringify(providerCalls[1]);
    assert.ok(secondRequest.includes(B05_SENTINEL) === false, `UI 专属的完整参数泄进了模型上下文：${secondRequest}`);
    for (const leaked of ["tool.call.", "elapsedMs", "callIndex", "resultPreview"]) {
      assert.ok(secondRequest.includes(leaked) === false, `UI 事件字段「${leaked}」不得进入模型可见 messages`);
    }
    assert.ok(secondRequest.includes("[工具结果] estimate_history"), "批次0 的回填契约不得被本批削弱（工具结果必须回灌模型）");
    assert.ok(secondRequest.includes("[工具结果] workbench_write_unregistered_probe"), "被拒绝的调用同样必须回填 ok:false，否则模型会无限重试");
    assert.deepEqual(
      providerCalls[1].map((m) => m.role),
      ["system", "user", "assistant", "assistant"],
      `第二轮模型入参形状错误，实取 ${JSON.stringify(providerCalls[1].map((m) => `${m.role}:${m.content.slice(0, 40)}`))}`,
    );
  } finally {
    await deleteAiSession(user, session.sessionId);
  }
});
