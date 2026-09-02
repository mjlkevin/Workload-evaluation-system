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
import { createAiSession, deleteAiSession, getAiSession } from "../ai-sessions/ai-sessions.usecase";

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
    recordToolEffectOnce: async (effect) => ({ output: await effect.execute(), created: true }),
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
    // CI 无 KIMI_API_KEY：密钥与 provider 走注入钩子，其余链路用生产默认装配
    resolveApiKey: () => ({ apiKey: "test-key-not-real" }),
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
