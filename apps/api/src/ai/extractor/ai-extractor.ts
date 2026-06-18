// ============================================================
// 抽取器 - AI 路径
// ============================================================
// 走 ModelProvider.chatCompletion；解析返回 JSON，逐字段产出 Evidence。
// 当前 prompt 仅覆盖 basicInfo 三个字段，T4 迁移时再扩展。

import { randomUUID } from "node:crypto";
import type { Evidence, ExtractionWarning } from "../evidence";
import type { ModelProvider } from "../provider";
import type { ExtractPathOutput, ExtractRequest, ExtractOptions } from "./types";

const SYSTEM_PROMPT =
  "你是企业项目评估信息抽取助手。请只输出 JSON 对象，不要输出额外解释。" +
  "若字段缺失，字符串填空字符串。";

const USER_PROMPT_HEAD =
  "请从以下 Excel 文本中提取需求基础信息，并输出 JSON：\n" +
  "- basicInfo.customerName：客户名称\n" +
  '- basicInfo.customerIndustry：按 GB/T 4754 四级"编码+名称"格式\n' +
  "- basicInfo.location：客户实施地点 / 所在地区\n" +
  "顶层 JSON 须包含 basicInfo 对象。\n\n";

const TARGET_FIELDS = [
  { path: "basicInfo.customerName", aliases: ["customerName", "客户名称", "客户"] },
  { path: "basicInfo.customerIndustry", aliases: ["customerIndustry", "客户行业", "行业"] },
  { path: "basicInfo.location", aliases: ["location", "客户所在地", "实施地点"] },
] as const;

export interface AiExtractorDeps {
  provider: ModelProvider;
  options?: ExtractOptions;
}

/**
 * AI 路径抽取。
 * 失败抛出原始 ProviderError 或 JSON 解析异常，由 orchestrator 决定降级。
 */
export async function extractByAi(
  req: ExtractRequest,
  deps: AiExtractorDeps,
): Promise<ExtractPathOutput> {
  const { provider, options = {} } = deps;
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? randomUUID;

  const response = await provider.chatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT_HEAD + req.workbookText },
    ],
    responseFormat: "json_object",
    temperature: 0.1,
    timeoutMs: options.aiTimeoutMs,
    maxAttempts: options.aiMaxAttempts,
  });

  const parsed = parseJsonObject(response.content);
  const basicInfo = pickObject(parsed, "basicInfo");

  const evidences: Evidence[] = [];
  const warnings: ExtractionWarning[] = [];
  const extractedAt = now().toISOString();

  for (const field of TARGET_FIELDS) {
    const value = pickField(basicInfo, field.aliases) || pickField(parsed, field.aliases);
    if (!value) {
      warnings.push({
        fieldPath: field.path,
        reason: "ai_field_missing",
        legacyKey: "ai_field_missing",
      });
      continue;
    }
    evidences.push({
      evidenceId: generateId(),
      fieldPath: field.path,
      value,
      method: "ai",
      confidence: 0.8,
      source: { kind: "ai_inference" },
      extractedAt,
      aiMeta: {
        provider: response.provider,
        model: response.model,
        attempts: response.attempts,
        finishReason: response.finishReason,
      },
    });
  }

  return { evidences, warnings };
}

// -------------------- 内部工具 --------------------

function parseJsonObject(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return isPlainObject(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickObject(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = input[key];
  return isPlainObject(v) ? v : {};
}

function pickField(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    if (!(key in input)) continue;
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      const s = value.trim();
      if (s) return s;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}
