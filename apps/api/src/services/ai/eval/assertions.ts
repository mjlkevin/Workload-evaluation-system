// ============================================================
// Sprint 3B · RP-048 骨架 — 确定性断言框架
// 对 dispatch 结果做确定性断言，零外部依赖（不接 LLM 裁判）
// ============================================================

import type { WorkbenchIntent } from "../workbench-intent.service";
import type { WorkbenchDispatchData } from "../workbench-dispatch.service";
import { CAPABILITY_FACTS } from "../workbench-capability-facts";
import type { EvalSample } from "./samples";

/** 单条断言结果 */
export interface AssertionResult {
  pass: boolean;
  label: string;
  detail: string;
}

/** 样本级断言结果 */
export interface SampleAssertionResult {
  sampleId: string;
  category: string;
  allPassed: boolean;
  assertions: AssertionResult[];
  intent: WorkbenchIntent;
  routingRule: string;
  answerLength: number;
}

// ── 常量 ────────────────────────────────────────────────────

/** 回复长度合理区间 */
const ANSWER_LENGTH_MIN = 1;
const ANSWER_LENGTH_MAX = 2000;

/** 能力事实表关键词（用于校验 capability 回复不越界） */
const CAPABILITY_KEYWORDS = new Set(
  CAPABILITY_FACTS.flatMap((f) => [
    f.id,
    f.category,
    ...f.description.split(/\s+/),
    ...(f.details ?? []).flatMap((d) => d.split(/\s+/)),
  ]).filter((w) => w.length >= 2),
);

// ── 断言器 ──────────────────────────────────────────────────

/**
 * 断言 1：意图路由正确（intent 类型匹配）
 */
function assertIntentRoutedCorrectly(
  sample: EvalSample,
  result: WorkbenchDispatchData,
): AssertionResult {
  const pass = result.intent === sample.expectedIntent;
  return {
    pass,
    label: "intent_routing",
    detail: pass
      ? `intent=${result.intent} 符合预期`
      : `intent=${result.intent}，期望 ${sample.expectedIntent}`,
  };
}

/**
 * 断言 2：路由规则匹配（若样本指定了 expectedRoutingRule）
 */
function assertRoutingRuleMatched(
  sample: EvalSample,
  result: WorkbenchDispatchData,
): AssertionResult {
  if (!sample.expectedRoutingRule) {
    return { pass: true, label: "routing_rule", detail: "样本未指定路由规则，跳过" };
  }
  const pass = result.trace.routingRule === sample.expectedRoutingRule;
  return {
    pass,
    label: "routing_rule",
    detail: pass
      ? `routingRule=${result.trace.routingRule} 符合预期`
      : `routingRule=${result.trace.routingRule}，期望 ${sample.expectedRoutingRule}`,
  };
}

/**
 * 断言 3：回复非空且长度在合理区间
 */
function assertAnswerLengthValid(result: WorkbenchDispatchData): AssertionResult {
  const len = (result.answer || "").length;
  const pass = len >= ANSWER_LENGTH_MIN && len <= ANSWER_LENGTH_MAX;
  return {
    pass,
    label: "answer_length",
    detail: pass
      ? `回复长度 ${len} 在合理区间 [${ANSWER_LENGTH_MIN}, ${ANSWER_LENGTH_MAX}]`
      : `回复长度 ${len} 超出合理区间 [${ANSWER_LENGTH_MIN}, ${ANSWER_LENGTH_MAX}]`,
  };
}

/**
 * 断言 4：capability 回复不得出现事实表之外的能力承诺
 * 策略：检查回复中是否包含明显不属于 CAPABILITY_FACTS 的"我能"/"我可以"/"支持"等承诺句式
 * 本批为轻量启发式校验，Sprint 4 升级为语义裁判
 */
function assertCapabilityFactsBound(
  sample: EvalSample,
  result: WorkbenchDispatchData,
): AssertionResult {
  // 仅对 capability_discovery 意图执行此断言
  if (sample.expectedIntent !== "capability_discovery") {
    return { pass: true, label: "capability_facts_bound", detail: "非 capability 意图，跳过" };
  }

  const answer = result.answer || "";

  // 启发式：检测"过度承诺"句式——声称能做事实表未列出的能力
  // 只标记明显越界的关键词（如"写诗"、"编程"、"画图"等）
  const OVERPROMISE_KEYWORDS = [
    "写诗", "作诗", "写小说", "编程", "写代码", "画图", "绘画", "生成图片",
    "翻译", "天气预报", "股票", "算命", "占卜", "玩游戏", "下棋",
  ];

  const found = OVERPROMISE_KEYWORDS.filter((kw) => answer.includes(kw));
  const pass = found.length === 0;

  return {
    pass,
    label: "capability_facts_bound",
    detail: pass
      ? "未检测到事实表外能力承诺"
      : `检测到越界承诺关键词: ${found.join(", ")}`,
  };
}

/**
 * 断言 5：超范围样本必须命中 unsupported_or_out_of_scope
 */
function assertOutOfScopeIntercepted(
  sample: EvalSample,
  result: WorkbenchDispatchData,
): AssertionResult {
  if (sample.category !== "out_of_scope") {
    return { pass: true, label: "out_of_scope_intercepted", detail: "非超范围样本，跳过" };
  }
  const pass = result.intent === "unsupported_or_out_of_scope";
  return {
    pass,
    label: "out_of_scope_intercepted",
    detail: pass
      ? "超范围请求已正确拦截"
      : `超范围请求未被拦截，实际 intent=${result.intent}`,
  };
}

/**
 * 断言 6：报告请求样本必须命中 harness_report_generation
 */
function assertReportRequestRouted(
  sample: EvalSample,
  result: WorkbenchDispatchData,
): AssertionResult {
  if (sample.category !== "explicit_report_request") {
    return { pass: true, label: "report_request_routed", detail: "非报告请求样本，跳过" };
  }
  const pass = result.intent === "harness_report_generation";
  return {
    pass,
    label: "report_request_routed",
    detail: pass
      ? "报告请求已正确路由"
      : `报告请求路由错误，实际 intent=${result.intent}`,
  };
}

// ── 聚合断言 ────────────────────────────────────────────────

/**
 * 对单个样本执行全部确定性断言
 */
export function runAssertionsForSample(
  sample: EvalSample,
  result: WorkbenchDispatchData,
): SampleAssertionResult {
  const assertions: AssertionResult[] = [
    assertIntentRoutedCorrectly(sample, result),
    assertRoutingRuleMatched(sample, result),
    assertAnswerLengthValid(result),
    assertCapabilityFactsBound(sample, result),
    assertOutOfScopeIntercepted(sample, result),
    assertReportRequestRouted(sample, result),
  ];

  return {
    sampleId: sample.id,
    category: sample.category,
    allPassed: assertions.every((a) => a.pass),
    assertions,
    intent: result.intent,
    routingRule: result.trace.routingRule,
    answerLength: (result.answer || "").length,
  };
}

/**
 * 聚合全部样本断言结果
 */
export function summarizeResults(results: SampleAssertionResult[]): {
  totalSamples: number;
  passedSamples: number;
  failedSamples: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  failures: Array<{ sampleId: string; category: string; failedLabels: string[]; details: string[] }>;
} {
  let totalAssertions = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;
  const failures: Array<{
    sampleId: string;
    category: string;
    failedLabels: string[];
    details: string[];
  }> = [];

  for (const r of results) {
    for (const a of r.assertions) {
      totalAssertions++;
      if (a.pass) {
        passedAssertions++;
      } else {
        failedAssertions++;
      }
    }

    if (!r.allPassed) {
      failures.push({
        sampleId: r.sampleId,
        category: r.category,
        failedLabels: r.assertions.filter((a) => !a.pass).map((a) => a.label),
        details: r.assertions.filter((a) => !a.pass).map((a) => a.detail),
      });
    }
  }

  return {
    totalSamples: results.length,
    passedSamples: results.filter((r) => r.allPassed).length,
    failedSamples: results.filter((r) => !r.allPassed).length,
    totalAssertions,
    passedAssertions,
    failedAssertions,
    failures,
  };
}
