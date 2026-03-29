import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { CalculateRequest, RuleSet, Template } from "../types";
import { loadJsonFile, ensureExportDir } from "../utils/file";
import { calculateAndExportEstimate, calculateEstimateOnly } from "./estimates/estimates.usecase";
import { setIdempotencyRecord, deleteIdempotencyRecord } from "./estimates/estimates.repository";
import { resolveDownloadFile } from "./exports/exports.usecase";
import { calculateBySession, startEstimateSession } from "./sessions/sessions.usecase";

function loadContext(): { template: Template; ruleSet: RuleSet } {
  return {
    template: loadJsonFile<Template>("config/templates/example-template.json"),
    ruleSet: loadJsonFile<RuleSet>("config/rules/example-rule-set.json")
  };
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

test("estimates.usecase: calculateEstimateOnly returns success for valid request", () => {
  const body = buildValidCalculateRequest();
  const result = calculateEstimateOnly(body);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(typeof result.data.totalDays, "number");
  }
});

test("estimates.usecase: calculateAndExportEstimate returns idempotency replay", async () => {
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

test("sessions.usecase: startEstimateSession and calculateBySession succeed", () => {
  const body = buildValidCalculateRequest();
  const ownerUserId = "ut-user";

  const started = startEstimateSession(ownerUserId, {
    templateId: body.templateId,
    ruleSetId: body.ruleSetId
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const calc = calculateBySession(ownerUserId, started.data.sessionId, {
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

test("sessions.usecase: calculateBySession blocks cross user access", () => {
  const body = buildValidCalculateRequest();
  const started = startEstimateSession("owner-A", {
    templateId: body.templateId,
    ruleSetId: body.ruleSetId
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const calc = calculateBySession("owner-B", started.data.sessionId, {
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
