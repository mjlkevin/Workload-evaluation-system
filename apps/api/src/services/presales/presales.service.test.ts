// ============================================================
// Presales Service 集成测试
// ============================================================
// 目标库：workload_eval_test
// 覆盖：RequirementPack / InitialEstimate / SOW 的 CRUD + 生成 + 审阅

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testDb, truncateTestTables } from "../../test-helpers/db";
import { RequirementPackService } from "./requirement-pack";
import { InitialEstimateService } from "./initial-estimate";
import { SowService } from "./sow";

// 文件级清理
before(async () => {
  await truncateTestTables();
});

// 每个测试后清理新表（串行执行，安全）
test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE requirement_packs, sow_documents, initial_estimates RESTART IDENTITY CASCADE`,
  );
});

// ------------------------------------------------------------------
// RequirementPackService
// ------------------------------------------------------------------

test("RequirementPackService: create + findById + listByOwner", async () => {
  const svc = new RequirementPackService(testDb);

  const pack = await svc.createFromExtraction({
    ownerUserId: "user-pre-sales-01",
  });

  assert.ok(pack.requirementPackId, "应生成 UUID");
  assert.equal(pack.status, "draft", "默认状态 draft");
  assert.equal(pack.ownerUserId, "user-pre-sales-01");

  const found = await svc.findById(pack.requirementPackId);
  assert.ok(found, "应能查找到");
  assert.equal(found?.requirementPackId, pack.requirementPackId);

  const list = await svc.listByOwner("user-pre-sales-01");
  assert.equal(list.length, 1);
  assert.equal(list[0].requirementPackId, pack.requirementPackId);
});

test("RequirementPackService: update + delete", async () => {
  const svc = new RequirementPackService(testDb);

  const pack = await svc.createFromExtraction({ ownerUserId: "u1" });

  const updated = await svc.update(pack.requirementPackId, {
    industry: "制造业",
    scale: "集团型 / 500人",
    status: "confirmed",
  });
  assert.ok(updated);
  assert.equal(updated?.industry, "制造业");
  assert.equal(updated?.scale, "集团型 / 500人");
  assert.equal(updated?.status, "confirmed");

  const ok = await svc.delete(pack.requirementPackId);
  assert.ok(ok);
  const gone = await svc.findById(pack.requirementPackId);
  assert.equal(gone, null);
});

test("RequirementPackService: review 返回 violations + inquiries + confidenceSummary", async () => {
  const svc = new RequirementPackService(testDb);

  const pack = await svc.createFromExtraction({
    ownerUserId: "u1",
  });

  // 空 pack 无 extraction 关联时，review 仍应正常返回
  const review = await svc.review(pack.requirementPackId);
  assert.equal(review.requirementPackId, pack.requirementPackId);
  assert.ok(Array.isArray(review.violations), "violations 是数组");
  assert.ok(Array.isArray(review.inquiries), "inquiries 是数组");
  assert.ok(typeof review.confidenceSummary.overall === "number", "overall 是数字");
  assert.ok("byDimension" in review.confidenceSummary, "有 byDimension");
});

test("RequirementPackService: getFieldConfidences 空 pack 返回 []", async () => {
  const svc = new RequirementPackService(testDb);
  const pack = await svc.createFromExtraction({ ownerUserId: "u1" });
  const confs = await svc.getFieldConfidences(pack.requirementPackId);
  assert.deepEqual(confs, []);
});

// ------------------------------------------------------------------
// InitialEstimateService
// ------------------------------------------------------------------

test("InitialEstimateService: generateFromPack + findById + findByPackId", async () => {
  const packSvc = new RequirementPackService(testDb);
  const estimateSvc = new InitialEstimateService(testDb);

  const pack = await packSvc.createFromExtraction({ ownerUserId: "u1" });
  // 补充模块信息
  await packSvc.update(pack.requirementPackId, {
    modules: [
      { moduleName: "总账", subModules: ["凭证", "报表"] },
      { moduleName: "库存", subModules: ["入库", "出库", "盘点"] },
    ],
    industry: "制造业",
    scale: "集团型 / 500人",
  });
  const updatedPack = (await packSvc.findById(pack.requirementPackId))!;

  const estimate = await estimateSvc.generateFromPack({
    requirementPack: updatedPack,
    ownerUserId: "u1",
  });

  assert.ok(estimate.initialEstimateId, "应生成 UUID");
  assert.equal(estimate.status, "draft");
  assert.equal(estimate.requirementPackId, pack.requirementPackId);
  assert.ok(Array.isArray(estimate.effortEstimate), "有人天估算明细");
  assert.ok(estimate.effortEstimate.length >= 2, "至少两个模块");
  assert.ok(Array.isArray(estimate.riskTags), "有风险标签");
  assert.ok(Array.isArray(estimate.assumptions), "有假设清单");
  assert.ok(estimate.confidenceScores, "有置信度");
  assert.ok(Array.isArray(estimate.phaseProposal), "有分期方案");

  const found = await estimateSvc.findById(estimate.initialEstimateId);
  assert.ok(found);
  assert.equal(found?.initialEstimateId, estimate.initialEstimateId);

  const byPack = await estimateSvc.findByPackId(pack.requirementPackId);
  assert.ok(byPack);
  assert.equal(byPack?.initialEstimateId, estimate.initialEstimateId);
});

test("InitialEstimateService: update + delete", async () => {
  const packSvc = new RequirementPackService(testDb);
  const estimateSvc = new InitialEstimateService(testDb);

  const pack = await packSvc.createFromExtraction({ ownerUserId: "u1" });
  const estimate = await estimateSvc.generateFromPack({ requirementPack: pack, ownerUserId: "u1" });

  const updated = await estimateSvc.update(estimate.initialEstimateId, {
    status: "reviewed",
    reviewedByUserId: "pm-01",
    riskTags: ["接口复杂"],
  });
  assert.ok(updated);
  assert.equal(updated?.status, "reviewed");
  assert.equal(updated?.reviewedByUserId, "pm-01");
  assert.deepEqual(updated?.riskTags, ["接口复杂"]);

  const ok = await estimateSvc.delete(estimate.initialEstimateId);
  assert.ok(ok);
  assert.equal(await estimateSvc.findById(estimate.initialEstimateId), null);
});

// ------------------------------------------------------------------
// SowService
// ------------------------------------------------------------------

test("SowService: generateFromPack + findByPackId", async () => {
  const packSvc = new RequirementPackService(testDb);
  const sowSvc = new SowService(testDb);

  const pack = await packSvc.createFromExtraction({ ownerUserId: "u1" });
  await packSvc.update(pack.requirementPackId, {
    modules: [
      { moduleName: "总账", subModules: ["凭证", "报表"] },
      { moduleName: "生产管理", subModules: ["定制 MES 接口", "工单"] },
    ],
  });
  const updatedPack = (await packSvc.findById(pack.requirementPackId))!;

  const sowItems = await sowSvc.generateFromPack({
    requirementPack: updatedPack,
    cloudProduct: "金蝶AI星空",
    ownerUserId: "u1",
  });

  assert.equal(sowItems.length, 2, "两个模块对应两条 SOW");
  assert.equal(sowItems[0].cloudProduct, "金蝶AI星空");
  assert.equal(sowItems[0].status, "draft");

  // 生产管理含"定制"字样，应为定制开发
  const prodSow = sowItems.find((s) => s.module === "生产管理");
  assert.ok(prodSow);
  assert.equal(prodSow?.category, "定制开发");

  const byPack = await sowSvc.findByPackId(pack.requirementPackId);
  assert.equal(byPack.length, 2);
});

test("SowService: update + delete + bumpVersion", async () => {
  const packSvc = new RequirementPackService(testDb);
  const sowSvc = new SowService(testDb);

  const pack = await packSvc.createFromExtraction({ ownerUserId: "u1" });
  await packSvc.update(pack.requirementPackId, {
    modules: [{ moduleName: "总账", subModules: ["凭证"] }],
  });
  const updatedPack = (await packSvc.findById(pack.requirementPackId))!;

  const [sow] = await sowSvc.generateFromPack({ requirementPack: updatedPack, ownerUserId: "u1" });

  const updated = await sowSvc.update(sow.sowDocumentId, {
    description: "更新后的范围描述",
    status: "confirmed",
  });
  assert.ok(updated);
  assert.equal(updated?.description, "更新后的范围描述");
  assert.equal(updated?.status, "confirmed");

  const bumped = await sowSvc.bumpVersion(pack.requirementPackId, "2.0");
  assert.equal(bumped, 1);

  const afterBump = await sowSvc.findById(sow.sowDocumentId);
  assert.equal(afterBump?.version, "2.0");
  assert.equal(afterBump?.status, "changed");

  const ok = await sowSvc.delete(sow.sowDocumentId);
  assert.ok(ok);
  assert.equal(await sowSvc.findById(sow.sowDocumentId), null);
});

test("SowService: generateFromPack 空模块时生成占位 SOW", async () => {
  const packSvc = new RequirementPackService(testDb);
  const sowSvc = new SowService(testDb);

  const pack = await packSvc.createFromExtraction({ ownerUserId: "u1" });
  const sowItems = await sowSvc.generateFromPack({ requirementPack: pack, ownerUserId: "u1" });

  assert.equal(sowItems.length, 1);
  assert.equal(sowItems[0].module, "待确认模块范围");
});

test("SowService: generateFromPack 同名模块去重 + subModules 合并", async () => {
  const packSvc = new RequirementPackService(testDb);
  const sowSvc = new SowService(testDb);

  const pack = await packSvc.createFromExtraction({ ownerUserId: "u1" });
  // 传 2 个同名模块“总账”
  await packSvc.update(pack.requirementPackId, {
    modules: [
      { moduleName: "总账", subModules: ["凭证", "报表"] },
      { moduleName: "总账", subModules: ["账簿", "期末处理"] },
    ],
  });
  const updatedPack = (await packSvc.findById(pack.requirementPackId))!;

  const sowItems = await sowSvc.generateFromPack({
    requirementPack: updatedPack,
    ownerUserId: "u1",
  });

  // 应只生成 1 条 SOW
  assert.equal(sowItems.length, 1, "同名模块应去重，只生成 1 条 SOW");
  const sow = sowItems[0];
  assert.ok(sow, "SOW 应存在");
  assert.equal(sow.module, "总账");
  // subModules 应合并（4 个：凭证、报表、账簿、期末处理）
  assert.ok(sow.description?.includes("4个子项"), `应合并 subModules，实际: ${sow.description}`);
});

// ------------------------------------------------------------------
// 负向测试用例（Block C）
// ------------------------------------------------------------------

test("RequirementPackService: findById non-existent → null", async () => {
  const svc = new RequirementPackService(testDb);
  const found = await svc.findById("00000000-0000-0000-0000-000000000000");
  assert.equal(found, null, "不存在的 ID 应返回 null");
});

test("RequirementPackService: update non-existent → null", async () => {
  const svc = new RequirementPackService(testDb);
  const updated = await svc.update("00000000-0000-0000-0000-000000000000", { industry: "测试" });
  assert.equal(updated, null, "不存在的 ID 更新应返回 null");
});

test("RequirementPackService: delete non-existent → false", async () => {
  const svc = new RequirementPackService(testDb);
  const ok = await svc.delete("00000000-0000-0000-0000-000000000000");
  assert.equal(ok, false, "不存在的 ID 删除应返回 false");
});

test("RequirementPackService: review on non-existent pack → throws Error", async () => {
  const svc = new RequirementPackService(testDb);
  try {
    await svc.review("00000000-0000-0000-0000-000000000000");
    assert.fail("应抛出错误");
  } catch (err: any) {
    assert.ok(err.message.includes("not found") || err.message.includes("不存在"), "应抛出不存在错误");
  }
});

test("InitialEstimateService: findById non-existent → null", async () => {
  const svc = new InitialEstimateService(testDb);
  const found = await svc.findById("00000000-0000-0000-0000-000000000000");
  assert.equal(found, null, "不存在的 ID 应返回 null");
});

test("InitialEstimateService: update non-existent → null", async () => {
  const svc = new InitialEstimateService(testDb);
  const updated = await svc.update("00000000-0000-0000-0000-000000000000", { status: "reviewed" });
  assert.equal(updated, null, "不存在的 ID 更新应返回 null");
});

test("InitialEstimateService: delete non-existent → false", async () => {
  const svc = new InitialEstimateService(testDb);
  const ok = await svc.delete("00000000-0000-0000-0000-000000000000");
  assert.equal(ok, false, "不存在的 ID 删除应返回 false");
});

test("SowService: findById non-existent → null", async () => {
  const svc = new SowService(testDb);
  const found = await svc.findById("00000000-0000-0000-0000-000000000000");
  assert.equal(found, null, "不存在的 ID 应返回 null");
});

test("SowService: update non-existent → null", async () => {
  const svc = new SowService(testDb);
  const updated = await svc.update("00000000-0000-0000-0000-000000000000", { status: "confirmed" });
  assert.equal(updated, null, "不存在的 ID 更新应返回 null");
});

test("SowService: delete non-existent → false", async () => {
  const svc = new SowService(testDb);
  const ok = await svc.delete("00000000-0000-0000-0000-000000000000");
  assert.equal(ok, false, "不存在的 ID 删除应返回 false");
});

test("SowService: findByPackId non-existent → []", async () => {
  const svc = new SowService(testDb);
  const items = await svc.findByPackId("00000000-0000-0000-0000-000000000000");
  assert.deepEqual(items, [], "不存在的 pack ID 应返回空数组");
});

test("InitialEstimateService: findByPackId non-existent → null", async () => {
  const svc = new InitialEstimateService(testDb);
  const found = await svc.findByPackId("00000000-0000-0000-0000-000000000000");
  assert.equal(found, null, "不存在的 pack ID 应返回 null");
});
