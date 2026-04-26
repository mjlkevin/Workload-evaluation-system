// ============================================================
// 置信度加权计算单元测试
// ============================================================
// 验证 _computeConfidenceSummary 使用 industry 0.3 / scale 0.3 / modules 0.4 权重

import test from "node:test";
import assert from "node:assert/strict";
import { RequirementPackService } from "./requirement-pack";
import type { Evidence } from "../../ai/evidence/types";

function invokeConfidenceSummary(svc: RequirementPackService, evidences: Evidence[]) {
  const mockPack = {} as any; // 不需要真实 pack
  return (svc as any)._computeConfidenceSummary(evidences, mockPack);
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: `ev-${Date.now()}-${Math.random()}`,
    fieldPath: "test.field",
    value: "test",
    method: "ai",
    confidence: 0.8,
    source: { kind: "ai_inference" },
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("置信度加权：核心字段齐全时按 0.3/0.3/0.4 加权", () => {
  const svc = new RequirementPackService({} as any);

  const evidences: Evidence[] = [
    makeEvidence({ fieldPath: "basicInfo.industry", confidence: 0.9 }),
    makeEvidence({ fieldPath: "basicInfo.scale", confidence: 0.8 }),
    makeEvidence({ fieldPath: "sow.moduleScope", confidence: 0.7 }),
  ];

  const summary = invokeConfidenceSummary(svc, evidences);

  // 期望：0.9*0.3 + 0.8*0.3 + 0.7*0.4 = 0.27 + 0.24 + 0.28 = 0.79
  const expected = 0.9 * 0.3 + 0.8 * 0.3 + 0.7 * 0.4;
  assert.equal(summary.overall, Math.round(expected * 100) / 100);
});

test("置信度加权：核心字段缺失时权重转移给次要字段", () => {
  const svc = new RequirementPackService({} as any);

  // 只有 industry（0.3 权重），缺失 scale 和 modules
  const evidences: Evidence[] = [
    makeEvidence({ fieldPath: "basicInfo.industry", confidence: 0.9 }),
    makeEvidence({ fieldPath: "basicInfo.projectName", confidence: 0.6 }), // 次要字段
  ];

  const summary = invokeConfidenceSummary(svc, evidences);

  // industry: 0.9 * 0.3 = 0.27
  // 剩余权重 0.7 分配给 projectName: 0.6 * 0.7 = 0.42
  // 总计：0.27 + 0.42 = 0.69
  const expected = 0.9 * 0.3 + 0.6 * 0.7;
  assert.equal(summary.overall, Math.round(expected * 100) / 100);
});

test("置信度加权：全部核心字段缺失时全部权重给次要字段", () => {
  const svc = new RequirementPackService({} as any);

  const evidences: Evidence[] = [
    makeEvidence({ fieldPath: "basicInfo.projectName", confidence: 0.8 }),
    makeEvidence({ fieldPath: "sow.wbs", confidence: 0.6 }),
  ];

  const summary = invokeConfidenceSummary(svc, evidences);

  // 全部权重 1.0 给次要字段，平均 (0.8 + 0.6) / 2 = 0.7
  assert.equal(summary.overall, 0.7);
});

test("置信度加权：核心字段有多条证据时取平均", () => {
  const svc = new RequirementPackService({} as any);

  const evidences: Evidence[] = [
    makeEvidence({ fieldPath: "basicInfo.industry", confidence: 0.9 }),
    makeEvidence({ fieldPath: "basicInfo.industry", confidence: 0.7 }), // 同一字段第二条
    makeEvidence({ fieldPath: "basicInfo.scale", confidence: 0.8 }),
    makeEvidence({ fieldPath: "sow.moduleScope", confidence: 0.6 }),
  ];

  const summary = invokeConfidenceSummary(svc, evidences);

  // industry 平均：(0.9 + 0.7) / 2 = 0.8
  // 期望：0.8*0.3 + 0.8*0.3 + 0.6*0.4 = 0.24 + 0.24 + 0.24 = 0.72
  const expected = 0.8 * 0.3 + 0.8 * 0.3 + 0.6 * 0.4;
  assert.equal(summary.overall, Math.round(expected * 100) / 100);
});

test("置信度加权：空证据返回 0", () => {
  const svc = new RequirementPackService({} as any);
  const summary = invokeConfidenceSummary(svc, []);
  assert.equal(summary.overall, 0);
});
