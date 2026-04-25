// ============================================================
// DSL 规则：module-dependency-v1
// ============================================================
// 模块依赖检查 —— US-6 "勾了生产必须勾库存"。
//
// 规则逻辑：
//   - 读取模块范围证据（sow.moduleScope 或 fallback）
//   - 若存在模块 A，则必须同时存在模块 B（A → B 的依赖关系）
//   - 缺少被依赖模块时产出 error 级违规
//
// P0.2 最小依赖集合（后续 ADMIN 可在规则后台维护更多）：
//   生产管理 → 库存管理
//   采购管理 → 库存管理
//   销售管理 → 库存管理
//   成本管理 → 总账

import type { DslRule, RuleContext, RuleViolation } from "../types";
import type { Evidence } from "../../ai/evidence/types";

interface ModuleDependency {
  /** 触发模块的匹配关键词 */
  triggerKeywords: string[];
  /** 被依赖模块的匹配关键词 */
  requiredKeywords: string[];
  /** 人类可读描述 */
  description: string;
}

const DEPENDENCIES: ModuleDependency[] = [
  {
    triggerKeywords: ["生产", "MES", "车间", "工序"],
    requiredKeywords: ["库存", "存货", "仓储", "仓库"],
    description: "生产管理依赖库存管理",
  },
  {
    triggerKeywords: ["采购", "供应链", "供应商"],
    requiredKeywords: ["库存", "存货", "仓储", "仓库"],
    description: "采购管理依赖库存管理",
  },
  {
    triggerKeywords: ["销售", "分销", "渠道", "CRM"],
    requiredKeywords: ["库存", "存货", "仓储", "仓库"],
    description: "销售管理依赖库存管理",
  },
  {
    triggerKeywords: ["成本", "费用", "预算"],
    requiredKeywords: ["总账", "财务", "会计", "核算"],
    description: "成本管理依赖总账",
  },
];

function findModuleScopeValue(evidences: Evidence[]): string | undefined {
  const paths = ["sow.moduleScope", "requirementImportData.productModuleRows", "basicInfo.moduleScope"];
  for (const p of paths) {
    const ev = evidences.find((e) => e.fieldPath === p);
    if (ev) return ev.value;
  }
  return undefined;
}

export const moduleDependencyV1: DslRule = {
  id: "module-dependency-v1",
  name: "模块依赖检查",
  description:
    "检查模块清单中是否存在依赖关系缺失。" +
    "若勾选了触发模块但未勾选被依赖模块，则报错。",

  check(context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const scopeRaw = findModuleScopeValue(context.evidences);
    if (!scopeRaw) return violations;

    const scope = scopeRaw.toLowerCase();

    for (const dep of DEPENDENCIES) {
      const hasTrigger = dep.triggerKeywords.some((kw) => scope.includes(kw.toLowerCase()));
      if (!hasTrigger) continue;

      const hasRequired = dep.requiredKeywords.some((kw) => scope.includes(kw.toLowerCase()));
      if (!hasRequired) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: "error",
          fieldPath: "sow.moduleScope",
          message: `模块依赖缺失：${dep.description}。当前已勾选 "${dep.triggerKeywords.join(" / ")}" 相关模块，但未找到 "${dep.requiredKeywords.join(" / ")}" 相关模块。`,
          suggestion: `请在模块清单中补充 "${dep.requiredKeywords[0]}" 模块，或在假设中说明不采购该模块的理由。`,
        });
      }
    }

    return violations;
  },
};
