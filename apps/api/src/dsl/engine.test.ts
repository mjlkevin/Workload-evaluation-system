// ============================================================
// DSL 引擎 + 规则集测试
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { evaluate, evaluateOne } from "./engine";
import { sowCompletenessV1 } from "./rules/sow-completeness-v1";
import { industryMandatoryV1 } from "./rules/industry-mandatory-v1";
import { moduleDependencyV1 } from "./rules/module-dependency-v1";
import { confidenceThresholdV1 } from "./rules/confidence-threshold-v1";
import { wbsCompletenessV1 } from "./rules/wbs-completeness-v1";
import type { Evidence } from "../ai/evidence/types";
import type { DslRule, RuleContext } from "./types";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: randomUUID(),
    fieldPath: "test.field",
    value: "test-value",
    method: "ai",
    confidence: 0.8,
    source: { kind: "ai_inference" },
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(evidences: Evidence[]): RuleContext {
  return { extractionId: randomUUID(), evidences };
}

// ------------------------------------------------------------------
// sow-completeness-v1
// ------------------------------------------------------------------

test("sow-completeness-v1: 4 项全齐 → 0 违规", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.organizationScope", value: "3 家公司" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、供应链云" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "7 阶段 WBS" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 0);
});

test("sow-completeness-v1: 缺组织范围 → error", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "WBS" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "error");
  assert.equal(result[0].fieldPath, "sow.organizationScope");
  assert.match(result[0].message, /组织范围/);
});

test("sow-completeness-v1: 缺模块范围 → error", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.organizationScope", value: "3 家公司" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "WBS" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "error");
  assert.equal(result[0].fieldPath, "sow.moduleScope");
});

test("sow-completeness-v1: 开发范围为'无' → 通过（info 级允许空）", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.organizationScope", value: "3 家公司" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "WBS" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 0);
});

test("sow-completeness-v1: 缺 WBS → error", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.organizationScope", value: "3 家公司" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "2 个定制功能" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "error");
  assert.equal(result[0].fieldPath, "sow.wbs");
});

test("sow-completeness-v1: 全部缺失 → 4 个违规", () => {
  const ctx = makeContext([]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 4);
  const errors = result.filter((r) => r.severity === "error");
  const infos = result.filter((r) => r.severity === "info");
  assert.equal(errors.length, 3); // 组织、模块、WBS
  assert.equal(infos.length, 1);  // 开发范围
});

test("sow-completeness-v1: fallback 路径匹配（旧 fieldPath 也能命中）", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "requirementImportData.implementationScopeRows", value: "3 家公司" }),
    makeEvidence({ fieldPath: "requirementImportData.productModuleRows", value: "财务云" }),
    makeEvidence({ fieldPath: "requirementImportData.devOverviewRows", value: "无" }),
    makeEvidence({ fieldPath: "requirementImportData.wbs", value: "WBS" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  assert.equal(result.length, 0, "fallback 路径应能正确匹配旧 fieldPath");
});

test("sow-completeness-v1: 值为空字符串 → 报违规（开发范围除外）", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.organizationScope", value: "" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "WBS" }),
  ]);
  const result = evaluateOne(sowCompletenessV1, ctx);
  // 组织范围值为空 → error；开发范围值为空 → 允许（info 级且 allowEmptyValue=true）
  const orgViolation = result.find((r) => r.fieldPath === "sow.organizationScope");
  const devViolation = result.find((r) => r.fieldPath === "sow.developmentScope");
  assert.ok(orgViolation, "组织范围为空应报违规");
  assert.equal(devViolation, undefined, "开发范围为空不应报违规");
});

// ------------------------------------------------------------------
// industry-mandatory-v1
// ------------------------------------------------------------------

test("industry-mandatory-v1: 制造业缺生产管理 → warning", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "industry", value: "大型制造业集团" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、供应链云" }),
  ]);
  const result = evaluateOne(industryMandatoryV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "warning");
  assert.match(result[0].message, /生产管理/);
});

test("industry-mandatory-v1: 制造业有生产管理 → 通过", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "industry", value: "制造业" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、MES、生产管理" }),
  ]);
  const result = evaluateOne(industryMandatoryV1, ctx);
  assert.equal(result.length, 0);
});

test("industry-mandatory-v1: 零售业缺 POS → warning", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "industry", value: "连锁零售" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
  ]);
  const result = evaluateOne(industryMandatoryV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "warning");
  assert.match(result[0].message, /POS/);
});

test("industry-mandatory-v1: 无行业信息 → 不报错（由 sow-completeness 负责）", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
  ]);
  const result = evaluateOne(industryMandatoryV1, ctx);
  assert.equal(result.length, 0);
});

test("industry-mandatory-v1: fallback 行业路径", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "requirementImportData.industry", value: "建筑工程" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
  ]);
  const result = evaluateOne(industryMandatoryV1, ctx);
  assert.equal(result.length, 1);
  assert.match(result[0].message, /项目管理/);
});

// ------------------------------------------------------------------
// module-dependency-v1
// ------------------------------------------------------------------

test("module-dependency-v1: 生产管理缺库存 → error", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、生产管理" }),
  ]);
  const result = evaluateOne(moduleDependencyV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "error");
  assert.match(result[0].message, /生产管理依赖库存管理/);
});

test("module-dependency-v1: 生产管理有库存 → 通过", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、生产管理、库存管理" }),
  ]);
  const result = evaluateOne(moduleDependencyV1, ctx);
  assert.equal(result.length, 0);
});

test("module-dependency-v1: 无模块范围 → 不报错", () => {
  const ctx = makeContext([]);
  const result = evaluateOne(moduleDependencyV1, ctx);
  assert.equal(result.length, 0);
});

test("module-dependency-v1: 成本管理缺总账 → error", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "成本管理、采购管理" }),
  ]);
  const result = evaluateOne(moduleDependencyV1, ctx);
  // 成本管理缺总账 + 采购管理缺库存 = 2 个 error
  assert.equal(result.length, 2);
  assert.ok(result.some((r) => r.message.includes("成本管理依赖总账")));
  assert.ok(result.some((r) => r.message.includes("采购管理依赖库存管理")));
});

// ------------------------------------------------------------------
// confidence-threshold-v1
// ------------------------------------------------------------------

test("confidence-threshold-v1: 全部 confidence >= 0.8 → 通过", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "a", confidence: 0.8 }),
    makeEvidence({ fieldPath: "b", confidence: 0.95 }),
  ]);
  const result = evaluateOne(confidenceThresholdV1, ctx);
  assert.equal(result.length, 0);
});

test("confidence-threshold-v1: confidence 0.6 → warning", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "a", confidence: 0.6 }),
  ]);
  const result = evaluateOne(confidenceThresholdV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "warning");
  assert.match(result[0].message, /0.60/);
});

test("confidence-threshold-v1: confidence 0.4 → error", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "a", confidence: 0.4 }),
  ]);
  const result = evaluateOne(confidenceThresholdV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "error");
  assert.match(result[0].message, /0.40/);
});

test("confidence-threshold-v1: 混合置信度 → 正确分级", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "high", confidence: 0.9 }),
    makeEvidence({ fieldPath: "warn", confidence: 0.65 }),
    makeEvidence({ fieldPath: "err", confidence: 0.3 }),
  ]);
  const result = evaluateOne(confidenceThresholdV1, ctx);
  assert.equal(result.length, 2);
  assert.ok(result.find((r) => r.severity === "warning" && r.fieldPath === "warn"));
  assert.ok(result.find((r) => r.severity === "error" && r.fieldPath === "err"));
});

// ------------------------------------------------------------------
// wbs-completeness-v1
// ------------------------------------------------------------------

test("wbs-completeness-v1: 模块范围和 WBS 齐全 → 通过", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、总账、报表" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "总账任务、报表任务、财务云任务" }),
  ]);
  const result = evaluateOne(wbsCompletenessV1, ctx);
  assert.equal(result.length, 0);
});

test("wbs-completeness-v1: 模块范围非空但 WBS 为空 → warning", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、总账" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "" }),
  ]);
  const result = evaluateOne(wbsCompletenessV1, ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "warning");
  assert.match(result[0].message, /WBS 为空/);
});

test("wbs-completeness-v1: 无模块范围 → 不报错", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.wbs", value: "一些 WBS" }),
  ]);
  const result = evaluateOne(wbsCompletenessV1, ctx);
  assert.equal(result.length, 0);
});

// ------------------------------------------------------------------
// 引擎 evaluate
// ------------------------------------------------------------------

test("evaluate: 多条规则顺序执行，结果合并", () => {
  const ruleA: DslRule = {
    id: "test-a",
    name: "测试规则 A",
    description: "",
    check() {
      return [{ ruleId: "test-a", ruleName: "A", severity: "error", fieldPath: "a", message: "A" }];
    },
  };
  const ruleB: DslRule = {
    id: "test-b",
    name: "测试规则 B",
    description: "",
    check() {
      return [{ ruleId: "test-b", ruleName: "B", severity: "warning", fieldPath: "b", message: "B" }];
    },
  };
  const ctx = makeContext([]);
  const result = evaluate([ruleA, ruleB], ctx);
  assert.equal(result.length, 2);
  assert.equal(result[0].ruleId, "test-a");
  assert.equal(result[1].ruleId, "test-b");
});

test("evaluate: 单条规则异常不阻断其他规则", () => {
  const badRule: DslRule = {
    id: "bad",
    name: "坏规则",
    description: "",
    check() {
      throw new Error("boom");
    },
  };
  const goodRule: DslRule = {
    id: "good",
    name: "好规则",
    description: "",
    check() {
      return [{ ruleId: "good", ruleName: "G", severity: "info", fieldPath: "g", message: "G" }];
    },
  };
  const ctx = makeContext([]);
  const result = evaluate([badRule, goodRule], ctx);
  assert.equal(result.length, 2);
  assert.equal(result[0].ruleId, "bad");
  assert.match(result[0].message, /boom/);
  assert.equal(result[1].ruleId, "good");
});

// ------------------------------------------------------------------
// 规则集联合执行
// ------------------------------------------------------------------

test("evaluate: 5 条规则同时执行，结果合并且无冲突", () => {
  const ctx = makeContext([
    makeEvidence({ fieldPath: "sow.organizationScope", value: "" }),
    makeEvidence({ fieldPath: "sow.moduleScope", value: "生产管理" }),
    makeEvidence({ fieldPath: "sow.wbs", value: "" }),
    makeEvidence({ fieldPath: "industry", value: "制造业" }),
    makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
    makeEvidence({ fieldPath: "low-confidence", confidence: 0.3 }),
  ]);
  const result = evaluate([
    sowCompletenessV1,
    industryMandatoryV1,
    moduleDependencyV1,
    confidenceThresholdV1,
    wbsCompletenessV1,
  ], ctx);

  // sow-completeness: 组织范围空 → error, WBS 空 → error, 开发范围通过
  const sowErrors = result.filter((r) => r.ruleId === "sow-completeness-v1" && r.severity === "error");
  assert.equal(sowErrors.length, 2, "sow-completeness 应报 2 个 error（组织范围空 + WBS 空）");

  // industry-mandatory: 制造业缺生产 → warning
  const indWarnings = result.filter((r) => r.ruleId === "industry-mandatory-v1");
  assert.equal(indWarnings.length, 0, "制造业已有生产管理，不应报 warning");

  // module-dependency: 生产管理缺库存 → error
  const depErrors = result.filter((r) => r.ruleId === "module-dependency-v1");
  assert.equal(depErrors.length, 1, "module-dependency 应报 1 个 error（生产缺库存）");

  // confidence-threshold: 0.3 → error
  const confErrors = result.filter((r) => r.ruleId === "confidence-threshold-v1");
  assert.equal(confErrors.length, 1, "confidence-threshold 应报 1 个 error（0.3 < 0.5）");

  // wbs-completeness: 模块范围非空但 WBS 空 → warning
  const wbsWarnings = result.filter((r) => r.ruleId === "wbs-completeness-v1");
  assert.equal(wbsWarnings.length, 1, "wbs-completeness 应报 1 个 warning（WBS 空）");
});
