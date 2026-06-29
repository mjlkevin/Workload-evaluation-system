import test from "node:test";
import assert from "node:assert/strict";

import { defaultProviderRegistry } from "../../ai/provider";
import type { ChatCompletionRequest, ChatCompletionResponse, ModelProvider } from "../../ai/provider/model-provider";
import { generateDevAssessmentDraft } from "./dev-assessment-ai";

test.afterEach(() => {
  defaultProviderRegistry.clear();
});

test("generateDevAssessmentDraft: 使用 K2.5 和稳定 prompt cache key", async () => {
  const provider: ModelProvider & { lastRequest?: ChatCompletionRequest } = {
    name: "kimi",
    defaultModel: "mock",
    isAvailable: () => true,
    async chatCompletion(req): Promise<ChatCompletionResponse> {
      provider.lastRequest = req;
      const content = JSON.stringify({
        items: [{ module: "接口同步", codingDays: 3, reason: "标准接口改造" }],
      });
      return {
        content,
        rawContent: content,
        model: "mock",
        provider: "kimi",
        attempts: 1,
      };
    },
  };
  defaultProviderRegistry.register(provider, { asDefault: true });

  const result = await generateDevAssessmentDraft({
    items: [{ domain: "集成", module: "接口同步", description: "对接第三方系统", devType: "integration", codingDays: 3 }],
  });

  assert.equal(result.usedFallback, false);
  assert.equal(provider.lastRequest?.model, "kimi-k2.5");
  assert.equal(provider.lastRequest?.promptCacheKey, "dev-assessment-draft-v1");
  assert.equal(provider.lastRequest?.responseFormat, "json_object");
});
