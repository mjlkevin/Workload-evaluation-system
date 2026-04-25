// ============================================================
// DevAssessment Service 测试（P2-2）
// ============================================================
// 覆盖：CRUD + 自动计算 + 合并到总评估

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testDb, truncateTestTables } from "../../test-helpers/db";
import { DevAssessmentService } from "./dev-assessment";
import { assessmentVersions } from "../../db/schema";

before(async () => {
  await truncateTestTables();
});

test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE dev_assessments, assessment_versions RESTART IDENTITY CASCADE`,
  );
});

// ------------------------------------------------------------------
// Create + Find
// ------------------------------------------------------------------

test("DevAssessmentService: create with items auto-calculates derived fields", async () => {
  const svc = new DevAssessmentService(testDb);

  const dev = await svc.create({
    contractMode: "separate",
    items: [
      { domain: "滚动生产计划", module: "批量修改BOM", description: "选中工单执行批量指定BOM", devType: "feature", codingDays: 3 },
      { domain: "重复生产管理", module: "下推领料单", description: "调拨申请单下推重复生产领料单", devType: "feature", codingDays: 4 },
    ],
    assignedByUserId: "impl-01",
    assessedByUserId: "dev-01",
    notes: "请评估",
  });

  assert.ok(dev.devAssessmentId);
  assert.equal(dev.contractMode, "separate");
  assert.equal(dev.status, "draft");
  assert.equal(dev.assignedByUserId, "impl-01");
  assert.equal(dev.assessedByUserId, "dev-01");

  // items 自动计算
  const items = dev.items as any[];
  assert.equal(items.length, 2);
  // item 0: codingDays=3 → planning=0.6, testing=1.2, total=4.8
  assert.equal(items[0].codingDays, 3);
  assert.equal(items[0].planningDays, 0.6);
  assert.equal(items[0].testingDays, 1.2);
  assert.equal(items[0].totalDays, 4.8);
  // item 1: codingDays=4 → planning=0.8, testing=1.6, total=6.4
  assert.equal(items[1].codingDays, 4);
  assert.equal(items[1].planningDays, 0.8);
  assert.equal(items[1].testingDays, 1.6);
  assert.equal(items[1].totalDays, 6.4);

  // totalDays = 4.8 + 6.4 = 11.2
  assert.equal(dev.totalDays, 11.2);
});

test("DevAssessmentService: create with deployOpsItems includes ops in total", async () => {
  const svc = new DevAssessmentService(testDb);

  const dev = await svc.create({
    items: [{ domain: "测试", module: "T1", description: "D1", devType: "feature", codingDays: 5 }],
    deployOpsItems: [
      { description: "私有云部署", days: 10 },
      { description: "运维培训", days: 5 },
    ],
  });

  // dev total = 5 + 1 + 2 = 8; ops = 15; grand total = 23
  assert.equal(dev.totalDays, 23);
});

test("DevAssessmentService: findById returns null for non-existent", async () => {
  const svc = new DevAssessmentService(testDb);
  const found = await svc.findById(randomUUID());
  assert.equal(found, null);
});

// ------------------------------------------------------------------
// List queries
// ------------------------------------------------------------------

test("DevAssessmentService: listByVersionId", async () => {
  const svc = new DevAssessmentService(testDb);
  const versionId = randomUUID();

  await svc.create({ assessmentVersionId: versionId, items: [] });
  await svc.create({ assessmentVersionId: versionId, items: [] });
  await svc.create({ items: [] });

  const list = await svc.listByVersionId(versionId);
  assert.equal(list.length, 2);
});

test("DevAssessmentService: listByAssessedBy with status filter", async () => {
  const svc = new DevAssessmentService(testDb);

  const dev1 = await svc.create({ assessedByUserId: "dev-a", items: [] });
  const dev2 = await svc.create({ assessedByUserId: "dev-a", items: [] });
  const dev3 = await svc.create({ assessedByUserId: "dev-b", items: [] });
  // 手动把 dev2 改成 in_progress 状态
  await svc.update(dev2.devAssessmentId, { status: "in_progress" });

  const all = await svc.listByAssessedBy("dev-a");
  assert.equal(all.length, 2);

  const draftOnly = await svc.listByAssessedBy("dev-a", "draft");
  assert.equal(draftOnly.length, 1);
  assert.equal(draftOnly[0].status, "draft");
});

test("DevAssessmentService: listByAssignedBy", async () => {
  const svc = new DevAssessmentService(testDb);

  await svc.create({ assignedByUserId: "pm-01", items: [] });
  await svc.create({ assignedByUserId: "pm-01", items: [] });
  await svc.create({ assignedByUserId: "pm-02", items: [] });

  const list = await svc.listByAssignedBy("pm-01");
  assert.equal(list.length, 2);
});

// ------------------------------------------------------------------
// Update + recalc
// ------------------------------------------------------------------

test("DevAssessmentService: update items recalculates totalDays", async () => {
  const svc = new DevAssessmentService(testDb);

  const dev = await svc.create({
    items: [{ domain: "A", module: "M1", description: "D1", devType: "feature", codingDays: 2 }],
  });
  assert.equal(dev.totalDays, 3.2); // 2 + 0.4 + 0.8

  const updated = await svc.update(dev.devAssessmentId, {
    items: [{ domain: "A", module: "M1", description: "D1", devType: "feature", codingDays: 10 }],
  });
  assert.ok(updated);
  assert.equal(updated!.totalDays, 16); // 10 + 2 + 4
});

test("DevAssessmentService: update status", async () => {
  const svc = new DevAssessmentService(testDb);
  const dev = await svc.create({ items: [] });

  const updated = await svc.update(dev.devAssessmentId, { status: "confirmed" });
  assert.equal(updated!.status, "confirmed");
});

test("DevAssessmentService: update returns null for non-existent", async () => {
  const svc = new DevAssessmentService(testDb);
  const result = await svc.update(randomUUID(), { notes: "x" });
  assert.equal(result, null);
});

// ------------------------------------------------------------------
// Delete
// ------------------------------------------------------------------

test("DevAssessmentService: delete", async () => {
  const svc = new DevAssessmentService(testDb);
  const dev = await svc.create({ items: [] });

  const ok = await svc.delete(dev.devAssessmentId);
  assert.equal(ok, true);

  const found = await svc.findById(dev.devAssessmentId);
  assert.equal(found, null);
});

test("DevAssessmentService: delete non-existent returns false", async () => {
  const svc = new DevAssessmentService(testDb);
  const ok = await svc.delete(randomUUID());
  assert.equal(ok, false);
});

// ------------------------------------------------------------------
// Merge to version
// ------------------------------------------------------------------

test("DevAssessmentService: mergeToVersion updates status and writes payload", async () => {
  const svc = new DevAssessmentService(testDb);
  const versionId = randomUUID();

  // 先建一个 assessment_version
  await testDb.insert(assessmentVersions).values({
    assessmentVersionId: versionId,
    versionCode: "V1.0-TEST-001",
    revisionType: "initial",
    status: "draft",
    payload: { baseline: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const dev = await svc.create({
    assessmentVersionId: versionId,
    contractMode: "separate",
    items: [{ domain: "X", module: "Y", description: "Z", devType: "integration", codingDays: 5 }],
    assignedByUserId: "pm-01",
    assessedByUserId: "dev-01",
  });

  const result = await svc.mergeToVersion(dev.devAssessmentId, { mergedByUserId: "pm-01" });
  assert.ok(result);

  // devAssessment status 变为 merged
  assert.equal(result!.devAssessment.status, "merged");

  // payload 包含 devAssessment
  const payload = result!.mergedPayload;
  assert.ok(payload.devAssessment);
  assert.equal((payload.devAssessment as any).totalDays, 8); // 5 + 1 + 2
  assert.equal((payload.devAssessment as any).mergedByUserId, "pm-01");

  // 原 payload 字段保留
  assert.equal(payload.baseline, true);
});

test("DevAssessmentService: mergeToVersion fails when not linked", async () => {
  const svc = new DevAssessmentService(testDb);
  const dev = await svc.create({ items: [] });

  await assert.rejects(
    async () => svc.mergeToVersion(dev.devAssessmentId, {}),
    /dev_assessment_not_linked_to_version/,
  );
});

test("DevAssessmentService: mergeToVersion returns null for non-existent", async () => {
  const svc = new DevAssessmentService(testDb);
  const result = await svc.mergeToVersion(randomUUID(), {});
  assert.equal(result, null);
});

// ------------------------------------------------------------------
// AI 生成草稿
// ------------------------------------------------------------------

test("DevAssessmentService: generateDraft updates items and status", async () => {
  const svc = new DevAssessmentService(testDb);
  const dev = await svc.create({
    items: [
      { domain: "A", module: "M1", description: "D1", devType: "feature", codingDays: 1 },
      { domain: "B", module: "M2", description: "D2 比较长".repeat(30), devType: "integration", codingDays: 1 },
    ],
  });

  const result = await svc.generateDraft(dev.devAssessmentId);
  assert.ok(result);
  assert.equal(result!.devAssessment.status, "in_progress");
  assert.equal(result!.aiResult.items.length, 2);
  // fallback 应基于描述长度调整
  const item0 = result!.aiResult.items[0];
  const item1 = result!.aiResult.items[1];
  assert.ok(item0.codingDays >= 2);
  assert.ok(item1.codingDays >= 4);
  assert.ok(result!.aiResult.usedFallback); // 测试环境无 Kimi key，走 fallback
});

test("DevAssessmentService: generateDraft returns null for non-existent", async () => {
  const svc = new DevAssessmentService(testDb);
  const result = await svc.generateDraft(randomUUID());
  assert.equal(result, null);
});
