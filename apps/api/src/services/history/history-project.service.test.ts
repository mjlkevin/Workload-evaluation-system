// ============================================================
// HistoryProject Service 集成测试
// ============================================================
// 目标库：workload_eval_test
// 覆盖：CRUD + 相似度查询 + 边界条件

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testDb, truncateTestTables } from "../../test-helpers/db";
import { HistoryProjectService } from "./history-project.service";

before(async () => {
  await truncateTestTables();
});

test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE history_projects RESTART IDENTITY CASCADE`,
  );
});

// ------------------------------------------------------------------
// 1. closeProject 成功创建
// ------------------------------------------------------------------

test("HistoryProjectService: closeProject 创建历史项目", async () => {
  const svc = new HistoryProjectService(testDb);

  const project = await svc.closeProject({
    industry: "制造业",
    scale: "集团型 / 500人",
    modules: ["总账", "库存", "生产管理"],
    estimatedDays: 120,
    actualDays: 135,
    estimatedCost: 360000,
    actualCost: 405000,
    delayReason: "客户数据迁移延迟",
    riskTags: ["数据迁移", "接口延期"],
    sourceAssessmentVersionId: randomUUID(),
    sourceSealedBaselineId: randomUUID(),
  });

  assert.ok(project.historyProjectId);
  assert.equal(project.industry, "制造业");
  assert.equal(project.scale, "集团型 / 500人");
  assert.deepEqual(project.modules, ["总账", "库存", "生产管理"]);
  assert.equal(project.estimatedDays, 120);
  assert.equal(project.actualDays, 135);
  assert.equal(project.estimatedCost, 360000);
  assert.equal(project.actualCost, 405000);
  assert.equal(project.delayReason, "客户数据迁移延迟");
  assert.deepEqual(project.riskTags, ["数据迁移", "接口延期"]);
  assert.ok(project.closedAt);
});

// ------------------------------------------------------------------
// 2. findById 存在与不存在
// ------------------------------------------------------------------

test("HistoryProjectService: findById 存在与不存在", async () => {
  const svc = new HistoryProjectService(testDb);

  const created = await svc.closeProject({
    industry: "零售业",
    scale: "中型 / 100人",
    estimatedDays: 60,
  });

  const found = await svc.findById(created.historyProjectId);
  assert.ok(found);
  assert.equal(found!.industry, "零售业");

  const notFound = await svc.findById(randomUUID());
  assert.equal(notFound, null);
});

// ------------------------------------------------------------------
// 3. update 更新字段
// ------------------------------------------------------------------

test("HistoryProjectService: update 更新字段", async () => {
  const svc = new HistoryProjectService(testDb);

  const created = await svc.closeProject({
    industry: "金融业",
    scale: "大型 / 300人",
    estimatedDays: 90,
  });

  const updated = await svc.update(created.historyProjectId, {
    scale: "集团型 / 1000人",
    actualDays: 100,
    actualCost: 500000,
    riskTags: ["合规审查"],
  });

  assert.ok(updated);
  assert.equal(updated!.scale, "集团型 / 1000人");
  assert.equal(updated!.actualDays, 100);
  assert.equal(updated!.actualCost, 500000);
  assert.deepEqual(updated!.riskTags, ["合规审查"]);
  assert.equal(updated!.industry, "金融业"); // 未变更字段保持原值

  const notFound = await svc.update(randomUUID(), { industry: "不存在" });
  assert.equal(notFound, null);
});

// ------------------------------------------------------------------
// 4. delete 删除
// ------------------------------------------------------------------

test("HistoryProjectService: delete 删除", async () => {
  const svc = new HistoryProjectService(testDb);

  const created = await svc.closeProject({
    industry: "医药",
    scale: "中型 / 200人",
    estimatedDays: 80,
  });

  const ok = await svc.delete(created.historyProjectId);
  assert.ok(ok);
  assert.equal(await svc.findById(created.historyProjectId), null);

  const notFound = await svc.delete(randomUUID());
  assert.equal(notFound, false);
});

// ------------------------------------------------------------------
// 5. listAll 过滤 + 分页
// ------------------------------------------------------------------

test("HistoryProjectService: listAll 按 industry/scale 过滤与分页", async () => {
  const svc = new HistoryProjectService(testDb);

  await svc.closeProject({ industry: "制造业", scale: "集团型", estimatedDays: 100 });
  await svc.closeProject({ industry: "制造业", scale: "中型", estimatedDays: 100 });
  await svc.closeProject({ industry: "零售业", scale: "集团型", estimatedDays: 100 });
  await svc.closeProject({ industry: "金融业", scale: "大型", estimatedDays: 100 });

  const all = await svc.listAll();
  assert.equal(all.length, 4);

  const manufacturing = await svc.listAll({ industry: "制造业" });
  assert.equal(manufacturing.length, 2);

  const groupScale = await svc.listAll({ scale: "集团型" });
  assert.equal(groupScale.length, 2);

  const limited = await svc.listAll({ limit: 2 });
  assert.equal(limited.length, 2);
});

// ------------------------------------------------------------------
// 6. findSimilar 行业完全匹配 + 规模匹配 + 模块重叠
// ------------------------------------------------------------------

test("HistoryProjectService: findSimilar 行业完全匹配返回最高分", async () => {
  const svc = new HistoryProjectService(testDb);

  // 项目 A：完全匹配
  await svc.closeProject({
    industry: "制造业",
    scale: "集团型 / 500人",
    modules: ["总账", "库存", "生产管理", "MES接口"],
    estimatedDays: 120,
    actualDays: 135,
    estimatedCost: 360000,
    actualCost: 405000,
  });

  // 项目 B：行业部分匹配（大类）
  await svc.closeProject({
    industry: "制造",
    scale: "集团型 / 500人",
    modules: ["总账", "库存"],
    estimatedDays: 100,
    actualDays: 110,
  });

  // 项目 C：完全不匹配
  await svc.closeProject({
    industry: "金融业",
    scale: "小型 / 50人",
    modules: ["CRM"],
    estimatedDays: 30,
    actualDays: 30,
  });

  const results = await svc.findSimilar("制造业", "集团型 / 500人", ["总账", "库存", "生产管理"]);

  assert.ok(results.length > 0);
  assert.equal(results[0].project.industry, "制造业");
  // 50(行业完全) + 20(集团) + 20(500) + 15(3模块重叠) = 105
  assert.equal(results[0].similarityScore, 105);

  // 估实差异
  assert.equal(results[0].estimatedActualDiff.daysDiff, 15);
  assert.equal(results[0].estimatedActualDiff.costDiff, 45000);
});

// ------------------------------------------------------------------
// 7. findSimilar 空 modules / 无匹配行业
// ------------------------------------------------------------------

test("HistoryProjectService: findSimilar 空 modules 与无匹配行业", async () => {
  const svc = new HistoryProjectService(testDb);

  await svc.closeProject({
    industry: "制造业",
    scale: "中型",
    modules: ["总账"],
    estimatedDays: 60,
  });

  // 空 modules 查询
  const emptyModules = await svc.findSimilar("制造业", "中型", []);
  assert.ok(emptyModules.length > 0);
  // 50(行业) + 20(中型) = 70
  assert.equal(emptyModules[0].similarityScore, 70);

  // 不存在的行业
  const noMatch = await svc.findSimilar("航天业", "超大型", ["火箭", "卫星"]);
  assert.equal(noMatch.length, 0);
});

// ------------------------------------------------------------------
// 8. findSimilar 估实差异为 null（缺少 actual 时）
// ------------------------------------------------------------------

test("HistoryProjectService: findSimilar 缺少 actual 时差异为 null", async () => {
  const svc = new HistoryProjectService(testDb);

  await svc.closeProject({
    industry: "食品业",
    scale: "小型 / 50人",
    modules: ["总账"],
    estimatedDays: 45,
    // 无 actualDays / actualCost
  });

  const results = await svc.findSimilar("食品业", "小型 / 50人", ["总账"]);
  assert.ok(results.length > 0);
  assert.equal(results[0].estimatedActualDiff.daysDiff, undefined);
  assert.equal(results[0].estimatedActualDiff.costDiff, undefined);
});

// ------------------------------------------------------------------
// 9. findSimilar 仅返回 top 5
// ------------------------------------------------------------------

test("HistoryProjectService: findSimilar 仅返回 top 5", async () => {
  const svc = new HistoryProjectService(testDb);

  // 插入 8 条记录
  for (let i = 0; i < 8; i++) {
    await svc.closeProject({
      industry: `行业${i}`,
      scale: "中型",
      modules: [`模块${i}`],
      estimatedDays: 50 + i,
    });
  }

  const results = await svc.findSimilar("行业0", "中型", ["模块0"]);
  assert.equal(results.length, 5);
  assert.ok(results[0].similarityScore >= results[4].similarityScore, "按分数降序");
});
