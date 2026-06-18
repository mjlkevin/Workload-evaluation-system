// ============================================================
// DSL 引擎 - 规则解释器核心
// ============================================================
// 当前 P0 能力：
//   - 顺序执行规则列表
//   - 单条规则异常不阻断其他规则
//   - 结果合并为扁平 RuleViolation[]
//
// 未来扩展点（P0.2 / P1）：
//   - 规则优先级 / 依赖拓扑排序
//   - 短路求值（某规则 error 时跳过下游规则）
//   - 规则级灰度（按 extractionId hash 或租户 ID 启用）
//   - 命中追溯（记录哪条规则命中、哪条跳过）

import type { DslRule, RuleContext, RuleViolation } from "./types";

/**
 * 在指定上下文上执行一组 DSL 规则。
 *
 * @param rules 要执行的规则列表（顺序执行）
 * @param context 执行上下文（extractionId + evidences）
 * @returns 所有规则产出的 RuleViolation 合并列表
 */
export function evaluate(rules: DslRule[], context: RuleContext): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    try {
      const result = rule.check(context);
      violations.push(...result);
    } catch (e) {
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: "error",
        fieldPath: "*",
        message: `规则执行异常: ${e instanceof Error ? e.message : String(e)}`,
        suggestion: "请联系管理员检查规则实现",
      });
    }
  }

  return violations;
}

/** 单规则快捷执行 */
export function evaluateOne(rule: DslRule, context: RuleContext): RuleViolation[] {
  return evaluate([rule], context);
}
