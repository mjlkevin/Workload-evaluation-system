// ============================================================
// DSL 规则：wbs-completeness-v1
// ============================================================
// WBS 与模块范围对齐检查。
//
// 规则逻辑：
//   - 读取 sow.moduleScope（模块范围）和 sow.wbs（WBS）
//   - 检查 WBS 中是否覆盖模块范围中的核心模块
//   - 若模块范围非空但 WBS 为空或明显不足，产出 warning
//   - 若 WBS 中包含模块范围未提及的模块，产出 info（提示可能遗漏模块范围）

import type { DslRule, RuleContext, RuleViolation } from "../types";
import type { Evidence } from "../../ai/evidence/types";

function findEvidenceValue(evidences: Evidence[], fieldPath: string, fallbacks: string[] = []): string | undefined {
  const ev = evidences.find((e) => e.fieldPath === fieldPath);
  if (ev) return ev.value;
  for (const fp of fallbacks) {
    const f = evidences.find((e) => e.fieldPath === fp);
    if (f) return f.value;
  }
  return undefined;
}

/** 简单提取模块关键词（中文分词近似） */
function extractModuleKeywords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[、,，;；|/\\\n]/g, " ")
    .replace(/[（(].*?[)）]/g, "")
    .trim();
  return cleaned.split(/\s+/).filter((w) => w.length >= 2);
}

export const wbsCompletenessV1: DslRule = {
  id: "wbs-completeness-v1",
  name: "WBS 与模块范围对齐检查",
  description:
    "检查 WBS 是否覆盖了模块范围中的核心模块。" +
    "WBS 缺失模块覆盖 → warning；WBS 包含模块范围未提及的模块 → info。",

  check(context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    const moduleScopeRaw = findEvidenceValue(context.evidences, "sow.moduleScope", [
      "requirementImportData.productModuleRows",
      "basicInfo.moduleScope",
    ]);
    const wbsRaw = findEvidenceValue(context.evidences, "sow.wbs", [
      "requirementImportData.wbs",
      "projectPlan.wbs",
    ]);

    // 若模块范围为空，不做 WBS 检查（由 sow-completeness-v1 负责）
    if (!moduleScopeRaw || moduleScopeRaw.trim() === "") {
      return violations;
    }

    // 模块范围非空但 WBS 为空 → warning
    if (!wbsRaw || wbsRaw.trim() === "") {
      violations.push({
        ruleId: this.id,
        ruleName: this.name,
        severity: "warning",
        fieldPath: "sow.wbs",
        message: "模块范围已维护，但 WBS 为空，可能导致项目计划缺失关键任务分解",
        suggestion: "请根据模块范围生成对应的 WBS，确保每个核心模块都有任务条目",
      });
      return violations;
    }

    const moduleKeywords = extractModuleKeywords(moduleScopeRaw);
    const wbsText = wbsRaw.toLowerCase();

    // 检查模块范围中的关键词是否在 WBS 中出现
    const missingInWbs = moduleKeywords.filter((kw) => !wbsText.includes(kw));
    if (missingInWbs.length > 0 && missingInWbs.length >= moduleKeywords.length * 0.5) {
      violations.push({
        ruleId: this.id,
        ruleName: this.name,
        severity: "warning",
        fieldPath: "sow.wbs",
        message: `WBS 可能未覆盖全部模块：模块范围含 "${moduleKeywords.slice(0, 3).join("、")}" 等，但 WBS 中缺少 "${missingInWbs.slice(0, 3).join("、")}" 等关键模块`,
        suggestion: "请核对 WBS 是否遗漏了模块范围中的核心模块任务分解",
      });
    }

    return violations;
  },
};
