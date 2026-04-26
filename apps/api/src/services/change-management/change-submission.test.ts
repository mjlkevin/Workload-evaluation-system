// ============================================================
// ChangeSubmission Service 集成测试
// ============================================================
// 目标库：workload_eval_test
// 覆盖：提交变更 + AI diff + 合并到版本 + 反查 + 驳回

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { testDb, truncateTestTables } from "../../test-helpers/db";
import { ChangeSubmissionService } from "./change-submission";
import { OpportunityBriefService } from "../sales-briefing";
import { defaultProviderRegistry } from "../../ai/provider";
import type { ModelProvider, ChatCompletionResponse } from "../../ai/provider/model-provider";
import { assessmentVersions } from "../../db/schema";

before(async () => {
  await truncateTestTables();
});

test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE change_submissions, opportunity_briefs, assessment_versions RESTART IDENTITY CASCADE`,
  );
  defaultProviderRegistry.clear();
});

// ------------------------------------------------------------------
// Mock Provider helpers
// ------------------------------------------------------------------

function createMockKimiProvider(responseContent: string): ModelProvider {
  return {
    name: "kimi",
    defaultModel: "mock",
    isAvailable: () => true,
    async chatCompletion(): Promise<ChatCompletionResponse> {
      return {
        content: responseContent,
        rawContent: responseContent,
        model: "mock",
        provider: "kimi",
        attempts: 1,
      };
    },
  };
}

function createUnavailableKimiProvider(): ModelProvider {
  return {
    name: "kimi",
    defaultModel: "mock",
    isAvailable: () => false,
    async chatCompletion(): Promise<ChatCompletionResponse> {
      throw new Error("should not be called");
    },
  };
}

// ------------------------------------------------------------------
// 1. submitChange 成功路径（AI 返回有效 diff）
// ------------------------------------------------------------------

test("ChangeSubmissionService: submitChange 成功路径 — AI 解析出 diff", async () => {
  const mockProvider = createMockKimiProvider(
    JSON.stringify({
      diffResult: {
        added: [{ field: "extraModule", value: "报表定制" }],
        removed: [{ field: "legacyFeature", oldValue: "旧接口" }],
        modified: [{ field: "customerName", before: "A公司", after: "A集团" }],
      },
      newEstimate: { totalDays: 45 },
    }),
  );
  defaultProviderRegistry.register(mockProvider, { asDefault: true });

  const svc = new ChangeSubmissionService(testDb);

  // 先建父实体
  const briefSvc = new OpportunityBriefService(testDb);
  const brief = await briefSvc.create({
    customerName: "A公司",
    ownerUserId: "sales-01",
  });

  const submission = await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "客户升级成集团，增加报表定制，去掉旧接口",
    submittedByUserId: "sales-01",
  });

  assert.ok(submission.changeSubmissionId);
  assert.equal(submission.parentEntityType, "opportunity_brief");
  assert.equal(submission.status, "submitted");
  assert.equal(submission.changeDescription, "客户升级成集团，增加报表定制，去掉旧接口");

  const diff = submission.diffResult as {
    added: Array<{ field: string; value: string }>;
    removed: Array<{ field: string; oldValue: string }>;
    modified: Array<{ field: string; before: string; after: string }>;
  } | null;
  assert.ok(diff, "diffResult 应被解析出来");
  assert.equal(diff!.added.length, 1);
  assert.equal(diff!.added[0].field, "extraModule");
  assert.equal(diff!.removed.length, 1);
  assert.equal(diff!.modified.length, 1);
  assert.equal(diff!.modified[0].after, "A集团");

  const estimate = submission.newEstimate as { totalDays: number } | null;
  assert.ok(estimate);
  assert.equal(estimate!.totalDays, 45);
});

// ------------------------------------------------------------------
// 2. submitChange Kimi 失败降级
// ------------------------------------------------------------------

test("ChangeSubmissionService: submitChange Kimi 不可用降级为仅保存原文", async () => {
  const mockProvider = createUnavailableKimiProvider();
  defaultProviderRegistry.register(mockProvider, { asDefault: true });

  const svc = new ChangeSubmissionService(testDb);

  const briefSvc = new OpportunityBriefService(testDb);
  const brief = await briefSvc.create({
    customerName: "B公司",
    ownerUserId: "sales-02",
  });

  const submission = await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "增加一家子公司",
    submittedByUserId: "sales-02",
  });

  assert.equal(submission.changeDescription, "增加一家子公司");
  assert.equal(submission.diffResult, null, "Kimi 不可用时 diffResult 应为 null");
  assert.equal(submission.newEstimate, null);
  assert.equal(submission.status, "submitted");
});

// ------------------------------------------------------------------
// 3. computeDiff 三种字段变化
// ------------------------------------------------------------------

test("ChangeSubmissionService: computeDiff 覆盖 added / removed / modified", async () => {
  const svc = new ChangeSubmissionService(testDb);

  const before = {
    name: "原名称",
    moduleCount: 3,
    oldField: "即将删除",
  };

  const after = {
    name: "新名称",
    moduleCount: 3,
    newField: "新增字段",
  };

  const diff = svc.computeDiff(before, after);

  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].field, "newField");
  assert.equal(diff.added[0].value, "新增字段");

  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].field, "oldField");
  assert.equal(diff.removed[0].oldValue, "即将删除");

  assert.equal(diff.modified.length, 1);
  assert.equal(diff.modified[0].field, "name");
  assert.equal(diff.modified[0].before, "原名称");
  assert.equal(diff.modified[0].after, "新名称");
});

// ------------------------------------------------------------------
// 4. mergeToVersion 完整链路
// ------------------------------------------------------------------

test("ChangeSubmissionService: mergeToVersion 更新状态并写入版本 payload", async () => {
  const svc = new ChangeSubmissionService(testDb);

  // 先建版本
  const [version] = await testDb
    .insert(assessmentVersions)
    .values({
      assessmentVersionId: randomUUID(),
      versionCode: "V1.0-TEST-001",
      payload: { baseline: true },
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  const briefSvc = new OpportunityBriefService(testDb);
  const brief = await briefSvc.create({
    customerName: "C公司",
    ownerUserId: "sales-03",
  });

  const submission = await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "砍掉分析模块",
    submittedByUserId: "sales-03",
  });

  const merged = await svc.mergeToVersion(
    submission.changeSubmissionId,
    version.assessmentVersionId,
    "pm-01",
  );

  assert.ok(merged);
  assert.equal(merged!.status, "merged");
  assert.equal(merged!.mergedToVersionId, version.assessmentVersionId);
  assert.equal(merged!.reviewedByUserId, "pm-01");
  assert.ok(merged!.reviewedAt);

  // 验证版本 payload 被写入
  const [updatedVersion] = await testDb
    .select()
    .from(assessmentVersions)
    .where(eq(assessmentVersions.assessmentVersionId, version.assessmentVersionId));

  const payload = updatedVersion.payload as Record<string, unknown>;
  assert.ok(Array.isArray(payload.changeSubmissions), "payload 应包含 changeSubmissions 数组");
  const csList = payload.changeSubmissions as Array<Record<string, unknown>>;
  assert.equal(csList.length, 1);
  assert.equal(csList[0].changeSubmissionId, submission.changeSubmissionId);
  assert.equal(csList[0].mergedByUserId, "pm-01");
});

// ------------------------------------------------------------------
// 5. listByParent 反查
// ------------------------------------------------------------------

test("ChangeSubmissionService: listByParent 反查", async () => {
  const svc = new ChangeSubmissionService(testDb);

  const briefSvc = new OpportunityBriefService(testDb);
  const briefA = await briefSvc.create({ customerName: "A", ownerUserId: "s1" });
  const briefB = await briefSvc.create({ customerName: "B", ownerUserId: "s1" });

  await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: briefA.opportunityBriefId,
    changeDescription: "改1",
    submittedByUserId: "s1",
  });

  await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: briefA.opportunityBriefId,
    changeDescription: "改2",
    submittedByUserId: "s1",
  });

  await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: briefB.opportunityBriefId,
    changeDescription: "改3",
    submittedByUserId: "s1",
  });

  const listA = await svc.listByParent("opportunity_brief", briefA.opportunityBriefId);
  assert.equal(listA.length, 2);
  assert.ok(listA[0].submittedAt >= listA[1].submittedAt, "按 submittedAt 降序");

  const listB = await svc.listByParent("opportunity_brief", briefB.opportunityBriefId);
  assert.equal(listB.length, 1);
  assert.equal(listB[0].changeDescription, "改3");
});

// ------------------------------------------------------------------
// 6. reject 状态机
// ------------------------------------------------------------------

test("ChangeSubmissionService: reject 状态流转", async () => {
  const svc = new ChangeSubmissionService(testDb);

  const briefSvc = new OpportunityBriefService(testDb);
  const brief = await briefSvc.create({ customerName: "D公司", ownerUserId: "s1" });

  const submission = await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "不合理的变更",
    submittedByUserId: "s1",
  });

  assert.equal(submission.status, "submitted");

  const rejected = await svc.reject(submission.changeSubmissionId, { reviewedByUserId: "pmo-01" });
  assert.ok(rejected);
  assert.equal(rejected!.status, "rejected");
  assert.equal(rejected!.reviewedByUserId, "pmo-01");
  assert.ok(rejected!.reviewedAt);

  // 重复 reject 应同样成功（幂等）
  const rejected2 = await svc.reject(submission.changeSubmissionId, { reviewedByUserId: "pmo-02" });
  assert.ok(rejected2);
  assert.equal(rejected2!.status, "rejected");
  assert.equal(rejected2!.reviewedByUserId, "pmo-02");
});

// ------------------------------------------------------------------
// 7. findById / listBySubmitter 补充
// ------------------------------------------------------------------

test("ChangeSubmissionService: findById 存在与不存在", async () => {
  const svc = new ChangeSubmissionService(testDb);

  const briefSvc = new OpportunityBriefService(testDb);
  const brief = await briefSvc.create({ customerName: "E公司", ownerUserId: "s1" });
  const submission = await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "测试查找",
    submittedByUserId: "s1",
  });

  const found = await svc.findById(submission.changeSubmissionId);
  assert.ok(found);
  assert.equal(found!.changeDescription, "测试查找");

  const notFound = await svc.findById(randomUUID());
  assert.equal(notFound, null);
});

test("ChangeSubmissionService: listBySubmitter 按提交人过滤", async () => {
  const svc = new ChangeSubmissionService(testDb);

  const briefSvc = new OpportunityBriefService(testDb);
  const brief = await briefSvc.create({ customerName: "F公司", ownerUserId: "s1" });

  await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "s1 的变更",
    submittedByUserId: "s1",
  });

  await svc.submitChange({
    parentEntityType: "opportunity_brief",
    parentEntityId: brief.opportunityBriefId,
    changeDescription: "s2 的变更",
    submittedByUserId: "s2",
  });

  const listS1 = await svc.listBySubmitter("s1");
  assert.equal(listS1.length, 1);
  assert.equal(listS1[0].submittedByUserId, "s1");

  const listS2 = await svc.listBySubmitter("s2");
  assert.equal(listS2.length, 1);
  assert.equal(listS2[0].submittedByUserId, "s2");
});
