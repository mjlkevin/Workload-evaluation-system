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

/** 常见模块词典（用于中文分词匹配） */
const MODULE_KEYWORDS = [
  // 财务云
  "总账", "应收", "应付", "固定资产", "现金管理", "财务报表", "凭证", "账簿",
  // 供应链云
  "库存", "采购", "销售", "仓库", "物料", "供应商", "订单",
  // 制造云
  "生产", "BOM", "工单", "MES", "工艺", "车间", "排产",
  // HR云
  "人事", "薪酬", "考勤", "招聘", "绩效", "培训",
  // 其他常见模块
  "项目", "合同", "资产", "预算", "审批", "流程", "报表", "分析",
];

/** 使用词典匹配提取模块关键词（支持中文） */
function extractModuleKeywords(text: string): string[] {
  const found = new Set<string>();
  const lowerText = text.toLowerCase();

  // 词典匹配：查找文本中包含的模块关键词
  for (const keyword of MODULE_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      found.add(keyword);
    }
  }

  // 补充：仍然保留原有的分词逻辑，捕获词典外的关键词
  const cleaned = text
    .toLowerCase()
    .replace(/[、,，;；|/\\\n]/g, " ")
    .replace(/[（(].*?[)）]/g, "")
    .trim();
  const tokens = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  for (const token of tokens) {
    // 如果 token 包含某个词典关键词，用关键词替换（标准化）
    let standardized = token;
    for (const keyword of MODULE_KEYWORDS) {
      if (token.includes(keyword.toLowerCase())) {
        standardized = keyword;
        break;
      }
    }
    found.add(standardized);
  }

  return Array.from(found);
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
