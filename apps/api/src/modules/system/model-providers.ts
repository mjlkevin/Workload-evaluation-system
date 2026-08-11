// ============================================================
// RP-055：多供应商模型配置（Provider × 模型目录 × 场景绑定）
// 纯函数层：归一化、旧配置迁移、场景统一解析、凭据 scope 映射。
// 铁律：
//   - 内置 moonshot 供应商的凭据 scope 恒为 "kimi"（凭据域零迁移）；
//     自定义供应商为 "provider:{id}"（credentials 表 scope 自由字符串，零表结构变更）
//   - 解析链：场景绑定（供应商存在且启用且 modelId 非空）→ legacy kimi* 字段 → env
//   - 归一化不臆造：旧 generation 模型为空则绑定 modelId 为空
// ============================================================

import type {
  ModelProvider,
  ModelProviderModel,
  RequirementSystemConfig,
  ScenarioModelBindings,
} from "../../types";
import type { ModelScenarioKey } from "./system-effective";
import { KIMI_SCOPE } from "./credentials.store";

export const BUILTIN_MOONSHOT_PROVIDER_ID = "moonshot";
const PROTOCOL = "openai-compatible";

/**
 * RP-055 批 3：内置 moonshot 模型参数矩阵（supportedParams 种子）。
 * 事实来源：K2 系列模型采样参数由平台固定（temperature 不会发送，见 effective notes）。
 * 语义：非空数组 = 白名单（仅列出的模型参数可配）；空 = 未声明约束（不限制，向后兼容）。
 * 仅约束「模型采样参数」能力面；timeoutMs / promptProfile 等 WES 侧配置不受其约束。
 */
const BUILTIN_MODEL_SUPPORTED_PARAMS: Record<string, string[]> = {
  "kimi-k3": ["maxTokens"],
  "kimi-k2.6": ["maxTokens"],
};

function builtinSupportedParams(modelId: string): string[] {
  return BUILTIN_MODEL_SUPPORTED_PARAMS[modelId] || [];
}

/** 凭据 scope 映射：内置 moonshot 沿用 kimi（历史 DB 记录/审计零迁移），其余 provider:{id} */
export function credentialScopeForProvider(providerId: string): string {
  return providerId === BUILTIN_MOONSHOT_PROVIDER_ID ? KIMI_SCOPE : `provider:${providerId}`;
}

function normalizeProviderModel(input: unknown): ModelProviderModel | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ModelProviderModel>;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const strList = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x || "").trim()).filter(Boolean))) : fallback;
  return {
    id,
    label: String(raw.label || "").trim(),
    capabilities: strList(raw.capabilities, ["chat"]),
    supportedParams: strList(raw.supportedParams, []),
  };
}

function normalizeProvider(input: unknown, now: string): ModelProvider | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ModelProvider>;
  const id = String(raw.id || "").trim().toLowerCase();
  const baseUrl = String(raw.baseUrl || "").trim().replace(/\/+$/, "");
  if (!id || !baseUrl) return null;
  if (raw.protocol !== PROTOCOL) return null;
  const rawModels = (Array.isArray(raw.models) ? raw.models : [])
    .map(normalizeProviderModel)
    .filter((m): m is ModelProviderModel => Boolean(m));
  // 内置 moonshot：存量空矩阵按内置参数矩阵回填（显式声明优先，不被覆盖）
  const models = id === BUILTIN_MOONSHOT_PROVIDER_ID
    ? rawModels.map((m) => (m.supportedParams.length ? m : { ...m, supportedParams: builtinSupportedParams(m.id) }))
    : rawModels;
  return {
    id,
    name: String(raw.name || "").trim() || id,
    protocol: PROTOCOL,
    baseUrl,
    enabled: raw.enabled !== false,
    models,
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
  };
}

/** 内置 Moonshot 供应商：baseUrl 取 env 种子，models 收集旧配置出现过的模型 ID */
export function createBuiltinMoonshotProvider(baseUrl: string, modelIds: string[]): ModelProvider {
  const now = new Date().toISOString();
  const ids = Array.from(new Set(modelIds.map((m) => String(m || "").trim()).filter(Boolean)));
  return {
    id: BUILTIN_MOONSHOT_PROVIDER_ID,
    name: "Moonshot",
    protocol: PROTOCOL,
    baseUrl: String(baseUrl || "").trim().replace(/\/+$/, ""),
    enabled: true,
    models: ids.map((id) => ({ id, label: "", capabilities: ["chat"], supportedParams: builtinSupportedParams(id) })),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 供应商目录归一化：过滤非法条目（缺 id/baseUrl、协议不符）、去重；
 * seed.modelIds 非空且目录缺内置供应商时自动补齐（旧配置迁移路径）。
 */
export function normalizeModelProviders(
  input: unknown,
  seed: { baseUrl: string; modelIds: string[] },
): ModelProvider[] {
  const now = new Date().toISOString();
  const list = Array.isArray(input) ? input : [];
  const result: ModelProvider[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const p = normalizeProvider(item, now);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    result.push(p);
  }
  if (!seen.has(BUILTIN_MOONSHOT_PROVIDER_ID) && seed.modelIds.length > 0) {
    result.unshift(createBuiltinMoonshotProvider(seed.baseUrl, seed.modelIds));
  }
  return result;
}

/** 旧 kimi* 字段 → 场景绑定（原样映射到内置供应商，空模型不臆造） */
export function deriveBindingsFromLegacy(legacy: {
  assessmentModel: string;
  fileParsingModel: string;
  generationModel: string;
}): ScenarioModelBindings {
  const bind = (modelId: string) => ({
    providerId: BUILTIN_MOONSHOT_PROVIDER_ID,
    modelId: String(modelId || "").trim(),
  });
  return {
    assessment: bind(legacy.assessmentModel),
    fileParsing: bind(legacy.fileParsingModel),
    generation: bind(legacy.generationModel),
  };
}

/**
 * 场景绑定归一化：已有绑定 providerId 在目录中则保留；
 * 缺失或指向不存在供应商时按 legacy 推导补齐。
 */
export function normalizeScenarioBindings(
  input: unknown,
  legacy: { assessmentModel: string; fileParsingModel: string; generationModel: string },
  providers: ModelProvider[],
): ScenarioModelBindings {
  const valid = new Set(providers.map((p) => p.id));
  const fallback = deriveBindingsFromLegacy(legacy);
  const src = (input || {}) as Partial<ScenarioModelBindings>;
  const pick = (scenario: ModelScenarioKey) => {
    const b = src[scenario];
    if (b && typeof b === "object") {
      const providerId = String(b.providerId || "").trim();
      if (providerId && valid.has(providerId)) {
        return { providerId, modelId: String(b.modelId || "").trim() };
      }
    }
    return fallback[scenario];
  };
  return {
    assessment: pick("assessment"),
    fileParsing: pick("fileParsing"),
    generation: pick("generation"),
  };
}

// -------------------- 场景统一解析（T7：业务链路唯一入口） --------------------

export interface ScenarioConfigResolution {
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  modelSource: "binding" | "legacy_ui" | "evaluation_fallback" | "env_fallback";
  credentialScope: string;
}

/**
 * 场景配置统一解析：绑定优先（供应商存在 + 启用 + modelId 非空），
 * 否则回退 legacy kimi* 字段（与旧 resolveScenarioModel 语义逐条一致），再否则 env。
 * legacy/env 回退时归口内置 moonshot 供应商（scope=kimi、baseUrl=env 种子）。
 */
export function resolveScenarioConfig(
  active: RequirementSystemConfig,
  scenario: ModelScenarioKey,
  env: { model: string; baseUrl: string },
): ScenarioConfigResolution {
  const providers = active.modelProviders || [];
  const binding = active.scenarioBindings?.[scenario];
  if (binding && binding.providerId) {
    const provider = providers.find((p) => p.id === binding.providerId);
    const modelId = String(binding.modelId || "").trim();
    if (provider && provider.enabled && modelId) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        model: modelId,
        modelSource: "binding",
        credentialScope: credentialScopeForProvider(provider.id),
      };
    }
  }

  const evaluationModel = active.kimiEvaluation?.model?.trim() || "";
  let model: string;
  let modelSource: ScenarioConfigResolution["modelSource"];
  switch (scenario) {
    case "assessment":
      if (evaluationModel) {
        model = evaluationModel;
        modelSource = "legacy_ui";
      } else {
        model = env.model;
        modelSource = "env_fallback";
      }
      break;
    case "fileParsing": {
      const own = active.fileParsing?.model?.trim() || "";
      if (own) {
        model = own;
        modelSource = "legacy_ui";
      } else if (evaluationModel) {
        model = evaluationModel;
        modelSource = "evaluation_fallback";
      } else {
        model = env.model;
        modelSource = "env_fallback";
      }
      break;
    }
    case "generation": {
      const own = active.kimiGeneration?.model?.trim() || "";
      if (own) {
        model = own;
        modelSource = "legacy_ui";
      } else {
        model = env.model;
        modelSource = "env_fallback";
      }
      break;
    }
  }
  return {
    providerId: BUILTIN_MOONSHOT_PROVIDER_ID,
    providerName: "Moonshot",
    baseUrl: env.baseUrl,
    model,
    modelSource,
    credentialScope: KIMI_SCOPE,
  };
}
