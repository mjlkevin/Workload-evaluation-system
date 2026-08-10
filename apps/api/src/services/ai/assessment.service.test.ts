import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { requirementSystemConfigStorePath } from "../../utils";
import { kimiAssessmentPreview } from "./assessment.service";
import { defaultProviderRegistry, type ModelProvider, type ChatCompletionRequest, type ChatCompletionResponse } from "../../ai/provider";
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
  mutate: (store: ReturnType<typeof loadRequirementSystemConfigStore>) => void,
  run: (provider: ModelProvider & { lastRequest?: ChatCompletionRequest }) => Promise<void>,
): Promise<void> {
  const storePath = requirementSystemConfigStorePath();
  const existed = fs.existsSync(storePath);
  const before = existed ? fs.readFileSync(storePath, "utf-8") : "";
  const previousProvider = defaultProviderRegistry.get("kimi");
  const mockProvider = createCapturingKimiProvider();
  defaultProviderRegistry.register(mockProvider, { asDefault: true });
  try {
    const store = loadRequirementSystemConfigStore();
    mutate(store);
    saveRequirementSystemConfigStore(store);
    await run(mockProvider);
  } finally {
    if (existed) {
      fs.writeFileSync(storePath, before, "utf-8");
    } else if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }
    defaultProviderRegistry.unregister("kimi");
    if (previousProvider) defaultProviderRegistry.register(previousProvider);
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

// T1（评估链路改读配置模型）：评估主链路必须使用 kimiEvaluation.model，env KIMI_MODEL 仅作兜底
test("T1: 评估主链路使用 kimiEvaluation.model 作为实际调用模型", async () => {
  await withAssessmentSandbox(
    (store) => {
      store.active.kimiEvaluation.model = "kimi-k9-config-test";
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
        "评估调用模型必须来自 kimiEvaluation.model，而不是 env KIMI_MODEL",
      );
      const payload = captured.jsonPayload as { code: number };
      assert.equal(payload.code, 0, "评估草稿应成功返回");
    },
  );
});

test("T1 守护: kimiEvaluation.model 为空时回退 env KIMI_MODEL", async () => {
  await withAssessmentSandbox(
    (store) => {
      store.active.kimiEvaluation.model = "";
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
