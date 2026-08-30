import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { CalculateRequest, RuleSet, Template } from "../types";
import { ensureExportDir, resolveRootDir } from "../utils/file";
import {
  cleanupSingleDocStoreFixture,
  seedSingleDocStoreFixture,
  type SingleDocStoreSeed,
} from "../test-helpers/single-doc-store-seed";
import { calculateAndExportEstimate, calculateEstimateOnly } from "./estimates/estimates.usecase";
import { setIdempotencyRecord, deleteIdempotencyRecord } from "./estimates/estimates.repository";
import { resolveDownloadFile } from "./exports/exports.usecase";
import { calculateBySession, startEstimateSession } from "./sessions/sessions.usecase";
import {
  addTeamMember,
  createReview,
  createReviewComment,
  createTeam,
  getTeamPlans,
  updateReviewStatus
} from "./team/team.usecase";
import { loadVersionsStore, saveVersionsStore } from "./versions/versions.repository";
import { _resetTeamRepositoryForTest } from "./team/team.repository";

/**
 * C10（2026-08-25）→ 阶段 2 S6（2026-08-29）：estimates/sessions 用例的请求
 * 构造与被测路径必须同源。原形态是「delete 两个开关强制选择器走 JSON 实现
 * + 直读 JSON fixture」；S6 删除两域 JSON 读写路径后选择器恒 PG，该隔离法失效。
 *
 * 现形态：before 把 seed 源 fixture 内容经 PG 仓储种入（单文档表读语义是
 * 「最近写入行」，用例期间本文件是唯一写入者——已在 test:modules:serial-store
 * 串行套件内），用例用种入后的文档构造请求；after 按前缀条件清理（§4.6/C5）。
 * 无 DB 环境（未设 TEST_DATABASE_URL）：相关用例按 §4.6/C4 诚实 skip。
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const STORE_PREFIX = "wes-t-uc-";
let seed: SingleDocStoreSeed | null = null;

before(async () => {
  if (!testDatabaseUrl) return;
  seed = await seedSingleDocStoreFixture(STORE_PREFIX);
});

after(async () => {
  if (!seed) return;
  await cleanupSingleDocStoreFixture(seed.prefix);
  seed = null;
});

function loadContext(): { template: Template; ruleSet: RuleSet } {
  if (!seed) {
    throw new Error("单文档表种子未就绪（TEST_DATABASE_URL 缺失时相关用例应已 skip）");
  }
  return { template: seed.template, ruleSet: seed.ruleSet };
}

function buildValidCalculateRequest(): CalculateRequest {
  const { template, ruleSet } = loadContext();
  return {
    templateId: template.templateId,
    ruleSetId: ruleSet.ruleSetId,
    userCount: 51,
    difficultyFactor: 0.1,
    orgCount: 2,
    orgSimilarityFactor: 0.6,
    items: template.items.map((item, index) => ({
      templateItemId: item.templateItemId,
      included: index === 0
    }))
  };
}

function buildCalculateRequestWithIncludedItems(includedIds: string[]): CalculateRequest {
  const { template, ruleSet } = loadContext();
  const included = new Set(includedIds);
  return {
    templateId: template.templateId,
    ruleSetId: ruleSet.ruleSetId,
    userCount: 51,
    difficultyFactor: 0.1,
    orgCount: 2,
    orgSimilarityFactor: 0.6,
    items: template.items.map((item) => ({
      templateItemId: item.templateItemId,
      included: included.has(item.templateItemId),
    }))
  };
}

test(
  "estimates.usecase: calculateEstimateOnly returns success for valid request",
  { skip: !testDatabaseUrl },
  async () => {
  // 阶段 1 批 5：calculateEstimateOnly 已异步化，补 await（断言不变）。
  const body = buildValidCalculateRequest();
  const result = await calculateEstimateOnly(body);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(typeof result.data.totalDays, "number");
  }
});

test(
  "estimates.usecase: dependency check only triggers when the dependent module is selected",
  { skip: !testDatabaseUrl },
  async () => {
  const { template } = loadContext();
  for (const itemId of ["item-66", "item-72", "item-73"]) {
    assert.ok(
      template.items.some((item) => item.templateItemId === itemId),
      `种子模板必须含 ${itemId}（缺失则本用例三组请求全空跑）`,
    );
  }

  // 阶段 1 批 5：calculateEstimateOnly 已异步化，补 await（断言不变）。
  const purchaseOnly = await calculateEstimateOnly(buildCalculateRequestWithIncludedItems(["item-66"]));
  // S6（A-3 加固）：原写法把断言整体包在 if (!purchaseOnly.ok) 里，成功时零断言
  // ——用例退化成「跑通即绿」。改为无条件形态：ok 时 flagged=false，不 ok 时
  // 看 details 里有没有滚动采购管理，两条路径都真断言。
  const purchaseOnlyFlagged = purchaseOnly.ok
    ? false
    : (purchaseOnly.details ?? []).some((detail) => detail.reason.includes("滚动采购管理"));
  assert.equal(purchaseOnlyFlagged, false, "普通采购管理不应触发滚动采购管理依赖");

  const rollingPurchaseWithoutVmi = await calculateEstimateOnly(buildCalculateRequestWithIncludedItems(["item-73"]));
  assert.equal(rollingPurchaseWithoutVmi.ok, false);
  if (!rollingPurchaseWithoutVmi.ok) {
    assert.ok(rollingPurchaseWithoutVmi.details?.some((detail) => /滚动采购管理/.test(detail.reason)));
  }

  const rollingPurchaseWithVmi = await calculateEstimateOnly(buildCalculateRequestWithIncludedItems(["item-72", "item-73"]));
  assert.equal(rollingPurchaseWithVmi.ok, true);
});

test(
  "estimates.usecase: calculateAndExportEstimate returns idempotency replay",
  { skip: !testDatabaseUrl },
  async () => {
  const body = buildValidCalculateRequest();
  const ownerUserId = "ut-owner";
  const idempotencyKey = `ut-idem-${Date.now()}`;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ ...body, exportType: "excel" }))
    .digest("hex");
  const replayData = {
    totalDays: 12.3,
    downloadUrl: "/downloads/ut-owner__x+V00+01.xlsx",
    expireAt: new Date(Date.now() + 1000).toISOString()
  };

  setIdempotencyRecord(idempotencyKey, {
    ownerUserId,
    payloadHash,
    data: replayData,
    requestId: "rid-replay",
    createdAt: Date.now()
  });

  try {
    const result = await calculateAndExportEstimate(body, ownerUserId, idempotencyKey);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.data, replayData);
      assert.equal(result.requestId, "rid-replay");
    }
  } finally {
    deleteIdempotencyRecord(idempotencyKey);
  }
});

test(
  "sessions.usecase: startEstimateSession and calculateBySession succeed",
  { skip: !testDatabaseUrl },
  async () => {
  const body = buildValidCalculateRequest();
  const ownerUserId = "ut-user";

  const started = await startEstimateSession(ownerUserId, {
    templateId: body.templateId,
    ruleSetId: body.ruleSetId
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const calc = await calculateBySession(ownerUserId, started.data.sessionId, {
    userCount: body.userCount,
    difficultyFactor: body.difficultyFactor,
    orgCount: body.orgCount,
    orgSimilarityFactor: body.orgSimilarityFactor,
    items: body.items
  });
  assert.equal(calc.ok, true);
  if (calc.ok) {
    assert.equal(calc.data.sessionId, started.data.sessionId);
    assert.equal(typeof calc.data.totalDays, "number");
  }
});

test(
  "sessions.usecase: calculateBySession blocks cross user access",
  { skip: !testDatabaseUrl },
  async () => {
  const body = buildValidCalculateRequest();
  const started = await startEstimateSession("owner-A", {
    templateId: body.templateId,
    ruleSetId: body.ruleSetId
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const calc = await calculateBySession("owner-B", started.data.sessionId, {
    userCount: body.userCount,
    difficultyFactor: body.difficultyFactor,
    orgCount: body.orgCount,
    orgSimilarityFactor: body.orgSimilarityFactor,
    items: body.items
  });
  assert.equal(calc.ok, false);
  if (!calc.ok) {
    assert.equal(calc.code, 40301);
  }
});

test("exports.usecase: resolveDownloadFile returns owned file and 404 when missing", () => {
  const exportDir = ensureExportDir();
  const ownedFileName = "ut-user__演示项目+V01+01.xlsx";
  const fullPath = path.resolve(exportDir, ownedFileName);
  fs.writeFileSync(fullPath, "demo", "utf-8");

  try {
    const okResult = resolveDownloadFile(ownedFileName, "ut-user");
    assert.equal(okResult.ok, true);
    if (okResult.ok) {
      assert.equal(okResult.data.rawFileName, "演示项目+V01+01.xlsx");
      assert.equal(okResult.data.filePath, fullPath);
    }

    const forbidden = resolveDownloadFile(ownedFileName, "other-user");
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) {
      assert.equal(forbidden.code, 40301);
    }

    fs.unlinkSync(fullPath);
    const missing = resolveDownloadFile(ownedFileName, "ut-user");
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.code, 40401);
    }
  } finally {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
});

// 阶段 1 批 4：支持 async 回调（versions accessor 异步化级联），同步回调仍可传入
// C10（2026-08-25）：team 用例以 store.json 文件快照断言（backup/unlink/restore），
// 开关全开（PG）时选择器走 PG 共享测试库，文件级并行下会被其他文件的整表清理
// 干扰（实测 flaky：createReview 40401）——这里显式隔离到 JSON 实现 + 文件快照，
// 与全局开关无关。
async function withTeamStoreIsolation(fn: () => Promise<void> | void): Promise<void> {
  const previousPgFlag = process.env.WES_STORE_TEAMS_PG;
  delete process.env.WES_STORE_TEAMS_PG;
  _resetTeamRepositoryForTest();
  const root = resolveRootDir();
  const storePath = path.resolve(root, "config/teams/store.json");
  const backupPath = `${storePath}.ut.bak`;
  const existed = fs.existsSync(storePath);
  if (existed) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(storePath, backupPath);
  }
  try {
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    await fn();
  } finally {
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    if (existed && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, storePath);
      fs.unlinkSync(backupPath);
    }
    if (previousPgFlag === undefined) delete process.env.WES_STORE_TEAMS_PG;
    else process.env.WES_STORE_TEAMS_PG = previousPgFlag;
    _resetTeamRepositoryForTest();
  }
}

test("team.usecase: manager can add member and create review/comment", async () => {
  await withTeamStoreIsolation(async () => {
    const manager = { id: "team-manager-ut" };
    const member = { id: "team-member-ut" };
    const created = await createTeam(manager, { name: "UT Team" });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const add = await addTeamMember(manager, created.data.teamId, { userId: member.id, role: "implementer" });
    assert.equal(add.ok, true);

    const review = await createReview(member, created.data.teamId, { globalVersionCode: "GL-UT-01", title: "UT Review" });
    assert.equal(review.ok, true);
    if (!review.ok) return;

    const comment = await createReviewComment(member, created.data.teamId, review.data.reviewId, { content: "looks good" });
    assert.equal(comment.ok, true);
  });
});

test("team.usecase: non-manager cannot close review", async () => {
  await withTeamStoreIsolation(async () => {
    const manager = { id: "team-manager-ut-2" };
    const member = { id: "team-member-ut-2" };
    const created = await createTeam(manager, { name: "UT Team 2" });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const add = await addTeamMember(manager, created.data.teamId, { userId: member.id, role: "sales" });
    assert.equal(add.ok, true);

    const review = await createReview(manager, created.data.teamId, { globalVersionCode: "GL-UT-02" });
    assert.equal(review.ok, true);
    if (!review.ok) return;

    const closeByMember = await updateReviewStatus(member, created.data.teamId, review.data.reviewId, { status: "closed" });
    assert.equal(closeByMember.ok, false);
    if (!closeByMember.ok) {
      assert.equal(closeByMember.error.code, 40301);
    }
  });
});

test("team.usecase: team plan visibility blocks cross-team user", async () => {
  await withTeamStoreIsolation(async () => {
    const store = await loadVersionsStore();
    const snapshot = JSON.parse(JSON.stringify(store));
    const ownerA = "team-owner-a-ut";
    const ownerB = "team-owner-b-ut";
    const now = new Date().toISOString();
    store.records.push({
      id: "ver-ut-gl-1",
      type: "global",
      versionCode: "GL-UT-03",
      templateId: "default",
      ownerUserId: ownerA,
      status: "draft",
      payload: { projectName: "UT Project" },
      createdAt: now,
      updatedAt: now,
      createdByUserId: ownerA,
      createdByUsername: "ownerA",
      updatedByUserId: ownerA,
      updatedByUsername: "ownerA",
      checkoutStatus: "checked_in",
      versionDocStatus: "drafting",
      majorLetter: "A",
      minorNumber: 0,
      baseCode: "GL-UT-03",
      isHistoricalArchive: false
    });
    await saveVersionsStore(store);

    try {
      const team = await createTeam({ id: ownerA }, { name: "Owner A Team" });
      assert.equal(team.ok, true);
      if (!team.ok) return;

      const denied = await getTeamPlans({ id: ownerB }, team.data.teamId);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.error.code, 40301);
    } finally {
      await saveVersionsStore(snapshot);
    }
  });
});
