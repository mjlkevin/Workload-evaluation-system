// ============================================================
// 抽取器 - Orchestrator
// ============================================================
// 接受 workbookText，先尝试 AI 路径；遇 ProviderError 或解析异常，
// 整体降级到规则路径（whole-result fallback，P0 简化策略）。
// P0.2/T4 再考虑字段级合并（见 TBD-P0-T3-01）。

import { randomUUID } from "node:crypto";
import type { ExtractionFallback, ExtractionResult, ExtractionStatus } from "../evidence";
import { isProviderError, ProviderError } from "../provider";
import { extractByAi } from "./ai-extractor";
import { extractByRule } from "./rule-extractor";
import type { ExtractDependencies, ExtractOptions, ExtractRequest } from "./types";

export const EXTRACTOR_VERSION = "requirement-extractor@0.1.0";

/** P0 必须出现在 evidences 里的字段集合，决定 status=success/partial */
const REQUIRED_FIELD_PATHS = [
  "basicInfo.customerName",
  "basicInfo.customerIndustry",
  "basicInfo.location",
] as const;

export async function extractRequirement(
  req: ExtractRequest,
  deps: ExtractDependencies = {},
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const startedAt = (options.now ?? (() => new Date()))();
  const generateId = options.generateId ?? randomUUID;
  const fallbacks: ExtractionFallback[] = [];

  let evidences: ExtractionResult["evidences"] = [];
  let warnings: ExtractionResult["warnings"] = [];

  const aiAvailable = !options.disableAi && deps.provider && deps.provider.isAvailable();

  if (aiAvailable && deps.provider) {
    try {
      const ai = await extractByAi(req, { provider: deps.provider, options });
      evidences = ai.evidences;
      warnings = ai.warnings;
    } catch (err) {
      const fallbackEntry: ExtractionFallback = {
        fieldPath: "*",
        reason: isProviderError(err) ? `provider_${err.code}` : "ai_extraction_failed",
        usedMethod: "rule",
        legacyReason: pickLegacyReason(err),
      };
      fallbacks.push(fallbackEntry);
      const rule = extractByRule(req, { options });
      evidences = rule.evidences;
      warnings = rule.warnings;
    }
  } else {
    if (options.disableAi) {
      fallbacks.push({
        fieldPath: "*",
        reason: "ai_disabled_by_option",
        usedMethod: "rule",
      });
    } else if (!deps.provider) {
      fallbacks.push({
        fieldPath: "*",
        reason: "ai_provider_unavailable",
        usedMethod: "rule",
        legacyReason: "kimi_provider_missing",
      });
    } else {
      fallbacks.push({
        fieldPath: "*",
        reason: "ai_provider_not_ready",
        usedMethod: "rule",
        legacyReason: "kimi_api_key_missing",
      });
    }
    const rule = extractByRule(req, { options });
    evidences = rule.evidences;
    warnings = rule.warnings;
  }

  const finishedAt = (options.now ?? (() => new Date()))();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  const status: ExtractionStatus = computeStatus(evidences);

  return {
    extractionId: generateId(),
    sourceRef: req.sourceRef,
    versionId: req.versionId,
    status,
    evidences,
    warnings,
    fallbacks,
    durationMs,
    extractedAt: startedAt.toISOString(),
    extractedByUserId: req.extractedByUserId,
    extractorVersion: options.extractorVersion ?? EXTRACTOR_VERSION,
  };
}

function computeStatus(evidences: ExtractionResult["evidences"]): ExtractionStatus {
  const present = new Set(evidences.map((e) => e.fieldPath));
  const missing = REQUIRED_FIELD_PATHS.filter((p) => !present.has(p));
  if (missing.length === 0) return "success";
  if (missing.length === REQUIRED_FIELD_PATHS.length) return "failed";
  return "partial";
}

function pickLegacyReason(err: unknown): string | undefined {
  if (isProviderError(err)) return err.legacyReason ?? `kimi_${err.code}`;
  if (err instanceof ProviderError) return err.legacyReason;
  if (err instanceof Error) return err.message || undefined;
  return undefined;
}
