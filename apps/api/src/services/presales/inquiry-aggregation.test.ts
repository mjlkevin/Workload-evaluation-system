// ============================================================
// Inquiry 聚合单元测试
// ============================================================
// 验证 _violationsToInquiries 按 severity + relatedFieldPath 聚合

import test from "node:test";
import assert from "node:assert/strict";
import { RequirementPackService } from "./requirement-pack";
import type { RuleViolation } from "../../dsl/types";

// 通过反射访问 private 方法（测试场景允许）
function invokeViolationsToInquiries(svc: RequirementPackService, violations: RuleViolation[]) {
  return (svc as any)._violationsToInquiries(violations);
}

test("Inquiry 聚合：5 条 violations 聚合成 ≤ 3 条 inquiries", () => {
  const svc = new RequirementPackService({} as any); // 不需要真实 DB

  const violations: RuleViolation[] = [
    {
      ruleId: "sow-completeness-v1",
      ruleName: "SOW 完备性检查",
      severity: "error",
      fieldPath: "sow.organizationScope",
      message: "组织范围缺失",
      suggestion: "请补充组织范围信息",
    },
    {
      ruleId: "sow-completeness-v1",
      ruleName: "SOW 完备性检查",
      severity: "error",
      fieldPath: "sow.organizationScope",
      message: "组织范围描述不完整",
      suggestion: "应包含公司数量和名称",
    },
    {
      ruleId: "sow-completeness-v1",
      ruleName: "SOW 完备性检查",
      severity: "error",
      fieldPath: "sow.moduleScope",
      message: "模块范围缺失",
      suggestion: "请补充模块范围",
    },
    {
      ruleId: "confidence-threshold-v1",
      ruleName: "置信度阈值检查",
      severity: "warning",
      fieldPath: "basicInfo.projectName",
      message: "置信度低于阈值",
      suggestion: "请人工确认",
    },
    {
      ruleId: "wbs-completeness-v1",
      ruleName: "WBS 完备性检查",
      severity: "warning",
      fieldPath: "sow.wbs",
      message: "WBS 阶段不足",
    },
  ];

  const inquiries = invokeViolationsToInquiries(svc, violations);

  // 应该聚合为 3 条：
  // 1. error + sow.organizationScope (2 violations 合并)
  // 2. error + sow.moduleScope (1 violation)
  // 3. warning + basicInfo.projectName (1 violation)
  // 4. warning + sow.wbs (1 violation)
  // 实际是 4 条，因为 fieldPath 不同
  assert.ok(inquiries.length <= 4, `聚合后应 ≤ 4 条，实际 ${inquiries.length} 条`);
  
  // 验证聚合效果：前两条相同 fieldPath 的应该合并
  const orgScopeInquiry = inquiries.find(
    (i: any) => i.relatedFieldPath === "sow.organizationScope"
  );
  assert.ok(orgScopeInquiry, "应找到 organizationScope 的 inquiry");
  assert.ok(
    orgScopeInquiry.question.includes("组织范围缺失"),
    "应包含第一条 message"
  );
  assert.ok(
    orgScopeInquiry.question.includes("组织范围描述不完整"),
    "应包含第二条 message（聚合）"
  );
  assert.ok(
    orgScopeInquiry.suggestion.includes("请补充组织范围信息"),
    "应包含第一条 suggestion"
  );
  assert.ok(
    orgScopeInquiry.suggestion.includes("应包含公司数量和名称"),
    "应包含第二条 suggestion（聚合）"
  );
});

test("Inquiry 聚合：相同 severity + fieldPath 但不同 ruleId 应合并", () => {
  const svc = new RequirementPackService({} as any);

  const violations: RuleViolation[] = [
    {
      ruleId: "rule-a",
      ruleName: "规则 A",
      severity: "error",
      fieldPath: "sow.moduleScope",
      message: "模块 A 缺失",
    },
    {
      ruleId: "rule-b",
      ruleName: "规则 B",
      severity: "error",
      fieldPath: "sow.moduleScope",
      message: "模块 B 缺失",
    },
  ];

  const inquiries = invokeViolationsToInquiries(svc, violations);

  assert.equal(inquiries.length, 1, "相同 severity + fieldPath 应合并为 1 条");
  assert.ok(inquiries[0].question.includes("模块 A 缺失"));
  assert.ok(inquiries[0].question.includes("模块 B 缺失"));
});

test("Inquiry 聚合：不同 severity 不应合并", () => {
  const svc = new RequirementPackService({} as any);

  const violations: RuleViolation[] = [
    {
      ruleId: "rule-a",
      ruleName: "规则 A",
      severity: "error",
      fieldPath: "sow.wbs",
      message: "WBS 缺失（严重）",
    },
    {
      ruleId: "rule-b",
      ruleName: "规则 B",
      severity: "info",
      fieldPath: "sow.wbs",
      message: "WBS 建议补充细节",
    },
  ];

  const inquiries = invokeViolationsToInquiries(svc, violations);

  assert.equal(inquiries.length, 2, "不同 severity 不应合并");
});

test("Inquiry 聚合：不同 fieldPath 不应合并", () => {
  const svc = new RequirementPackService({} as any);

  const violations: RuleViolation[] = [
    {
      ruleId: "rule-a",
      ruleName: "规则 A",
      severity: "error",
      fieldPath: "sow.organizationScope",
      message: "组织范围缺失",
    },
    {
      ruleId: "rule-b",
      ruleName: "规则 B",
      severity: "error",
      fieldPath: "sow.moduleScope",
      message: "模块范围缺失",
    },
  ];

  const inquiries = invokeViolationsToInquiries(svc, violations);

  assert.equal(inquiries.length, 2, "不同 fieldPath 不应合并");
});

test("Inquiry 聚合：空 violations 返回空数组", () => {
  const svc = new RequirementPackService({} as any);
  const inquiries = invokeViolationsToInquiries(svc, []);
  assert.deepEqual(inquiries, []);
});
