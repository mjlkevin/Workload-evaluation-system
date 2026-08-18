// ============================================================
// T2：模型配置"生效状态"装配（三层契约之 Effective State 层）
// 纯函数 + 小 JSON 存储，供 system.usecase 的 /effective 与场景验证端点复用。
// 铁律：wiredParams 只列真实接线的配置项，不接线的一律进 notes 如实说明。
// ============================================================

import fs from "node:fs";
import path from "node:path";

import type { RequirementSystemConfig } from "../../types";
import { modelVerifyStatusPath } from "../../utils";
import { isKimiK2Model } from "../../utils/kimi-completion-params";
import { resolveScenarioConfig, type ScenarioConfigResolution } from "./model-providers";

export type ModelScenarioKey = "assessment" | "fileParsing" | "generation";

export interface ScenarioModelResolution {
  model: string;
  source: "ui" | "evaluation_fallback" | "env_fallback";
}

export interface ScenarioVerifyRecord {
  at: string;
  ok: boolean;
  model: string;
  elapsedMs: number;
  reason?: string;
}

export interface CredentialsHealth {
  configured: boolean;
  source: "store" | "env" | "none";
  kekReady: boolean;
  lastAudit: { action: string; actor: string; at: string } | null;
}

export interface EffectiveScenario {
  key: ModelScenarioKey;
  label: string;
  purpose: string;
  resolvedModel: string;
  /** RP-055：binding=场景绑定 / legacy_ui=旧场景字段 / evaluation_fallback / env_fallback */
  source: ScenarioConfigResolution["modelSource"];
  /** RP-055：生效供应商信息（绑定或归口内置供应商） */
  providerId: string;
  providerName: string;
  baseUrl: string;
  credentialScope: string;
  /** 该场景是否已接入业务链路（false = 规划中，配置暂不生效） */
  wired: boolean;
  /** 真实接线的配置项（前端只渲染这些） */
  wiredParams: string[];
  /** 不接线项与能力说明（如实告知） */
  notes: string[];
  lastVerified: ScenarioVerifyRecord | null;
}

export interface EffectiveModelConfig {
  scenarios: EffectiveScenario[];
  credentials: CredentialsHealth;
  generatedAt: string;
}

const SCENARIO_META: Record<ModelScenarioKey, { label: string; purpose: string }> = {
  assessment: {
    label: "实施评估",
    purpose: "用于实施评估与开发评估的自动打标与摘要生成。",
  },
  fileParsing: {
    label: "文件解析",
    purpose: "用于 Excel/Word/PDF 的结构化提取与内容解析。",
  },
  generation: {
    label: "内容生成",
    purpose: "用于方案生成、五段叙事与 SOW 草稿自动撰写。",
  },
};

/** 场景模型解析链：与各业务消费方实际取模逻辑保持一致 */
export function resolveScenarioModel(
  active: RequirementSystemConfig,
  scenario: ModelScenarioKey,
  envModel: string,
): ScenarioModelResolution {
  const evaluationModel = active.kimiEvaluation?.model?.trim() || "";
  switch (scenario) {
    case "assessment":
      // 与 services/ai/assessment.service.ts（T1 后）一致：配置优先，env 兜底
      if (evaluationModel) return { model: evaluationModel, source: "ui" };
      return { model: envModel, source: "env_fallback" };
    case "fileParsing": {
      // 与 services/ai/extractor.service.ts 三级回退一致
      const own = active.fileParsing?.model?.trim() || "";
      if (own) return { model: own, source: "ui" };
      if (evaluationModel) return { model: evaluationModel, source: "evaluation_fallback" };
      return { model: envModel, source: "env_fallback" };
    }
    case "generation": {
      const own = active.kimiGeneration?.model?.trim() || "";
      if (own) return { model: own, source: "ui" };
      return { model: envModel, source: "env_fallback" };
    }
  }
}

function buildScenarioNotes(scenario: ModelScenarioKey, resolvedModel: string): string[] {
  const notes: string[] = [];
  if (scenario === "assessment") {
    notes.push("temperature 配置暂不生效（评估链路当前硬编码 0.1，P2 接通）");
  }
  if (scenario === "fileParsing") {
    notes.push("allowedExtensions / maxFileSizeMb / maxSheetCount / strictMode / ocrEnabled 配置暂不生效（P2 接通上传链路）");
    notes.push("超时与评估场景共用（kimiEvaluation.timeoutMs）");
  }
  if (scenario === "generation") {
    notes.push("该场景尚未接入业务链路，配置暂不生效（规划中）");
  }
  if (scenario !== "generation" && isKimiK2Model(resolvedModel)) {
    notes.push("K2 系列模型采样参数由平台固定，temperature 不会发送");
  }
  return notes;
}

const SCENARIO_WIRED_PARAMS: Record<ModelScenarioKey, string[]> = {
  assessment: ["model", "maxTokens", "timeoutMs", "promptProfile", "promptTemplate"],
  fileParsing: ["model"],
  generation: [],
};

export function buildEffectiveModelConfig(
  active: RequirementSystemConfig,
  envModel: string,
  credentials: CredentialsHealth,
  lastVerified: Partial<Record<ModelScenarioKey, ScenarioVerifyRecord>>,
  envBaseUrl: string = "",
): EffectiveModelConfig {
  const keys: ModelScenarioKey[] = ["assessment", "fileParsing", "generation"];
  const env = { model: envModel, baseUrl: envBaseUrl };
  const scenarios: EffectiveScenario[] = keys.map((key) => {
    const resolution = resolveScenarioConfig(active, key, env);
    const wired = key !== "generation";
    return {
      key,
      label: SCENARIO_META[key].label,
      purpose: SCENARIO_META[key].purpose,
      resolvedModel: resolution.model,
      source: resolution.modelSource,
      providerId: resolution.providerId,
      providerName: resolution.providerName,
      baseUrl: resolution.baseUrl,
      credentialScope: resolution.credentialScope,
      wired,
      wiredParams: SCENARIO_WIRED_PARAMS[key],
      notes: buildScenarioNotes(key, resolution.model),
      lastVerified: lastVerified[key] ?? null,
    };
  });
  return {
    scenarios,
    credentials,
    generatedAt: new Date().toISOString(),
  };
}

// -------------------- 最近验证状态（小 JSON 存储） --------------------

type VerifyStatusStore = Partial<Record<ModelScenarioKey, ScenarioVerifyRecord>>;

function isScenarioKey(key: string): key is ModelScenarioKey {
  return key === "assessment" || key === "fileParsing" || key === "generation";
}

function normalizeVerifyRecord(input: unknown): ScenarioVerifyRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ScenarioVerifyRecord>;
  const at = String(raw.at || "").trim();
  const model = String(raw.model || "").trim();
  const elapsedMs = Number(raw.elapsedMs);
  if (!at || !model || !Number.isFinite(elapsedMs)) return null;
  return {
    at,
    ok: Boolean(raw.ok),
    model,
    elapsedMs: Math.max(0, elapsedMs),
    ...(raw.reason ? { reason: String(raw.reason) } : {}),
  };
}

/** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync），阶段 2 替换实现。 */
export async function loadModelVerifyStatus(): Promise<VerifyStatusStore> {
  const filePath = modelVerifyStatusPath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: VerifyStatusStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isScenarioKey(key)) continue;
      const rec = normalizeVerifyRecord(value);
      if (rec) result[key] = rec;
    }
    return result;
  } catch {
    return {};
  }
}

/** 阶段 1 批 7：签名改 async（含内部 loadModelVerifyStatus 级联），实现不动（仍为 writeFileSync），阶段 2 替换实现。 */
export async function saveScenarioVerifyRecord(scenario: ModelScenarioKey, record: ScenarioVerifyRecord): Promise<void> {
  const filePath = modelVerifyStatusPath();
  const current = await loadModelVerifyStatus();
  const next: VerifyStatusStore = { ...current, [scenario]: record };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
}
