// ============================================================
// DEF-2026-09-03-001：工作台对话必须按系统配置解析模型
// ============================================================
// 缺陷：三条工作台对话路径直读 config.kimi.model（env 默认值 "kimi-k2.5"），
// 完全绕开用户在系统设置里配的场景绑定。该模型被供应商下线后返回 404，
// 而失败被静态文案掩盖，自 2026-06 起无人发现。
//
// 断言口径：打在【实际发给 provider 的请求对象】上，不是中间层——
// 本缺陷的教训正是「中间层看着对、底层另读一份」。
//
// 本文件写 system_configs（saveRequirementSystemConfigStore），
// 故必须登记进 test:modules:serial-store 与 single-doc-serial-scope 守卫白名单。

import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { Request, Response } from "express";

import { config } from "../../../config/env";
import { defaultProviderRegistry, type ModelProvider } from "../../../ai/provider";
import type { ChatCompletionRequest } from "../../../ai/provider/model-provider";
import type { AuthUser } from "../../../types";
import { createAiSession, deleteAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import {
  loadRequirementSystemConfigStore,
  saveRequirementSystemConfigStore,
} from "../../../modules/system/system.repository";
import { BUILTIN_MOONSHOT_PROVIDER_ID } from "../../../modules/system/model-providers";
import { homeWorkbenchChatStream } from "./workbench-chat-stream.handler";
import { buildWorkbenchChatDispatchInput, resolveWorkbenchChatScenario } from "./workbench-shared";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const TEST_USER_ID = "wes-def-20260903-001-user";

/** 把 assessment 场景绑定钉到指定模型；返回恢复函数，必须在 finally 调用。 */
async function pinAssessmentModel(modelId: string): Promise<() => Promise<void>> {
  const store = await loadRequirementSystemConfigStore();
  const snapshot = JSON.parse(JSON.stringify(store)) as typeof store;
  const builtin = { providerId: BUILTIN_MOONSHOT_PROVIDER_ID, modelId };
  await saveRequirementSystemConfigStore({
    ...store,
    active: {
      ...store.active,
      scenarioBindings: {
        assessment: builtin,
        generation: store.active.scenarioBindings?.generation ?? builtin,
        fileParsing: store.active.scenarioBindings?.fileParsing ?? builtin,
      },
    },
  });
  return async () => {
    await saveRequirementSystemConfigStore(snapshot);
  };
}

/** 清空 assessment 绑定与 legacy 模型字段，制造「解析不出模型」状态。 */
async function clearAssessmentModel(): Promise<() => Promise<void>> {
  const store = await loadRequirementSystemConfigStore();
  const snapshot = JSON.parse(JSON.stringify(store)) as typeof store;
  await saveRequirementSystemConfigStore({
    ...store,
    active: {
      ...store.active,
      scenarioBindings: {
        assessment: { providerId: "", modelId: "" },
        generation: store.active.scenarioBindings?.generation ?? { providerId: "", modelId: "" },
        fileParsing: store.active.scenarioBindings?.fileParsing ?? { providerId: "", modelId: "" },
      },
      kimiEvaluation: { ...store.active.kimiEvaluation, model: "" },
    },
  });
  return async () => {
    await saveRequirementSystemConfigStore(snapshot);
  };
}

function registerCapturingProvider(calls: ChatCompletionRequest[]): void {
  const provider: ModelProvider = {
    name: "kimi",
    defaultModel: "unused-default",
    isAvailable: () => true,
    chatCompletion: async (req: ChatCompletionRequest) => {
      calls.push(req);
      return {
        content: "答复",
        rawContent: "答复",
        model: req.model ?? "",
        provider: "kimi",
        attempts: 1,
        finishReason: "stop",
      };
    },
    streamChatCompletion: async function* (req: ChatCompletionRequest) {
      calls.push(req);
      yield { contentDelta: "答复", content: "答复", model: req.model ?? "", provider: "kimi", attempts: 1, finishReason: "stop" };
    },
  };
  defaultProviderRegistry.clear();
  defaultProviderRegistry.register(provider, { asDefault: true });
}

async function withProviderIsolation(run: () => Promise<void>): Promise<void> {
  const before = defaultProviderRegistry.list();
  const defaultBefore = defaultProviderRegistry.getDefault()?.name;
  const previousApiKey = config.kimi.apiKey;
  // CI 与本地测试库均无 kimi 凭据行，凭据解析会回落 env；不注入则链路在
  // api_key_missing 处短路，根本走不到模型调用（本用例断言的正是模型入参）。
  // 取扫描器认可的非密钥形态占位，不新增 secret 扫描豁免。
  config.kimi.apiKey = "placeholder";
  try {
    await run();
  } finally {
    config.kimi.apiKey = previousApiKey;
    defaultProviderRegistry.clear();
    for (const provider of before) {
      defaultProviderRegistry.register(provider, { asDefault: provider.name === defaultBefore });
    }
  }
}

function createMockReqRes(body: unknown): { req: Request; res: Response } {
  const req = new PassThrough() as unknown as Request;
  req.body = body;
  (req as unknown as Record<string, unknown>).user = {
    id: TEST_USER_ID,
    username: "tester",
    role: "user",
    businessRole: "pre_sales",
    status: "active",
  };
  req.on = PassThrough.prototype.on.bind(req) as unknown as Request["on"];
  const res = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: () => true,
    end: () => {},
    status: () => res,
    json: () => {},
  } as unknown as Response;
  return { req, res };
}

// ------------------------------------------------------------
// 1. 解析器契约：模型取自 assessment 绑定，改配置即变
// ------------------------------------------------------------

test("DEF-2026-09-03-001：resolveWorkbenchChatScenario 取 assessment 绑定的模型，改配置随之变化", { skip: !testDatabaseUrl }, async () => {
  const restoreA = await pinAssessmentModel("kimi-k3");
  try {
    const first = await resolveWorkbenchChatScenario();
    assert.equal(first.model, "kimi-k3", `应取 assessment 绑定模型，实取 ${first.model}`);

    const restoreB = await pinAssessmentModel("kimi-k2.6");
    try {
      const second = await resolveWorkbenchChatScenario();
      assert.equal(second.model, "kimi-k2.6", `改配置后应随之变化，实取 ${second.model}`);
    } finally {
      await restoreB();
    }
  } finally {
    await restoreA();
  }
});

test("DEF-2026-09-03-001：解析结果与 env 默认值解耦——env 为空也能解出模型", { skip: !testDatabaseUrl }, async () => {
  const restore = await pinAssessmentModel("kimi-k3");
  try {
    assert.equal(config.kimi.model, "", "env 默认值必须为空——内置模型名字面量已随本缺陷删除");
    const scenario = await resolveWorkbenchChatScenario();
    assert.equal(scenario.model, "kimi-k3", "模型必须来自系统配置而非 env 默认值");
    assert.equal(scenario.modelSource, "binding", `应走场景绑定，实取来源 ${scenario.modelSource}`);
  } finally {
    await restore();
  }
});

// 说明：resolveWorkbenchChatScenario 的 model_not_configured 守卫是防御性的，
// **经配置路径不可达**——normalizeRequirementConfig 会把空模型填回内置默认值，
// 所以「配置为空」这个状态存不进库。本用例因此改断真正成立、且真正保护用户的
// 不变量：归一化的兜底值本身不得是已下线模型（这正是本缺陷的第二处硬编码，
// 它会在用户清空配置或新装系统时静默覆盖用户设置）。
test("DEF-2026-09-03-001：清空配置后归一化兜底值不得是已下线模型，且必须非空", { skip: !testDatabaseUrl }, async () => {
  const restore = await clearAssessmentModel();
  try {
    const scenario = await resolveWorkbenchChatScenario();
    assert.notEqual(scenario.model, "kimi-k2.5", "归一化兜底值绝不得是已下线的 kimi-k2.5");
    assert.equal(scenario.model.length > 0, true, `兜底值必须非空，实取 ${JSON.stringify(scenario.model)}`);

    const store = await loadRequirementSystemConfigStore();
    assert.notEqual(
      store.active.kimiEvaluation.model,
      "kimi-k2.5",
      "写回库的 assessment 场景模型也不得是已下线的 kimi-k2.5",
    );
  } finally {
    await restore();
  }
});

// ------------------------------------------------------------
// 2. dispatch 入参：trace/展示口径的 model 与实际调用同源
// ------------------------------------------------------------

test("DEF-2026-09-03-001：buildWorkbenchChatDispatchInput 的 model 取自场景配置", { skip: !testDatabaseUrl }, async () => {
  const restore = await pinAssessmentModel("kimi-k2.6");
  try {
    const user: AuthUser = {
      id: TEST_USER_ID, username: "tester", role: "user", status: "active",
      passwordHash: "", createdAt: "", lastLoginAt: "",
    };
    const dispatchInput = await buildWorkbenchChatDispatchInput(user, "你好");
    assert.equal(dispatchInput.model, "kimi-k2.6", `trace 口径的 model 必须与实际调用同源，实取 ${dispatchInput.model}`);
  } finally {
    await restore();
  }
});

// ------------------------------------------------------------
// 3. 同步流式路径：断言打在实际发给 provider 的请求对象上
// ------------------------------------------------------------

test("DEF-2026-09-03-001：同步流式路径发给 provider 的 model 来自系统配置，改配置随之变化", { skip: !testDatabaseUrl }, async () => {
  await withProviderIsolation(async () => {
    const user: AuthUser = {
      id: TEST_USER_ID, username: "tester", role: "user", status: "active",
      passwordHash: "", createdAt: "", lastLoginAt: "",
    };
    const session = await createAiSession(user, {
      title: "DEF-001 场景模型", domain: "business_evaluation",
      workflowKey: "free_chat", status: "temporary_chat",
    });
    try {
      const body = {
        workflowKey: "free_chat",
        sessionId: session.sessionId,
        messages: [{ role: "user", content: "金蝶PLM与其他厂商的区别是什么" }],
      };

      const callsA: ChatCompletionRequest[] = [];
      registerCapturingProvider(callsA);
      const restoreA = await pinAssessmentModel("kimi-k3");
      try {
        const { req, res } = createMockReqRes(body);
        await homeWorkbenchChatStream(req, res);
      } finally {
        await restoreA();
      }
      // 流式路径一轮内可能发生多次模型调用（意图分类 + 作答），
      // 断言打在【每一次】调用上——只要有一次漏用配置值就判红。
      assert.equal(callsA.length > 0, true, "本轮必须至少发生一次模型调用");
      assert.deepEqual(
        [...new Set(callsA.map((c) => c.model))],
        ["kimi-k3"],
        `所有发给 provider 的 model 必须都是配置值，实取 ${JSON.stringify(callsA.map((c) => c.model))}`,
      );

      const callsB: ChatCompletionRequest[] = [];
      registerCapturingProvider(callsB);
      const restoreB = await pinAssessmentModel("kimi-k2.6");
      try {
        const { req, res } = createMockReqRes(body);
        await homeWorkbenchChatStream(req, res);
      } finally {
        await restoreB();
      }
      assert.equal(callsB.length > 0, true, "本轮必须至少发生一次模型调用");
      assert.deepEqual(
        [...new Set(callsB.map((c) => c.model))],
        ["kimi-k2.6"],
        `改配置后所有 model 必须随之变化，实取 ${JSON.stringify(callsB.map((c) => c.model))}`,
      );

      assert.notEqual(callsA[0].model, callsB[0].model, "两轮模型必须不同，否则不构成「改配置生效」的证据");
      assert.equal(
        [...callsA, ...callsB].some((c) => c.model === "kimi-k2.5"),
        false,
        "绝不得出现已下线的模型名 kimi-k2.5",
      );
    } finally {
      await deleteAiSession(user, session.sessionId);
    }
  });
});
