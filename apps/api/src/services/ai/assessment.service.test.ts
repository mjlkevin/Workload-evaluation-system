import assert from "node:assert/strict";
import test from "node:test";

import { kimiAssessmentPreview } from "./assessment.service";
import { defaultProviderRegistry, type ModelProvider, type ChatCompletionRequest, type ChatCompletionResponse } from "../../ai/provider";
import { getCachedApiKey, KIMI_SCOPE, resetCredentialCache, setCachedApiKey } from "../../modules/system/credentials.store";
import { loadRequirementSystemConfigStore, saveRequirementSystemConfigStore } from "../../modules/system/system.repository";

function createCapturingKimiProvider(): ModelProvider & { lastRequest?: ChatCompletionRequest } {
  return {
    name: "kimi",
    defaultModel: "mock",
    isAvailable: () => true,
    async chatCompletion(req): Promise<ChatCompletionResponse> {
      this.lastRequest = req;
      const draft = {
        quoteMode: "模块报价",
        productLines: ["财务云"],
        userCount: 10,
        orgCount: 1,
        orgSimilarity: 0.5,
        difficultyFactor: 0.5,
        moduleItems: [
          { cloudProduct: "财务云", skuName: "总账", moduleName: "总账", standardDays: 1, suggestedDays: 1, reason: "测试" },
        ],
        risks: [],
        assumptions: [],
      };
      const content = JSON.stringify(draft);
      return { content, rawContent: content, model: "mock", provider: "kimi", attempts: 1 };
    },
  };
}

/** 快照需求系统配置 store 与 provider 注册表，注入 mock provider，结束后原样恢复 */
async function withAssessmentSandbox(
  // 阶段 1 批 5：accessor 已异步化，ReturnType 需 Awaited 解包（断言不变）。
  mutate: (store: Awaited<ReturnType<typeof loadRequirementSystemConfigStore>>) => void,
  run: (provider: ModelProvider & { lastRequest?: ChatCompletionRequest }) => Promise<void>,
): Promise<void> {
  // S3（2026-08-30）：requirementSettings 的状态源从 config/system/*.json 换成了
  // system_configs 单行，已经没有文件可快照。改用公共 accessor 做逻辑快照：
  // 进入时读回整份 store，finally 原样写回（与旧文件快照同一口径——「结束后原样恢复」）。
  // 不用裸 SQL 还原行：表列布局（config_key / store jsonb / version）是仓储私有细节，
  // 业务测试直写会踩破 Repository 边界（AGENTS §2）。代价是原本无行时会留下一行默认
  // 内容，而默认内容与 loadRequirementSystemConfigStore 的兜底返回等价、语义零变化；
  // CI 测试库每个 job 新建，本地只会落 test 库（src/db/client.ts 的测试守卫兜底）。
  // 竞态约束：本文件向 system_configs 写入 → 必须待在 test:modules:serial-store 串行组
  //（守卫 single-doc-serial-scope.drift.test.ts 以 saveRequirementSystemConfigStore 为写入指纹）。
  const previousStore = await loadRequirementSystemConfigStore();
  const previousProvider = defaultProviderRegistry.get("kimi");
  const previousApiKey = getCachedApiKey(KIMI_SCOPE);
  const mockProvider = createCapturingKimiProvider();
  defaultProviderRegistry.register(mockProvider, { asDefault: true });
  setCachedApiKey(KIMI_SCOPE, "sk-assessment-test-only");
  try {
    const store = await loadRequirementSystemConfigStore();
    mutate(store);
    await saveRequirementSystemConfigStore(store);
    await run(mockProvider);
  } finally {
    await saveRequirementSystemConfigStore(previousStore);
    defaultProviderRegistry.unregister("kimi");
    if (previousProvider) defaultProviderRegistry.register(previousProvider);
    if (previousApiKey) setCachedApiKey(KIMI_SCOPE, previousApiKey);
    else resetCredentialCache();
  }
}

function createMockRes() {
  const captured: { jsonPayload?: unknown } = {};
  const res = {
    json(payload: unknown) {
      captured.jsonPayload = payload;
      return res;
    },
  };
  return { res: res as never, captured };
}

// T1（评估链路改读配置模型）：评估主链路必须使用配置模型，env KIMI_MODEL 仅作兜底
// RP-055 契约演进：权威源升级为场景绑定（scenarioBindings.assessment），
// 旧字段补丁经 syncBindingsWithLegacyPatch 联动同步，两者保持一致。
test("T1: 评估主链路使用配置模型作为实际调用模型（场景绑定权威源）", async () => {
  await withAssessmentSandbox(
    (store) => {
      store.active.kimiEvaluation.model = "kimi-k9-config-test";
      store.active.scenarioBindings = {
        ...store.active.scenarioBindings!,
        assessment: { providerId: "moonshot", modelId: "kimi-k9-config-test" },
      };
    },
    async (provider) => {
      const req = { body: { requirementSnapshot: { projectName: "测试项目" } } } as never;
      const { res, captured } = createMockRes();
      await kimiAssessmentPreview(req, res);

      const request = provider.lastRequest;
      assert.ok(request, "mock provider 应收到一次 chatCompletion 请求");
      assert.equal(
        request!.model,
        "kimi-k9-config-test",
        "评估调用模型必须来自配置（场景绑定），而不是 env KIMI_MODEL",
      );
      const payload = captured.jsonPayload as { code: number };
      assert.equal(payload.code, 0, "评估草稿应成功返回");
    },
  );
});

test("T1 守护: 配置模型为空时回退 env KIMI_MODEL", async () => {
  await withAssessmentSandbox(
    (store) => {
      store.active.kimiEvaluation.model = "";
      store.active.scenarioBindings = {
        ...store.active.scenarioBindings!,
        assessment: { providerId: "moonshot", modelId: "" },
      };
    },
    async (provider) => {
      const req = { body: { requirementSnapshot: { projectName: "测试项目" } } } as never;
      const { res } = createMockRes();
      await kimiAssessmentPreview(req, res);

      const request = provider.lastRequest;
      assert.ok(request, "mock provider 应收到一次 chatCompletion 请求");
      assert.ok(String(request!.model || "").trim().length > 0, "回退后仍应有可用模型名");
      assert.notEqual(request!.model, "kimi-k9-config-test");
    },
  );
});
