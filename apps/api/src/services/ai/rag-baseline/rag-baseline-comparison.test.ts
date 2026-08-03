import assert from "node:assert/strict";
import test from "node:test";

import type { RagBaselineReport } from "./rag-baseline-runner";
import { compareRagReports } from "./rag-baseline-comparison";

function report(overrides: Partial<RagBaselineReport> = {}): RagBaselineReport {
  return {
    sampleCount: 20,
    avgLatencyMs: 500,
    p95LatencyMs: 1000,
    avgKeywordHitRate: 0.7,
    avgDocRecallRate: 0.7,
    highConfidenceRate: 0.8,
    fallbackRate: 0.05,
    avgTokens: 100,
    answerableAccuracy: 0.8,
    fingerprints: {
      dataset: "a".repeat(64), knowledge: "b".repeat(64), config: "c".repeat(64),
      prompt: "d".repeat(64), scorer: "e".repeat(64),
    },
    results: [],
    ...overrides,
  };
}

test("recommends a candidate with a five-point quality uplift and bounded regressions", () => {
  const result = compareRagReports(report(), report({
    avgKeywordHitRate: 0.76,
    avgDocRecallRate: 0.69,
    p95LatencyMs: 1150,
    avgTokens: 110,
  }));
  assert.equal(result.decision, "recommended");
  assert.deepEqual(result.reasons, []);
});

test("rejects a candidate whose P95 latency exceeds the budget", () => {
  const result = compareRagReports(report(), report({ avgKeywordHitRate: 0.76, p95LatencyMs: 1250 }));
  assert.equal(result.decision, "not_recommended");
  assert.ok(result.reasons.includes("p95_latency_budget_exceeded"));
});

test("rejects a candidate whose average token use exceeds the budget", () => {
  const result = compareRagReports(report(), report({ avgKeywordHitRate: 0.76, avgTokens: 116 }));
  assert.equal(result.decision, "not_recommended");
  assert.ok(result.reasons.includes("token_budget_exceeded"));
});

test("requires the same dataset, knowledge snapshot and scorer", () => {
  const candidate = report({
    avgKeywordHitRate: 0.76,
    fingerprints: { ...report().fingerprints, dataset: "f".repeat(64) },
  });
  const result = compareRagReports(report(), candidate);
  assert.equal(result.decision, "not_recommended");
  assert.ok(result.reasons.includes("dataset_fingerprint_mismatch"));
});
