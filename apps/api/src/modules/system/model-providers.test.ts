// ============================================================
// RP-055 批 1 RED：多供应商模型配置（Provider × 模型目录 × 场景绑定）
// 覆盖：归一化与旧配置迁移、场景统一解析（binding → legacy → env）、
//       凭据 scope 映射、启动 warm（ISS-2026-08-10-008）。
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import type { ModelProvider, RequirementSystemConfig } from "../../types";
import {
  BUILTIN_MOONSHOT_PROVIDER_ID,
  credentialScopeForProvider,
  createBuiltinMoonshotProvider,
  deriveBindingsFromLegacy,
  normalizeModelProviders,
  normalizeScenarioBindings,
  resolveScenarioConfig,
} from "./model-providers";
import { normalizeRequirementSystemConfig } from "./system.repository";
import {
  getCachedApiKey,
  resetCredentialCache,
  warmCredentialScopes,
  encryptCredential,
} from "./credentials.store";

const ENV = { model: "kimi-k2.5-env", baseUrl: "https://api.moonshot.cn/v1" };

function makeLegacyConfig(overrides: Partial<RequirementSystemConfig> = {}): RequirementSystemConfig {
  return {
    kimiEvaluation: {
      enabled: true,
      model: "kimi-k3",
      temperature: 0.3,
      maxTokens: 4000,
      timeoutMs: 120000,
      fallbackToRule: true,
      promptProfile: "default",
      promptTemplate: "tpl",
    },
    fileParsing: {
      enabled: true,
      model: "kimi-k2.6",
      allowedExtensions: [".xlsx"],
      maxFileSizeMb: 20,
      maxSheetCount: 20,
      strictMode: false,
      ocrEnabled: false,
    },
    kimiGeneration: {
      enabled: true,
      model: "",
      temperature: 0.5,
      maxTokens: 6000,
      outputStyle: "balanced",
      includeRiskHints: true,
      includeAssumptions: true,
    },
    kimiCredentials: { apiKey: "" },
    ...overrides,
  };
}

function makeDeepseekProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    enabled: true,
    models: [{ id: "deepseek-chat", label: "", capabilities: ["chat"], supportedParams: [] }],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

// -------------------- 1. 归一化与旧配置迁移 --------------------

test("RP-055 迁移：旧配置（无 providers/bindings）归一化后自动合成内置 moonshot 供应商", () => {
  const normalized = normalizeRequirementSystemConfig(makeLegacyConfig());
  const providers = normalized.modelProviders || [];
  const moonshot = providers.find((p) => p.id === BUILTIN_MOONSHOT_PROVIDER_ID);
  assert.ok(moonshot, "应合成内置 moonshot 供应商");
  assert.equal(moonshot.protocol, "openai-compatible");
  assert.equal(moonshot.baseUrl, ENV.baseUrl);
  assert.equal(moonshot.enabled, true);
  const modelIds = moonshot.models.map((m) => m.id);
  assert.ok(modelIds.includes("kimi-k3"), "应收集评估场景模型 ID");
  assert.ok(modelIds.includes("kimi-k2.6"), "应收集文件解析场景模型 ID");
});

test("RP-055 迁移：旧配置场景绑定自动从 kimi* 字段推导", () => {
  const normalized = normalizeRequirementSystemConfig(makeLegacyConfig());
  const bindings = normalized.scenarioBindings;
  assert.ok(bindings, "应合成场景绑定");
  assert.deepEqual(bindings.assessment, { providerId: "moonshot", modelId: "kimi-k3" });
  assert.deepEqual(bindings.fileParsing, { providerId: "moonshot", modelId: "kimi-k2.6" });
  // generation 旧字段为空 → 按既有归一化语义回填默认模型（kimi-k2.5），绑定与归一化后字段保持一致
  assert.deepEqual(bindings.generation, { providerId: "moonshot", modelId: "kimi-k2.5" });
});

test("RP-055 归一化：已有自定义供应商原样保留，不被内置供应商覆盖", () => {
  const existing = makeDeepseekProvider();
  const normalized = normalizeRequirementSystemConfig(
    makeLegacyConfig({ modelProviders: [existing] }),
  );
  const providers = normalized.modelProviders || [];
  const deepseek = providers.find((p) => p.id === "deepseek");
  assert.ok(deepseek, "自定义供应商应保留");
  assert.equal(deepseek.baseUrl, "https://api.deepseek.com/v1");
  assert.deepEqual(deepseek.models.map((m) => m.id), ["deepseek-chat"]);
  // 内置 moonshot 仍应补齐（旧场景绑定指向它）
  assert.ok(providers.find((p) => p.id === BUILTIN_MOONSHOT_PROVIDER_ID));
});

test("RP-055 归一化：非法供应商条目被过滤（缺 id/baseUrl/协议不符）", () => {
  const providers = normalizeModelProviders(
    [
      { id: "", name: "x", protocol: "openai-compatible", baseUrl: "https://a.com/v1", enabled: true, models: [] },
      { id: "bad-proto", name: "x", protocol: "anthropic", baseUrl: "https://a.com/v1", enabled: true, models: [] },
      { id: "no-url", name: "x", protocol: "openai-compatible", baseUrl: "", enabled: true, models: [] },
      makeDeepseekProvider(),
    ],
    { baseUrl: ENV.baseUrl, modelIds: [] },
  );
  assert.deepEqual(providers.map((p) => p.id), ["deepseek"]);
});

// -------------------- 2. 场景统一解析（binding → legacy → env） --------------------

test("RP-055 resolve：绑定命中自定义供应商 → 返回该供应商模型/baseUrl/独立 scope", () => {
  const active = makeLegacyConfig({
    modelProviders: [createBuiltinMoonshotProvider(ENV.baseUrl, ["kimi-k3", "kimi-k2.6"]), makeDeepseekProvider()],
    scenarioBindings: {
      assessment: { providerId: "deepseek", modelId: "deepseek-chat" },
      fileParsing: { providerId: "moonshot", modelId: "kimi-k2.6" },
      generation: { providerId: "moonshot", modelId: "" },
    },
  });
  const r = resolveScenarioConfig(active, "assessment", ENV);
  assert.equal(r.model, "deepseek-chat");
  assert.equal(r.modelSource, "binding");
  assert.equal(r.providerId, "deepseek");
  assert.equal(r.providerName, "DeepSeek");
  assert.equal(r.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(r.credentialScope, "provider:deepseek");
});

test("RP-055 resolve：绑定命中内置 moonshot → scope 沿用 kimi（凭据零迁移）", () => {
  const active = makeLegacyConfig({
    modelProviders: [createBuiltinMoonshotProvider(ENV.baseUrl, ["kimi-k3"])],
    scenarioBindings: {
      assessment: { providerId: "moonshot", modelId: "kimi-k3" },
      fileParsing: { providerId: "moonshot", modelId: "kimi-k2.6" },
      generation: { providerId: "moonshot", modelId: "" },
    },
  });
  const r = resolveScenarioConfig(active, "assessment", ENV);
  assert.equal(r.modelSource, "binding");
  assert.equal(r.credentialScope, "kimi");
  assert.equal(r.baseUrl, ENV.baseUrl);
});

test("RP-055 resolve：绑定指向不存在供应商 → 回退 legacy 字段", () => {
  const active = makeLegacyConfig({
    modelProviders: [createBuiltinMoonshotProvider(ENV.baseUrl, ["kimi-k3"])],
    scenarioBindings: {
      assessment: { providerId: "ghost", modelId: "ghost-model" },
      fileParsing: { providerId: "moonshot", modelId: "kimi-k2.6" },
      generation: { providerId: "moonshot", modelId: "" },
    },
  });
  const r = resolveScenarioConfig(active, "assessment", ENV);
  assert.equal(r.model, "kimi-k3");
  assert.equal(r.modelSource, "legacy_ui");
  assert.equal(r.credentialScope, "kimi");
});

test("RP-055 resolve：绑定供应商被禁用 → 回退 legacy 字段", () => {
  const active = makeLegacyConfig({
    modelProviders: [makeDeepseekProvider({ enabled: false })],
    scenarioBindings: {
      assessment: { providerId: "deepseek", modelId: "deepseek-chat" },
      fileParsing: { providerId: "moonshot", modelId: "kimi-k2.6" },
      generation: { providerId: "moonshot", modelId: "" },
    },
  });
  const r = resolveScenarioConfig(active, "assessment", ENV);
  assert.equal(r.model, "kimi-k3");
  assert.equal(r.modelSource, "legacy_ui");
});

test("RP-055 resolve：无绑定的旧配置回退链与旧语义一致（evaluation_fallback / env_fallback）", () => {
  const active = makeLegacyConfig({
    fileParsing: { ...makeLegacyConfig().fileParsing, model: "" },
  });
  const fp = resolveScenarioConfig(active, "fileParsing", ENV);
  assert.equal(fp.model, "kimi-k3");
  assert.equal(fp.modelSource, "evaluation_fallback");
  assert.equal(fp.baseUrl, ENV.baseUrl);
  assert.equal(fp.credentialScope, "kimi");

  const emptyAll = makeLegacyConfig({
    kimiEvaluation: { ...makeLegacyConfig().kimiEvaluation, model: "" },
    fileParsing: { ...makeLegacyConfig().fileParsing, model: "" },
  });
  const envR = resolveScenarioConfig(emptyAll, "assessment", ENV);
  assert.equal(envR.model, ENV.model);
  assert.equal(envR.modelSource, "env_fallback");
});

// -------------------- 3. 凭据 scope 映射与启动 warm（ISS-2026-08-10-008） --------------------

test("RP-055 scope：内置 moonshot → kimi；自定义供应商 → provider:{id}", () => {
  assert.equal(credentialScopeForProvider("moonshot"), "kimi");
  assert.equal(credentialScopeForProvider("deepseek"), "provider:deepseek");
});

test("RP-055 warm（ISS-2026-08-10-008）：启动预热后同步缓存命中 DB 密钥，不再回落 env", async () => {
  resetCredentialCache();
  const prevKek = process.env.CREDENTIAL_KEK;
  process.env.CREDENTIAL_KEK = Buffer.alloc(32, 7).toString("base64");
  try {
    const kek = Buffer.from(process.env.CREDENTIAL_KEK, "base64");
    const encrypted = encryptCredential("sk-warm-test-secret", kek);
    const fakePool = {
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes("FROM credentials") && params[0] === "kimi") {
          return { rows: [{ api_key_encrypted: encrypted, key_version: 3 }] };
        }
        return { rows: [] };
      },
    };
    const warmed = await warmCredentialScopes(["kimi", "provider:deepseek"], fakePool as never);
    assert.deepEqual(warmed, ["kimi"], "只有 DB 有记录的 scope 被预热");
    assert.equal(getCachedApiKey("kimi"), "sk-warm-test-secret");
    assert.equal(getCachedApiKey("provider:deepseek"), null);
  } finally {
    if (prevKek === undefined) delete process.env.CREDENTIAL_KEK;
    else process.env.CREDENTIAL_KEK = prevKek;
    resetCredentialCache();
  }
});

test("RP-055 warm：DB 查询失败时降级不抛错（不阻断启动）", async () => {
  resetCredentialCache();
  const brokenPool = {
    query: async () => {
      throw new Error("connection refused");
    },
  };
  const warmed = await warmCredentialScopes(["kimi"], brokenPool as never);
  assert.deepEqual(warmed, []);
});

// -------------------- 4. 绑定归一化辅助 --------------------

test("RP-055 bindings 归一化：缺场景键时按 legacy 推导补齐，非法 providerId 清空", () => {
  const bindings = normalizeScenarioBindings(
    { assessment: { providerId: "deepseek", modelId: "deepseek-chat" } },
    { assessmentModel: "kimi-k3", fileParsingModel: "kimi-k2.6", generationModel: "" },
    [makeDeepseekProvider(), createBuiltinMoonshotProvider(ENV.baseUrl, ["kimi-k3", "kimi-k2.6"])],
  );
  assert.deepEqual(bindings.assessment, { providerId: "deepseek", modelId: "deepseek-chat" });
  assert.deepEqual(bindings.fileParsing, { providerId: "moonshot", modelId: "kimi-k2.6" });
  assert.deepEqual(bindings.generation, { providerId: "moonshot", modelId: "" });
});

test("RP-055 deriveBindingsFromLegacy：三场景从旧字段原样映射到内置供应商", () => {
  const bindings = deriveBindingsFromLegacy({
    assessmentModel: "kimi-k3",
    fileParsingModel: "kimi-k2.6",
    generationModel: "kimi-k2.5",
  });
  assert.deepEqual(bindings, {
    assessment: { providerId: "moonshot", modelId: "kimi-k3" },
    fileParsing: { providerId: "moonshot", modelId: "kimi-k2.6" },
    generation: { providerId: "moonshot", modelId: "kimi-k2.5" },
  });
});

// -------------------- 5. RP-055 批 3：内置模型参数矩阵（supportedParams 种子与回填） --------------------

test("RP-055 批 3：迁移合成内置 moonshot 时 kimi-k3/kimi-k2.6 种子 supportedParams=['maxTokens']（K2 采样平台固定）", () => {
  const provider = createBuiltinMoonshotProvider(ENV.baseUrl, ["kimi-k3", "kimi-k2.6", "moonshot-v1-128k"]);
  const byId = Object.fromEntries(provider.models.map((m) => [m.id, m.supportedParams]));
  assert.deepEqual(byId["kimi-k3"], ["maxTokens"]);
  assert.deepEqual(byId["kimi-k2.6"], ["maxTokens"]);
  // 未声明约束的旧模型保持空（空 = 不约束，向后兼容）
  assert.deepEqual(byId["moonshot-v1-128k"], []);
});

test("RP-055 批 3：存量内置供应商（supportedParams 为空）读取归一化时按内置矩阵回填", () => {
  const existingMoonshot: ModelProvider = {
    id: "moonshot",
    name: "Moonshot",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    enabled: true,
    models: [
      { id: "kimi-k3", label: "", capabilities: ["chat"], supportedParams: [] },
      { id: "kimi-k2.6", label: "", capabilities: ["chat"], supportedParams: [] },
    ],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
  const normalized = normalizeRequirementSystemConfig(makeLegacyConfig({ modelProviders: [existingMoonshot] }));
  const moonshot = (normalized.modelProviders || []).find((p) => p.id === "moonshot");
  const byId = Object.fromEntries((moonshot?.models || []).map((m) => [m.id, m.supportedParams]));
  assert.deepEqual(byId["kimi-k3"], ["maxTokens"], "存量空矩阵应按内置矩阵回填");
  assert.deepEqual(byId["kimi-k2.6"], ["maxTokens"]);
});

test("RP-055 批 3：显式声明的 supportedParams 不被内置矩阵覆盖；自定义供应商空矩阵不回填", () => {
  const customMoonshot: ModelProvider = {
    id: "moonshot",
    name: "Moonshot",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    enabled: true,
    models: [{ id: "kimi-k3", label: "", capabilities: ["chat"], supportedParams: ["temperature", "maxTokens"] }],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
  const normalized = normalizeRequirementSystemConfig(
    makeLegacyConfig({ modelProviders: [customMoonshot, makeDeepseekProvider()] }),
  );
  const providers = normalized.modelProviders || [];
  const moonshot = providers.find((p) => p.id === "moonshot");
  assert.deepEqual(moonshot?.models[0]?.supportedParams, ["temperature", "maxTokens"], "显式声明优先");
  const deepseek = providers.find((p) => p.id === "deepseek");
  assert.deepEqual(deepseek?.models[0]?.supportedParams, [], "自定义供应商空矩阵保持未声明（不约束）");
});
