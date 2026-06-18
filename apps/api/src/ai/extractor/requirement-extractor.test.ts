// ============================================================
// 抽取器 - orchestrator 测试
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelProvider,
} from "../provider";
import { ProviderError } from "../provider";
import { extractRequirement } from "./requirement-extractor";

// -------------------- 测试夹具 --------------------

function makeFixedTimeFns(seed = 1): {
  now: () => Date;
  generateId: () => string;
} {
  let counter = 0;
  return {
    now: () => new Date(`2026-04-24T00:00:0${seed % 10}.000Z`),
    generateId: () => `id-${++counter}`,
  };
}

const SAMPLE_TEXT_RICH = [
  "工作表：1.基本信息",
  "客户名称：金蝶软件（中国）有限公司",
  "客户行业：I 信息传输、软件和信息技术服务业 > 65 软件和信息技术服务业 > 651 软件开发 > 6510 软件开发",
  "实施地点：广东省深圳市南山区",
].join("\n");

const SAMPLE_TEXT_PARTIAL = [
  "工作表：1.基本信息",
  "客户名称：某制造企业",
  // 缺 industry 与 location
].join("\n");

class StubProvider implements ModelProvider {
  readonly name = "stub";
  readonly defaultModel = "stub-model";
  available = true;
  lastRequest?: ChatCompletionRequest;

  constructor(private readonly handler: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>) {}

  isAvailable(): boolean {
    return this.available;
  }

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.lastRequest = req;
    return this.handler(req);
  }
}

function makeAiSuccessProvider(content: string): StubProvider {
  return new StubProvider(async () => ({
    content,
    rawContent: content,
    model: "stub-model",
    provider: "stub",
    attempts: 1,
    finishReason: "stop",
  }));
}

function makeAiFailingProvider(err: unknown): StubProvider {
  return new StubProvider(async () => {
    throw err;
  });
}

// -------------------- 测试用例 --------------------

test("AI 成功路径：返回 3 条 AI 证据，status=success，无 fallback", async () => {
  const provider = makeAiSuccessProvider(
    JSON.stringify({
      basicInfo: {
        customerName: "金蝶软件（中国）有限公司",
        customerIndustry: "I 信息传输 > 65 软件和信息技术服务业 > 651 软件开发 > 6510 软件开发",
        location: "广东省深圳市南山区",
      },
    }),
  );
  const fns = makeFixedTimeFns();

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_RICH, sourceRef: "test-1.xlsx" },
    { provider },
    { now: fns.now, generateId: fns.generateId },
  );

  assert.equal(result.status, "success");
  assert.equal(result.evidences.length, 3);
  assert.equal(result.fallbacks.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.sourceRef, "test-1.xlsx");
  assert.equal(result.extractorVersion, "requirement-extractor@0.1.0");

  for (const ev of result.evidences) {
    assert.equal(ev.method, "ai");
    assert.equal(ev.confidence, 0.8);
    assert.equal(ev.source.kind, "ai_inference");
    assert.equal(ev.aiMeta?.provider, "stub");
    assert.equal(ev.aiMeta?.model, "stub-model");
    assert.equal(ev.aiMeta?.attempts, 1);
  }
  // Provider 收到了 system + user 两条消息，且要求 json_object
  assert.equal(provider.lastRequest?.messages.length, 2);
  assert.equal(provider.lastRequest?.responseFormat, "json_object");
});

test("AI 路径返回部分字段：缺失字段进 warnings，status=partial", async () => {
  const provider = makeAiSuccessProvider(
    JSON.stringify({ basicInfo: { customerName: "某客户" } }),
  );
  const fns = makeFixedTimeFns(2);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_RICH, sourceRef: "test-2.xlsx" },
    { provider },
    { now: fns.now, generateId: fns.generateId },
  );

  assert.equal(result.status, "partial");
  assert.equal(result.evidences.length, 1);
  assert.equal(result.evidences[0].fieldPath, "basicInfo.customerName");
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(
    result.warnings.map((w) => w.fieldPath).sort(),
    ["basicInfo.customerIndustry", "basicInfo.location"].sort(),
  );
  assert.equal(result.fallbacks.length, 0);
});

test("AI 抛 ProviderError：整体降级到规则路径，evidences 全部 method=rule，含 fallback 记录", async () => {
  const provider = makeAiFailingProvider(
    new ProviderError("engine_overloaded", "Kimi 引擎过载", {
      providerName: "kimi",
      retryable: true,
      legacyReason: "kimi_engine_overloaded",
    }),
  );
  const fns = makeFixedTimeFns(3);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_RICH, sourceRef: "test-3.xlsx" },
    { provider },
    { now: fns.now, generateId: fns.generateId },
  );

  assert.equal(result.status, "success");
  assert.equal(result.evidences.length, 3);
  assert.equal(result.fallbacks.length, 1);
  assert.equal(result.fallbacks[0].reason, "provider_engine_overloaded");
  assert.equal(result.fallbacks[0].usedMethod, "rule");
  assert.equal(result.fallbacks[0].legacyReason, "kimi_engine_overloaded");

  for (const ev of result.evidences) {
    assert.equal(ev.method, "rule");
    assert.equal(ev.confidence, 1.0);
    assert.equal(ev.source.kind, "rule");
    if (ev.source.kind === "rule") {
      assert.equal(ev.source.ruleId, "requirement-extractor.basic-v1");
    }
    assert.ok(ev.rawText, "规则路径必须保留 rawText");
  }
  const customerName = result.evidences.find((e) => e.fieldPath === "basicInfo.customerName");
  assert.ok(customerName);
  assert.equal(customerName!.value, "金蝶软件（中国）有限公司");
});

test("AI 路径解析非 JSON 也降级：JSON.parse 失败 → 触发 ai_extraction_failed", async () => {
  const provider = makeAiSuccessProvider("这不是合法 JSON");
  const fns = makeFixedTimeFns(4);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_PARTIAL, sourceRef: "test-4.xlsx" },
    { provider },
    { now: fns.now, generateId: fns.generateId },
  );

  // 非 JSON 不抛错（容错解析返回 {}），AI 路径会产生 3 条 warning + 0 evidence
  // 这种情况是 partial AI 抽取，不属 fallback
  assert.equal(result.fallbacks.length, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.evidences.length, 0);
  assert.equal(result.warnings.length, 3);
});

test("Provider.isAvailable=false：跳过 AI 直接走规则，fallback.reason=ai_provider_not_ready", async () => {
  const provider = makeAiSuccessProvider("{}");
  provider.available = false;
  const fns = makeFixedTimeFns(5);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_RICH, sourceRef: "test-5.xlsx" },
    { provider },
    { now: fns.now, generateId: fns.generateId },
  );

  assert.equal(result.fallbacks.length, 1);
  assert.equal(result.fallbacks[0].reason, "ai_provider_not_ready");
  assert.equal(result.fallbacks[0].legacyReason, "kimi_api_key_missing");
  assert.equal(result.evidences.length, 3);
  assert.ok(result.evidences.every((e) => e.method === "rule"));
});

test("disableAi=true：强制走规则，fallback.reason=ai_disabled_by_option", async () => {
  const provider = makeAiSuccessProvider("{}");
  const fns = makeFixedTimeFns(6);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_RICH, sourceRef: "test-6.xlsx" },
    { provider },
    { now: fns.now, generateId: fns.generateId, disableAi: true },
  );

  assert.equal(result.fallbacks[0].reason, "ai_disabled_by_option");
  assert.equal(provider.lastRequest, undefined, "禁用 AI 时不应调用 provider");
});

test("无 Provider 注入：跳 AI 直接走规则，fallback.reason=ai_provider_unavailable", async () => {
  const fns = makeFixedTimeFns(7);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_RICH, sourceRef: "test-7.xlsx" },
    {},
    { now: fns.now, generateId: fns.generateId },
  );

  assert.equal(result.fallbacks[0].reason, "ai_provider_unavailable");
  assert.equal(result.evidences.length, 3);
});

test("规则路径文本缺字段：进 warnings，status=partial 或 failed", async () => {
  const fns = makeFixedTimeFns(8);

  const result = await extractRequirement(
    { workbookText: SAMPLE_TEXT_PARTIAL, sourceRef: "test-8.xlsx" },
    {},
    { now: fns.now, generateId: fns.generateId },
  );

  assert.equal(result.status, "partial");
  assert.equal(result.evidences.length, 1);
  assert.equal(result.evidences[0].fieldPath, "basicInfo.customerName");
  assert.equal(result.warnings.length, 2);
  assert.ok(
    result.warnings.every((w) => w.reason === "rule_field_missing"),
    "规则路径缺字段应统一打 rule_field_missing",
  );
});
