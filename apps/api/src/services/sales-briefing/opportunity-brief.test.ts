// ============================================================
// OpportunityBrief Service 集成测试
// ============================================================
// 目标库：workload_eval_test
// 覆盖：CRUD + 报价生成 + 变更重算

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testDb, truncateTestTables } from "../../test-helpers/db";
import { OpportunityBriefService } from "./opportunity-brief";

before(async () => {
  await truncateTestTables();
});

test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE opportunity_briefs RESTART IDENTITY CASCADE`,
  );
});

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

test("OpportunityBriefService: create + findById + listByOwner", async () => {
  const svc = new OpportunityBriefService(testDb);

  const brief = await svc.create({
    customerName: "利民集团",
    customerProfile: { industry: "制造业", scale: "集团型 / 500人" },
    vagueRequirements: "需要总账、库存、生产管理模块，还有MES接口定制",
    ownerUserId: "sales-01",
  });

  assert.ok(brief.opportunityBriefId);
  assert.equal(brief.customerName, "利民集团");
  assert.equal(brief.status, "open");

  const found = await svc.findById(brief.opportunityBriefId);
  assert.ok(found);
  assert.equal(found?.customerName, "利民集团");

  const list = await svc.listByOwner("sales-01");
  assert.equal(list.length, 1);
});

test("OpportunityBriefService: update + delete", async () => {
  const svc = new OpportunityBriefService(testDb);
  const brief = await svc.create({ customerName: "A公司", ownerUserId: "sales-01" });

  const updated = await svc.update(brief.opportunityBriefId, {
    status: "converted",
    vagueRequirements: "更新后的需求",
  });
  assert.ok(updated);
  assert.equal(updated?.status, "converted");
  assert.equal(updated?.vagueRequirements, "更新后的需求");

  const ok = await svc.delete(brief.opportunityBriefId);
  assert.ok(ok);
  assert.equal(await svc.findById(brief.opportunityBriefId), null);
});

// ------------------------------------------------------------------
// 报价生成（US-1）
// ------------------------------------------------------------------

test("OpportunityBriefService: generateQuote 产生区间报价和分期", async () => {
  const svc = new OpportunityBriefService(testDb);
  const brief = await svc.create({
    customerName: "B公司",
    customerProfile: { industry: "制造业", scale: "中型 / 200人" },
    vagueRequirements: "总账、库存、生产管理、MES接口",
    ownerUserId: "sales-01",
  });

  const quoted = await svc.generateQuote(brief.opportunityBriefId, {
    industry: "制造业",
    scale: "中型 / 200人",
    moduleCount: 4,
    customRatio: 0.3,
  });

  assert.ok(quoted);
  const priceRange = quoted!.priceRange as { min: number; max: number; confidence: number; basis: string };
  assert.ok(priceRange.min > 0, "min 应大于 0");
  assert.ok(priceRange.max > priceRange.min, "max 应大于 min");
  assert.ok(priceRange.confidence >= 0.4 && priceRange.confidence <= 0.95, "confidence 在合理范围");
  assert.ok(priceRange.basis.includes("模块数"), "basis 应包含计算依据");

  const phases = quoted!.phaseProposal as Array<{ phase: string; estimatedCost: number }>;
  assert.ok(phases.length >= 2, "应有至少两期方案");
  assert.ok(phases.every((p) => p.estimatedCost > 0), "每期成本应大于 0");
});

test("OpportunityBriefService: generateQuote 紧急项目加价", async () => {
  const svc = new OpportunityBriefService(testDb);
  const brief = await svc.create({ customerName: "C公司", ownerUserId: "sales-01" });

  const normal = await svc.generateQuote(brief.opportunityBriefId, { urgency: "normal" });
  const urgent = await svc.generateQuote(brief.opportunityBriefId, { urgency: "urgent" });

  const normalPrice = normal!.priceRange as { min: number; max: number };
  const urgentPrice = urgent!.priceRange as { min: number; max: number };

  assert.ok(urgentPrice.min > normalPrice.min, "紧急项目 min 应更高");
  assert.ok(urgentPrice.max > normalPrice.max, "紧急项目 max 应更高");
});

// ------------------------------------------------------------------
// 变更重算（US-3）
// ------------------------------------------------------------------

test("OpportunityBriefService: recalculate 增删模块重算", async () => {
  const svc = new OpportunityBriefService(testDb);
  const brief = await svc.create({
    customerName: "D公司",
    vagueRequirements: "总账、库存、生产管理",
    ownerUserId: "sales-01",
  });

  // 先生成报价
  await svc.generateQuote(brief.opportunityBriefId, { moduleCount: 3 });

  // 变更：砍掉分析模块，加 2 家分公司
  const recalculated = await svc.recalculate(brief.opportunityBriefId, {
    removedModules: ["分析模块"],
    addedModules: ["报表模块", "接口模块"],
    addedOrgs: 2,
  });

  assert.ok(recalculated);
  const priceRange = recalculated!.priceRange as { min: number; max: number; basis: string };
  assert.ok(priceRange.basis.includes("变更调整"), "basis 应包含变更说明");
  assert.ok((priceRange as any).confidence < 0.9, "变更后置信度应下降");
});

test("OpportunityBriefService: recalculate 无报价时返回 null", async () => {
  const svc = new OpportunityBriefService(testDb);
  const brief = await svc.create({ customerName: "E公司", ownerUserId: "sales-01" });

  const result = await svc.recalculate(brief.opportunityBriefId, { addedModules: ["新模块"] });
  assert.equal(result, null, "未生成报价时 recalculate 应返回 null");
});
