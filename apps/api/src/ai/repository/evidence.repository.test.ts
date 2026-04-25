// ============================================================
// EvidenceRepository 集成测试
// ============================================================
// 目标库：workload_eval_test（独立库，不污染 dev 数据）
// 清理策略：文件级 before 中 TRUNCATE；测试间串行，无并发死锁风险。

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import { testDb, truncateTestTables } from "../../test-helpers/db";
import { EvidenceRepository } from "./evidence.repository";
import type { Evidence, ExtractionResult } from "../evidence/types";

// 文件级清理：每个测试文件开始前执行一次
before(async () => {
  await truncateTestTables();
});

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  const now = new Date().toISOString();
  return {
    evidenceId: randomUUID(),
    fieldPath: "basicInfo.customerIndustry",
    value: "制造业",
    method: "ai",
    confidence: 0.92,
    source: { kind: "ai_inference" },
    extractedAt: now,
    ...overrides,
  };
}

function makeExtractionResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  const now = new Date().toISOString();
  return {
    extractionId: randomUUID(),
    sourceRef: "test-requirement.xlsx",
    status: "success",
    evidences: [],
    warnings: [],
    fallbacks: [],
    durationMs: 1234,
    extractedAt: now,
    ...overrides,
  };
}

// ------------------------------------------------------------------
// 测试套件
// ------------------------------------------------------------------

test("saveExtractionResult + findByExtractionId: 完整 round-trip", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const ev1 = makeEvidence({ fieldPath: "basicInfo.projectName", value: "UT 项目" });
  const ev2 = makeEvidence({ fieldPath: "basicInfo.customerIndustry", value: "制造业", method: "rule" });
  const result = makeExtractionResult({
    evidences: [ev1, ev2],
    warnings: [{ fieldPath: "devOverviewRows", reason: "无开发概要" }],
  });

  await repo.saveExtractionResult(result);

  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found, "应能查找到保存的 ExtractionResult");
  assert.equal(found.extractionId, result.extractionId);
  assert.equal(found.sourceRef, result.sourceRef);
  assert.equal(found.status, "success");
  assert.equal(found.evidences.length, 2);
  assert.equal(found.evidences[0].fieldPath, "basicInfo.projectName");
  assert.equal(found.evidences[1].method, "rule");
  assert.equal(found.warnings.length, 1);
});

test("findByExtractionId: 不存在时返回 null", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const found = await repo.findByExtractionId(randomUUID());
  assert.equal(found, null);
});

test("saveExtractionResult: 空 evidences 数组也能保存", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const result = makeExtractionResult({ evidences: [] });
  await repo.saveExtractionResult(result);

  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);
  assert.equal(found.evidences.length, 0);
});

test("appendEvidenceHistory: 覆盖值并写入 change_logs", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  // 1. 先保存一条 ExtractionResult
  const ev = makeEvidence({ value: "原始值", method: "ai" });
  const result = makeExtractionResult({ evidences: [ev] });
  await repo.saveExtractionResult(result);

  // 2. 人工覆盖
  await repo.appendEvidenceHistory({
    evidenceId: ev.evidenceId,
    newValue: "人工修正值",
    newMethod: "manual",
    changedByUserId: "user-001",
    reason: "客户确认",
  });

  // 3. 重新查询验证 evidence 已更新
  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);
  const updatedEv = found.evidences.find((e) => e.evidenceId === ev.evidenceId);
  assert.ok(updatedEv);
  assert.equal(updatedEv.value, "人工修正值");
  assert.equal(updatedEv.method, "manual");
  assert.ok(updatedEv.history);
  assert.equal(updatedEv.history!.length, 1);
  assert.equal(updatedEv.history![0].value, "原始值");
  assert.equal(updatedEv.history![0].method, "ai");

  // 4. 验证 change_logs 写入
  const logs = await testDb
    .select()
    .from(schema.changeLogs)
    .where(sql`${schema.changeLogs.evidenceId} = ${ev.evidenceId}`);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].oldValue, "原始值");
  assert.equal(logs[0].newValue, "人工修正值");
  assert.equal(logs[0].newMethod, "manual");
  assert.equal(logs[0].oldMethod, "ai");
  assert.equal(logs[0].changedByUserId, "user-001");
  assert.equal(logs[0].reason, "客户确认");
});

test("appendEvidenceHistory: 多次覆盖追加多条 history", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  const ev = makeEvidence({ value: "v1", method: "ai" });
  const result = makeExtractionResult({ evidences: [ev] });
  await repo.saveExtractionResult(result);

  await repo.appendEvidenceHistory({
    evidenceId: ev.evidenceId,
    newValue: "v2",
    newMethod: "manual",
  });

  await repo.appendEvidenceHistory({
    evidenceId: ev.evidenceId,
    newValue: "v3",
    newMethod: "manual",
    changedByUserId: "user-002",
    reason: "二次确认",
  });

  const found = await repo.findByExtractionId(result.extractionId);
  assert.ok(found);
  const updatedEv = found.evidences[0];
  assert.equal(updatedEv.value, "v3");
  assert.ok(updatedEv.history);
  assert.equal(updatedEv.history!.length, 2);
  assert.equal(updatedEv.history![0].value, "v1");
  assert.equal(updatedEv.history![1].value, "v2");

  const logs = await testDb
    .select()
    .from(schema.changeLogs)
    .where(sql`${schema.changeLogs.evidenceId} = ${ev.evidenceId}`);

  assert.equal(logs.length, 2);
});

test("appendEvidenceHistory: evidence 不存在时抛错", async () => {
  await truncateTestTables();
  const repo = new EvidenceRepository(testDb);

  await assert.rejects(
    async () =>
      repo.appendEvidenceHistory({
        evidenceId: randomUUID(),
        newValue: "x",
        newMethod: "manual",
      }),
    /Evidence not found/,
  );
});

// 测试套件结束时关闭连接池
test("cleanup", async () => {
  const { testPool } = await import("../../test-helpers/db");
  await testPool.end();
});
