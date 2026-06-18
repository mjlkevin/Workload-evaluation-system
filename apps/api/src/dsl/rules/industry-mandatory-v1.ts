// ============================================================
// DSL 规则：industry-mandatory-v1
// ============================================================
// 行业必选项检查 —— US-6 "漏了行业必问项时 AI 主动提醒"。
//
// 规则逻辑：
//   - 读取证据中的 industry 字段（或 fallback 路径）
//   - 根据行业关键词匹配必选项清单
//   - 若缺少必选项对应的证据，产出 warning 级违规
//
// 当前覆盖（P0.2 最小集合，ADMIN 后续可通过 DSL 管理后台扩展）：
//   制造业 → 必须有 MES / 生产管理 / 车间管理 相关模块
//   零售业 → 必须有 POS / 门店管理 / 会员管理 相关模块
//   建筑工程 → 必须有 项目管理 / 合同管理 / 成本管理 相关模块

import type { DslRule, RuleContext, RuleViolation } from "../types";
import type { Evidence } from "../../ai/evidence/types";

interface MandatoryItem {
  industryPattern: RegExp;
  industryName: string;
  requiredKeywords: string[];
  fieldPathHint: string;
  message: string;
  suggestion: string;
}

const MANDATORY_ITEMS: MandatoryItem[] = [
  {
    industryPattern: /制造|mes|生产|车间|工贸/,
    industryName: "制造业",
    requiredKeywords: ["生产", "MES", "车间", "工序"],
    fieldPathHint: "sow.moduleScope",
    message: "制造业项目通常需要生产管理（MES）模块，当前模块清单中未识别到相关条目",
    suggestion: "请确认是否遗漏生产管理、MES 或车间管理模块；如确实不需要，请在假设中说明理由",
  },
  {
    industryPattern: /零售|连锁|门店|pos|商超/,
    industryName: "零售业",
    requiredKeywords: ["POS", "门店", "零售", "会员", "收银"],
    fieldPathHint: "sow.moduleScope",
    message: "零售业项目通常需要 POS / 门店管理 / 会员管理模块，当前模块清单中未识别到相关条目",
    suggestion: "请确认是否遗漏 POS、门店管理或会员管理模块；如确实不需要，请在假设中说明理由",
  },
  {
    industryPattern: /建筑|工程|施工|项目/,
    industryName: "建筑工程",
    requiredKeywords: ["项目", "合同", "成本", "施工"],
    fieldPathHint: "sow.moduleScope",
    message: "建筑工程项目通常需要项目管理 / 合同管理 / 成本管理模块，当前模块清单中未识别到相关条目",
    suggestion: "请确认是否遗漏项目管理、合同管理或成本管理模块；如确实不需要，请在假设中说明理由",
  },
];

function findEvidenceValue(evidences: Evidence[], fieldPath: string): string | undefined {
  const ev = evidences.find((e) => e.fieldPath === fieldPath);
  if (ev) return ev.value;
  // fallback：尝试已知路径
  const fallbacks = [
    "requirementImportData.industry",
    "basicInfo.industry",
    "project.industry",
  ];
  for (const fp of fallbacks) {
    const f = evidences.find((e) => e.fieldPath === fp);
    if (f) return f.value;
  }
  return undefined;
}

function findModuleScopeValue(evidences: Evidence[]): string | undefined {
  const paths = ["sow.moduleScope", "requirementImportData.productModuleRows", "basicInfo.moduleScope"];
  for (const p of paths) {
    const ev = evidences.find((e) => e.fieldPath === p);
    if (ev) return ev.value;
  }
  return undefined;
}

export const industryMandatoryV1: DslRule = {
  id: "industry-mandatory-v1",
  name: "行业必选项检查",
  description:
    "根据项目所属行业，检查模块清单是否包含该行业通常必需的模块。" +
    "仅做提示（warning），不强制阻塞，因为客户可能真有特殊场景不需要。",

  check(context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const industryRaw = findEvidenceValue(context.evidences, "industry");
    if (!industryRaw) {
      // 不知道行业，无法检查；但这不是本规则的职责（应由 sow-completeness 检查行业字段）
      return violations;
    }
    const industry = industryRaw.toLowerCase();
    const moduleScopeRaw = findModuleScopeValue(context.evidences) || "";
    const moduleScope = moduleScopeRaw.toLowerCase();

    for (const item of MANDATORY_ITEMS) {
      if (!item.industryPattern.test(industry)) continue;

      const hasRequired = item.requiredKeywords.some((kw) => moduleScope.includes(kw.toLowerCase()));
      if (!hasRequired) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: "warning",
          fieldPath: item.fieldPathHint,
          message: item.message,
          suggestion: item.suggestion,
        });
      }
    }

    return violations;
  },
};
