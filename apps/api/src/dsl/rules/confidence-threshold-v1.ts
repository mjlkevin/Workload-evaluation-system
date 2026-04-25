// ============================================================
// DSL 规则：confidence-threshold-v1
// ============================================================
// 置信度阈值检查 —— US-8 "每个字段看到置信度来源（AI 抽取 / 已确认 / 未知），优先处理不确定的地方"。
//
// 规则逻辑：
//   - 遍历全部证据
//   - 若 confidence < 0.7（warning）或 < 0.5（error）
//   - 产出对应严重程度的违规，提示人工复核
//
// 阈值说明（P0.2 暂定）：
//   - confidence < 0.5 → error（几乎不可信，必须人工确认）
//   - confidence 0.5~0.7 → warning（可信度偏低，建议复核）
//   - confidence >= 0.7 → 通过

import type { DslRule, RuleContext, RuleViolation } from "../types";

const THRESHOLD_ERROR = 0.5;
const THRESHOLD_WARNING = 0.7;

export const confidenceThresholdV1: DslRule = {
  id: "confidence-threshold-v1",
  name: "置信度阈值检查",
  description:
    "检查证据链中是否存在置信度过低的字段。" +
    "confidence < 0.5 视为 error，0.5~0.7 视为 warning，引导用户优先处理不确定项。",

  check(context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const ev of context.evidences) {
      if (ev.confidence < THRESHOLD_ERROR) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: "error",
          fieldPath: ev.fieldPath,
          message: `字段 "${ev.fieldPath}" 的置信度过低（${ev.confidence.toFixed(2)} < ${THRESHOLD_ERROR}），AI 抽取结果可信度不足`,
          suggestion: "请人工核对该字段值，确认后覆盖为 manual 来源以提升置信度",
        });
      } else if (ev.confidence < THRESHOLD_WARNING) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: "warning",
          fieldPath: ev.fieldPath,
          message: `字段 "${ev.fieldPath}" 的置信度偏低（${ev.confidence.toFixed(2)} < ${THRESHOLD_WARNING}），建议复核`,
          suggestion: "建议人工复核该字段值，确保与原始物料一致",
        });
      }
    }

    return violations;
  },
};
