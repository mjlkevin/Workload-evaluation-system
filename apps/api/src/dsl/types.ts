// ============================================================
// DSL 引擎 - 类型定义
// ============================================================
// P0 阶段最小可行模型：
//   - Rule：声明式规则（id + name + description + check 函数）
//   - RuleContext：执行上下文（extractionId + evidences[]）
//   - RuleViolation：规则执行产出（违规/缺失/提示）
//
// 设计预留：
//   - severity 三档（error / warning / info）支撑 P-1 "AI Suggests, Human Decides"
//   - suggestion 字段引导用户补全
//   - 未来 P0.2 可扩展为带表达式求值的复杂规则（条件分支、数值比较等）

import type { Evidence } from "../ai/evidence/types";

export type RuleSeverity = "error" | "warning" | "info";

export interface RuleViolation {
  /** 规则唯一标识 */
  ruleId: string;
  /** 规则可读名称 */
  ruleName: string;
  /** 严重程度 */
  severity: RuleSeverity;
  /** 关联的证据字段路径 */
  fieldPath: string;
  /** 人类可读的问题描述 */
  message: string;
  /** 修复建议 */
  suggestion?: string;
}

export interface RuleContext {
  /** 当前被检查的抽取记录 ID */
  extractionId: string;
  /** 该抽取记录下的全量证据 */
  evidences: Evidence[];
}

export interface DslRule {
  /** 规则 ID，全局唯一，形如 domain-name-vN */
  id: string;
  /** 规则可读名称 */
  name: string;
  /** 规则业务描述 */
  description: string;
  /**
   * 规则执行函数。
   * 返回 RuleViolation[]；空数组表示全部通过。
   * 抛出的异常由引擎捕获并包装为 engine_execution_error。
   */
  check(context: RuleContext): RuleViolation[];
}
