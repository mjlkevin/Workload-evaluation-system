// ============================================================
// T8 — IA 初评冒烟测试
// ============================================================
// 验收路径：上传 Excel → 抽取 → 证据入库 → DSL 校验 → 角色拦截
//
// 本测试串联 P0 全部 7 个 T 的交付物：
//   T1/T2/T3/T4  RequirementExtractor / Evidence 契约 / Provider 基座
//   T5           EvidenceRepository（PG 持久化）
//   T6           DSL 引擎 + sow-completeness-v1
//   T7           RBAC 角色 + 能力位矩阵
//
// 测试库：workload_eval_test（共享 Pool，串行执行，无并发死锁）

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import { testDb, truncateTestTables } from "../../test-helpers/db";
import { EvidenceRepository } from "../repository/evidence.repository";
import { evaluate } from "../../dsl/engine";
import { sowCompletenessV1 } from "../../dsl/rules/sow-completeness-v1";
import { legacyRoleToV2Roles, anyRoleHasCapability } from "../../rbac";
import type { Evidence, ExtractionResult, ExtractionMethod } from "../evidence/types";

// 文件级清理
before(async () => {
  await truncateTestTables();
});

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  const now = new Date().toISOString();
  return {
    evidenceId: randomUUID(),
    fieldPath: "test.field",
    value: "test-value",
    method: "ai" as ExtractionMethod,
    confidence: 0.85,
    source: { kind: "ai_inference" },
    extractedAt: now,
    ...overrides,
  };
}

function makeExtractionResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  const now = new Date().toISOString();
  return {
    extractionId: randomUUID(),
    sourceRef: "smoke-test-requirement.xlsx",
    status: "success",
    evidences: [],
    warnings: [],
    fallbacks: [],
    durationMs: 1500,
    extractedAt: now,
    extractedByUserId: "user-smoke-001",
    extractorVersion: "requirement-extractor.v1",
    ...overrides,
  };
}

// ------------------------------------------------------------------
// 冒烟测试套件
// ------------------------------------------------------------------

test("T8 冒烟：完整 happy path（4 项齐全 → 0 违规 → 角色权限正确）", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  // Step 1: 模拟 RequirementExtractor 产出 ExtractionResult（含完整 4 项 SOW 证据）
  const result = makeExtractionResult({
    evidences: [
      makeEvidence({ fieldPath: "sow.organizationScope", value: "3 家公司：利民集团、实业、南沙" }),
      makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云、供应链云、制造云" }),
      makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
      makeEvidence({ fieldPath: "sow.wbs", value: "7 阶段：启动→需求→方案→构建→测试→上线→验收" }),
      makeEvidence({ fieldPath: "basicInfo.projectName", value: "利民集团 ERP 一阶段" }),
    ],
  });

  // Step 2: 证据入库（T5）
  await repo.saveExtractionResult(result);

  // Step 3: 从 DB 查询验证（T5）
  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found, "应能从数据库查询到保存的 ExtractionResult");
  assert.equal(found.evidences.length, 5, "应包含 5 条证据");
  assert.equal(found.status, "success");
  assert.equal(found.extractorVersion, "requirement-extractor.v1");

  // Step 4: DSL 校验（T6）
  const violations = evaluate([sowCompletenessV1], {
    extractionId: found.extractionId,
    evidences: found.evidences,
  });
  assert.equal(violations.length, 0, "4 项齐全时应无 SOW 完备性违规");

  // Step 5: 角色拦截检查（T7）
  // PRE_SALES（旧 user 角色映射）应能触发 Extractor
  const preSalesRoles = legacyRoleToV2Roles("user");
  assert.equal(anyRoleHasCapability(preSalesRoles, "extractor:trigger"), true);
  assert.equal(anyRoleHasCapability(preSalesRoles, "assessment:create"), false);

  // PM（旧 sub_admin 角色映射）应能接力初评、调整人天
  const pmRoles = legacyRoleToV2Roles("sub_admin");
  assert.equal(anyRoleHasCapability(pmRoles, "assessment:handoff"), true);
  assert.equal(anyRoleHasCapability(pmRoles, "man-day:adjust"), true);
  assert.equal(anyRoleHasCapability(pmRoles, "dsl:manage"), false);

  // PMO 应能审核/驳回交付物
  const pmoRoles: typeof preSalesRoles = ["PMO"];
  assert.equal(anyRoleHasCapability(pmoRoles, "deliverable:review"), true);
  assert.equal(anyRoleHasCapability(pmoRoles, "deliverable:reject"), true);

  // ADMIN（旧 admin 角色映射）应能管理 DSL 规则
  const adminRoles = legacyRoleToV2Roles("admin");
  assert.equal(anyRoleHasCapability(adminRoles, "dsl:manage"), true);
  assert.equal(anyRoleHasCapability(adminRoles, "user:manage"), true);
});

test("T8 冒烟：缺组织范围 → DSL 报 error，但角色权限仍正确", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const result = makeExtractionResult({
    evidences: [
      // 缺 sow.organizationScope
      makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
      makeEvidence({ fieldPath: "sow.developmentScope", value: "2 个定制功能" }),
      makeEvidence({ fieldPath: "sow.wbs", value: "WBS" }),
    ],
  });

  await repo.saveExtractionResult(result);
  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);

  const violations = evaluate([sowCompletenessV1], {
    extractionId: found.extractionId,
    evidences: found.evidences,
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, "error");
  assert.equal(violations[0].fieldPath, "sow.organizationScope");

  // 角色权限不受 DSL 结果影响
  const preSalesRoles = legacyRoleToV2Roles("user");
  assert.equal(anyRoleHasCapability(preSalesRoles, "extractor:trigger"), true);
});

test("T8 冒烟：开发范围为'无' → DSL 通过（info 级允许空）", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const result = makeExtractionResult({
    evidences: [
      makeEvidence({ fieldPath: "sow.organizationScope", value: "1 家公司" }),
      makeEvidence({ fieldPath: "sow.moduleScope", value: "财务云" }),
      makeEvidence({ fieldPath: "sow.developmentScope", value: "无" }),
      makeEvidence({ fieldPath: "sow.wbs", value: "WBS" }),
    ],
  });

  await repo.saveExtractionResult(result);
  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);

  const violations = evaluate([sowCompletenessV1], {
    extractionId: found.extractionId,
    evidences: found.evidences,
  });

  assert.equal(violations.length, 0, "开发范围为'无'时，SOW 完备性应通过");
});

test("T8 冒烟：全部缺失 → 4 个违规（3 error + 1 info）", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const result = makeExtractionResult({ evidences: [] });
  await repo.saveExtractionResult(result);

  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);

  const violations = evaluate([sowCompletenessV1], {
    extractionId: found.extractionId,
    evidences: found.evidences,
  });

  assert.equal(violations.length, 4);
  const errors = violations.filter((v) => v.severity === "error");
  const infos = violations.filter((v) => v.severity === "info");
  assert.equal(errors.length, 3); // 组织、模块、WBS
  assert.equal(infos.length, 1);  // 开发范围
});

test("T8 冒烟：history 追加 + change_logs 审计双写", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const ev = makeEvidence({ fieldPath: "sow.moduleScope", value: "初始模块范围" });
  const result = makeExtractionResult({ evidences: [ev] });
  await repo.saveExtractionResult(result);

  // PM 角色人工覆盖模块范围
  await repo.appendEvidenceHistory({
    evidenceId: ev.evidenceId,
    newValue: "调整后模块范围：财务云+供应链云",
    newMethod: "manual",
    changedByUserId: "pm-001",
    reason: "客户确认增加供应链模块",
  });

  // 验证 evidence 已更新
  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);
  const updatedEv = found.evidences[0];
  assert.equal(updatedEv.value, "调整后模块范围：财务云+供应链云");
  assert.equal(updatedEv.method, "manual");
  assert.ok(updatedEv.history);
  assert.equal(updatedEv.history!.length, 1);
  assert.equal(updatedEv.history![0].value, "初始模块范围");

  // 验证 change_logs 写入
  const logs = await testDb
    .select()
    .from(schema.changeLogs)
    .where(sql`${schema.changeLogs.evidenceId} = ${ev.evidenceId}`);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].oldValue, "初始模块范围");
  assert.equal(logs[0].newValue, "调整后模块范围：财务云+供应链云");
  assert.equal(logs[0].changedByUserId, "pm-001");
});

// 测试套件结束时关闭连接池
test("cleanup", async () => {
  const { testPool } = await import("../../test-helpers/db");
  await testPool.end();
});
