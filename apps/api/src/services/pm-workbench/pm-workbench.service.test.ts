// ============================================================
// PM Workbench Service 集成测试
// ============================================================
// 目标库：workload_eval_test
// 覆盖：Handoff / Narrative / Deliverable / QualityGateReview / SealedBaseline

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testDb, truncateTestTables } from "../../test-helpers/db";
import { AssessmentHandoffService } from "./assessment-handoff";
import { AssessmentNarrativeService } from "./assessment-narrative";
import { DeliverableService } from "./deliverable";
import { QualityGateReviewService } from "./quality-gate-review";
import { SealedBaselineService } from "./sealed-baseline";

before(async () => {
  await truncateTestTables();
});

test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE assessment_handoffs, assessment_narratives, deliverables, quality_gate_reviews, sealed_baselines RESTART IDENTITY CASCADE`,
  );
});

// ------------------------------------------------------------------
// AssessmentHandoffService
// ------------------------------------------------------------------

test("AssessmentHandoffService: create + findById + listByVersion", async () => {
  const svc = new AssessmentHandoffService(testDb);
  const versionId = randomUUID();

  const handoff = await svc.create({
    assessmentVersionId: versionId,
    fromRole: "IMPL",
    toRole: "PM",
    initiatedByUserId: "impl-01",
    contextSnapshot: { requirementPackId: randomUUID() },
  });

  assert.ok(handoff.handoffId);
  assert.equal(handoff.fromRole, "IMPL");
  assert.equal(handoff.toRole, "PM");
  assert.equal(handoff.status, "pending");

  const found = await svc.findById(handoff.handoffId);
  assert.ok(found);
  assert.equal(found?.handoffId, handoff.handoffId);

  const list = await svc.listByVersion(versionId);
  assert.equal(list.length, 1);
});

test("AssessmentHandoffService: accept handoff", async () => {
  const svc = new AssessmentHandoffService(testDb);
  const handoff = await svc.create({ fromRole: "IMPL", toRole: "PM", notes: "请接手" });

  const updated = await svc.update(handoff.handoffId, {
    acceptedByUserId: "pm-01",
    status: "accepted",
  });
  assert.ok(updated);
  assert.equal(updated?.status, "accepted");
  assert.equal(updated?.acceptedByUserId, "pm-01");
});

// ------------------------------------------------------------------
// AssessmentNarrativeService
// ------------------------------------------------------------------

test("AssessmentNarrativeService: create + findById + update", async () => {
  const svc = new AssessmentNarrativeService(testDb);

  const narrative = await svc.create({
    assessmentVersionId: randomUUID(),
    orgAndModules: "组织与模块描述",
    dataGovernance: "数据治理描述",
    generatedFrom: "manual",
  });

  assert.ok(narrative.narrativeId);
  assert.equal(narrative.status, "draft");

  const found = await svc.findById(narrative.narrativeId);
  assert.ok(found);

  const updated = await svc.update(narrative.narrativeId, {
    status: "confirmed",
    acceptanceScope: "验收范围补充",
  });
  assert.equal(updated?.status, "confirmed");
  assert.equal(updated?.acceptanceScope, "验收范围补充");
});

test("AssessmentNarrativeService: generateDraft from pack data", async () => {
  const svc = new AssessmentNarrativeService(testDb);

  const narrative = await svc.generateDraft({
    assessmentVersionId: randomUUID(),
    packData: {
      industry: "制造业",
      scale: "集团型 / 500人",
      modules: [{ moduleName: "总账", subModules: ["凭证"] }],
    },
    estimateData: {
      riskTags: ["接口复杂"],
      assumptions: [{ assumption: "数据可迁移", rationale: "", riskIfInvalid: "" }],
      phaseProposal: [{ phase: "第一期", modules: ["总账"], estimatedDays: 30, milestone: "上线" }],
    },
  });

  assert.ok(narrative.narrativeId);
  assert.ok(narrative.orgAndModules?.includes("制造业"));
  assert.ok(narrative.specialScenarios?.includes("接口复杂"));
  assert.ok(narrative.timelineAndCost?.includes("30"));
});

// ------------------------------------------------------------------
// DeliverableService
// ------------------------------------------------------------------

test("DeliverableService: generateAll + listByVersion", async () => {
  const svc = new DeliverableService(testDb);
  const versionId = randomUUID();

  const items = await svc.generateAll({
    assessmentVersionId: versionId,
    effortEstimate: [
      { module: "总账", days: 20, basis: "标准实施" },
      { module: "库存", days: 30, basis: "含接口开发" },
    ],
    riskTags: ["接口复杂"],
    phaseProposal: [
      { phase: "第一期", modules: ["总账"], estimatedDays: 20, milestone: "核心上线" },
      { phase: "第二期", modules: ["库存"], estimatedDays: 30, milestone: "全量上线" },
    ],
    varianceBaseline: "initial_estimate",
  });

  assert.equal(items.length, 4, "应生成 4 大交付物");
  const types = items.map((i) => i.deliverableType).sort();
  assert.deepEqual(types, ["effort_table", "resource_cost", "variance_analysis", "wbs"]);

  const list = await svc.listByVersion(versionId);
  assert.equal(list.length, 4);

  const effort = items.find((i) => i.deliverableType === "effort_table")!;
  assert.ok((effort.content as any).totalDays > 0);
});

test("DeliverableService: updateStatus", async () => {
  const svc = new DeliverableService(testDb);
  const [item] = await svc.generateAll({
    assessmentVersionId: randomUUID(),
    effortEstimate: [{ module: "总账", days: 10, basis: "" }],
  });

  const updated = await svc.updateStatus(item.deliverableId, "confirmed");
  assert.equal(updated?.status, "confirmed");
});

// ------------------------------------------------------------------
// QualityGateReviewService
// ------------------------------------------------------------------

test("QualityGateReviewService: create + findById", async () => {
  const svc = new QualityGateReviewService(testDb);

  const review = await svc.create({
    assessmentVersionId: randomUUID(),
    reviewerUserId: "pmo-01",
    checklist: { deliverablesComplete: true, narrativeComplete: true },
    verdict: "pass",
  });

  assert.ok(review.reviewId);
  assert.equal(review.verdict, "pass");

  const found = await svc.findById(review.reviewId);
  assert.ok(found);
});

test("QualityGateReviewService: autoReview pass", async () => {
  const svc = new QualityGateReviewService(testDb);

  const review = await svc.autoReview({
    assessmentVersionId: randomUUID(),
    reviewerUserId: "pmo-01",
    deliverables: [
      { deliverableType: "effort_table", status: "confirmed" },
      { deliverableType: "resource_cost", status: "confirmed" },
      { deliverableType: "variance_analysis", status: "confirmed" },
      { deliverableType: "wbs", status: "confirmed" },
    ],
    narrativeStatus: "confirmed",
    hasAssumptions: true,
  });

  assert.equal(review.verdict, "pass");
  assert.equal((review.checklist as any).deliverablesComplete, true);
});

test("QualityGateReviewService: autoReview reject when missing deliverables", async () => {
  const svc = new QualityGateReviewService(testDb);

  const review = await svc.autoReview({
    assessmentVersionId: randomUUID(),
    deliverables: [
      { deliverableType: "effort_table", status: "draft" },
    ],
    narrativeStatus: "draft",
    hasAssumptions: false,
  });

  assert.equal(review.verdict, "reject");
  const reasons = review.rejectionReasons as Array<{ field: string }>;
  assert.ok(reasons.some((r) => r.field === "deliverables"));
});

// ------------------------------------------------------------------
// SealedBaselineService
// ------------------------------------------------------------------

test("SealedBaselineService: seal + findByVersionId + supersede", async () => {
  const svc = new SealedBaselineService(testDb);
  const versionId = randomUUID();

  const sealed = await svc.seal({
    assessmentVersionId: versionId,
    sealedByUserId: "pmo-01",
    sealReason: "合同谈判完成",
  });

  assert.ok(sealed.sealedBaselineId);
  assert.equal(sealed.status, "sealed");

  const found = await svc.findByVersionId(versionId);
  assert.ok(found);
  assert.equal(found?.sealedBaselineId, sealed.sealedBaselineId);

  const superseded = await svc.supersede(sealed.sealedBaselineId);
  assert.equal(superseded?.status, "superseded");
});
