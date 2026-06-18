// ============================================================
// 抽取器 - 规则路径（AI 不可用时的兜底）
// ============================================================
// 直接对 workbookText 做正则匹配，自包含；不引用旧 ai.service。
// P0 仅覆盖 basicInfo 三个字段，证据 confidence=1.0（规则口径明确）。
// 完整字段集与 inferIndustry4Level 等历史规则待 T4 时合并迁移。

import { randomUUID } from "node:crypto";
import type { Evidence, ExtractionWarning } from "../evidence";
import type { ExtractPathOutput, ExtractRequest, ExtractOptions } from "./types";

export const RULE_ID = "requirement-extractor.basic-v1";
export const RULE_VERSION = "1.0.0";

interface FieldRule {
  fieldPath: string;
  /** 标签关键词；正则会动态拼接 */
  labels: string[];
}

const FIELD_RULES: FieldRule[] = [
  { fieldPath: "basicInfo.customerName", labels: ["客户名称", "客户单位", "甲方名称"] },
  { fieldPath: "basicInfo.customerIndustry", labels: ["客户行业", "所属行业", "行业"] },
  { fieldPath: "basicInfo.location", labels: ["客户所在地", "实施地点", "项目所在地", "所在地区"] },
];

export interface RuleExtractorDeps {
  options?: ExtractOptions;
}

export function extractByRule(
  req: ExtractRequest,
  deps: RuleExtractorDeps = {},
): ExtractPathOutput {
  const { options = {} } = deps;
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? randomUUID;

  const text = String(req.workbookText || "");
  const evidences: Evidence[] = [];
  const warnings: ExtractionWarning[] = [];
  const extractedAt = now().toISOString();

  for (const rule of FIELD_RULES) {
    const hit = matchField(text, rule.labels);
    if (!hit) {
      warnings.push({
        fieldPath: rule.fieldPath,
        reason: "rule_field_missing",
        legacyKey: "rule_field_missing",
      });
      continue;
    }
    evidences.push({
      evidenceId: generateId(),
      fieldPath: rule.fieldPath,
      value: hit.value,
      rawText: hit.rawText,
      method: "rule",
      confidence: 1.0,
      source: {
        kind: "rule",
        ruleId: RULE_ID,
        ruleVersion: RULE_VERSION,
      },
      extractedAt,
    });
  }

  return { evidences, warnings };
}

// -------------------- 内部工具 --------------------

interface FieldHit {
  value: string;
  rawText: string;
}

/**
 * 在文本中按"标签[: 或 ：或 \t 或 空格]值"格式匹配，返回首个非空命中。
 * 支持紧贴在标签后的一行；忽略前后多余空白。
 */
function matchField(text: string, labels: string[]): FieldHit | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}[\\s]*[:：\\t]\\s*([^\\r\\n\\t|]+)`, "g");
    const match = re.exec(text);
    if (!match) continue;
    const captured = match[1]?.trim();
    if (!captured) continue;
    return { value: captured, rawText: match[0].trim() };
  }
  return null;
}
