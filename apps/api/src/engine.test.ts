import test from "node:test";
import assert from "node:assert/strict";
import { calculateEstimate, validateCalculateRequest, type CalculateRequest, type RuleSet, type Template } from "./engine";

const template: Template = {
  templateId: "tmpl-1",
  templateVersion: "v1",
  templateName: "demo",
  groups: [
    { groupId: "g1", groupName: "财务云" },
    { groupId: "g2", groupName: "供应链云" }
  ],
  items: [
    { templateItemId: "i1", groupId: "g1", itemName: "凭证管理", standardDays: 8 },
    { templateItemId: "i2", groupId: "g2", itemName: "库存管理", standardDays: 2 }
  ]
};

const ruleSet: RuleSet = {
  ruleSetId: "rule-1",
  ruleVersion: "v1",
  pipelineVersion: "p1",
  pipeline: ["grouping", "itemRule", "baseRule", "orgIncrementRule"],
  baseRule: {
    userCountTiers: [
      { min: 0, max: 50, factor: 0 },
      { min: 51, max: 70, factor: 0.05 }
    ],
    difficultyFactorList: [0, 0.1, 0.2],
    userIncrementRounding: "ceil_int"
  },
  orgIncrementRule: {
    enabled: true,
    factor: 0.1
  }
};

const validBody: CalculateRequest = {
  templateId: "tmpl-1",
  ruleSetId: "rule-1",
  userCount: 51,
  difficultyFactor: 0.1,
  orgCount: 2,
  orgSimilarityFactor: 0.6,
  items: [
    { templateItemId: "i1", included: true },
    { templateItemId: "i2", included: true }
  ]
};

test("validate passes on complete body", () => {
  const result = validateCalculateRequest(validBody, template, ruleSet);
  assert.deepEqual(result, { ok: true });
});

test("validate fails for missing items", () => {
  const result = validateCalculateRequest(
    {
      ...validBody,
      items: [{ templateItemId: "i1", included: true }]
    },
    template,
    ruleSet
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 42201);
    assert.match(result.details[0].reason, /missing_item_ids/);
  }
});

test("calculate applies ceil rounding for user increment", () => {
  const result = calculateEstimate(validBody, template, ruleSet);
  // baseDays=10, tier=0.05 => 0.5 => ceil -> 1
  assert.equal(result.baseDays, 10);
  assert.equal(result.userIncrementDays, 1);
});

test("calculate applies difficulty and organization increment", () => {
  const result = calculateEstimate(validBody, template, ruleSet);
  // difficulty = 10 * 0.1 = 1
  assert.equal(result.difficultyIncrementDays, 1);
  // org = 10 * (2-1) * (1-0.6) * 0.1 = 0.4
  assert.equal(result.orgIncrementDays, 0.4);
  assert.equal(result.totalDays, 12.4);
});

test("group subtotals are split by group", () => {
  const result = calculateEstimate(validBody, template, ruleSet);
  const g1 = result.groupSubtotals.find((x) => x.groupId === "g1");
  const g2 = result.groupSubtotals.find((x) => x.groupId === "g2");
  assert.equal(g1?.subtotalDays, 8);
  assert.equal(g2?.subtotalDays, 2);
});

test("pipeline can disable base and org increments", () => {
  const pipelineRuleSet: RuleSet = {
    ...ruleSet,
    pipeline: ["grouping", "itemRule"]
  };
  const result = calculateEstimate(validBody, template, pipelineRuleSet);
  assert.equal(result.baseDays, 10);
  assert.equal(result.userIncrementDays, 0);
  assert.equal(result.difficultyIncrementDays, 0);
  assert.equal(result.orgIncrementDays, 0);
  assert.equal(result.totalDays, 10);
});
