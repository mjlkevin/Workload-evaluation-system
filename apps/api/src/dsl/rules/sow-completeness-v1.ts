// ============================================================
// DSL 规则：sow-completeness-v1
// ============================================================
// 基于 SOW 深度分析总结（docs/SOW深度分析总结-2026-04-25.md）设计。
//
// 检查边界（4 项核心）：
//   1. 组织范围（sow.organizationScope）—— error，必须有至少一家组织
//   2. 模块范围（sow.moduleScope）—— error，必须有至少一个模块
//   3. 开发范围（sow.developmentScope）—— info，允许值为"无"
//   4. WBS（sow.wbs）—— error，必须有工作分解结构
//
// 匹配策略：
//   - 精确匹配 fieldPath（未来抽取器扩展后自动生效）
//   - 同时兼容旧路径（requirementImportData.xxx）作为 fallback

import type { DslRule, RuleContext, RuleViolation } from "../types";
import type { Evidence } from "../../ai/evidence/types";

// ------------------------------------------------------------------
// 规则配置
// ------------------------------------------------------------------

interface RequiredField {
  fieldPath: string;
  /** 兼容的旧路径（fallback 匹配） */
  fallbackPaths?: string[];
  severity: "error" | "warning" | "info";
  message: string;
  suggestion: string;
  /** 是否允许值为空字符串（如 "无"） */
  allowEmptyValue?: boolean;
}

const REQUIRED_FIELDS: RequiredField[] = [
  {
    fieldPath: "sow.organizationScope",
    fallbackPaths: ["requirementImportData.implementationScopeRows", "basicInfo.organizationScope"],
    severity: "error",
    message: "SOW 缺少项目组织范围：未找到实施主体组织清单",
    suggestion: "请在需求导入时提供 implementationScopeRows，或在评估包中手动维护组织范围",
  },
  {
    fieldPath: "sow.moduleScope",
    fallbackPaths: ["requirementImportData.productModuleRows", "basicInfo.moduleScope"],
    severity: "error",
    message: "SOW 缺少模块范围：未找到实施业务模块清单",
    suggestion: "请在需求导入时提供 productModuleRows，或在评估包中手动维护模块范围",
  },
  {
    fieldPath: "sow.developmentScope",
    fallbackPaths: ["requirementImportData.devOverviewRows", "basicInfo.developmentScope"],
    severity: "info",
    message: "SOW 缺少定制化开发范围",
    suggestion: "请在需求导入时提供 devOverviewRows；如确认无定制开发，可手动设为'无'",
    allowEmptyValue: true,
  },
  {
    fieldPath: "sow.wbs",
    fallbackPaths: ["requirementImportData.wbs", "projectPlan.wbs"],
    severity: "error",
    message: "SOW 缺少工作分解结构（WBS）",
    suggestion: "请在评估包中维护 WBS，或从项目计划自动生成",
  },
];

// ------------------------------------------------------------------
// 匹配 helpers
// ------------------------------------------------------------------

function findEvidence(evidences: Evidence[], fieldPath: string): Evidence | undefined {
  return evidences.find((e) => e.fieldPath === fieldPath);
}

function findEvidenceWithFallback(evidences: Evidence[], config: RequiredField): Evidence | undefined {
  // 1. 精确匹配主路径
  const exact = findEvidence(evidences, config.fieldPath);
  if (exact) return exact;

  // 2. fallback 路径匹配
  if (config.fallbackPaths) {
    for (const fp of config.fallbackPaths) {
      const hit = findEvidence(evidences, fp);
      if (hit) return hit;
    }
  }

  return undefined;
}

// ------------------------------------------------------------------
// 规则实现
// ------------------------------------------------------------------

export const sowCompletenessV1: DslRule = {
  id: "sow-completeness-v1",
  name: "SOW 完备性检查",
  description:
    "检查 SOW 的 4 个核心范围（组织范围、模块范围、开发范围、WBS）" +
    "是否在证据链中有对应证据。开发范围允许值为'无'，其余三项必须非空。",

  check(context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const req of REQUIRED_FIELDS) {
      const ev = findEvidenceWithFallback(context.evidences, req);

      if (!ev) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: req.severity,
          fieldPath: req.fieldPath,
          message: req.message,
          suggestion: req.suggestion,
        });
        continue;
      }

      // 值非空校验（仅对不允许空的字段）
      if (!req.allowEmptyValue && ev.value.trim() === "") {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: req.severity,
          fieldPath: req.fieldPath,
          message: `${req.message}（值为空）`,
          suggestion: req.suggestion,
        });
      }
    }

    return violations;
  },
};
