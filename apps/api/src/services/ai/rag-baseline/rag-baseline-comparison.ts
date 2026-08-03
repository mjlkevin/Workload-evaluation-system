import type { RagBaselineReport } from "./rag-baseline-runner";

export type RagComparisonDecision = "recommended" | "not_recommended";

export type RagBaselineComparison = {
  decision: RagComparisonDecision;
  reasons: string[];
  deltas: {
    keywordHitRate: number;
    docRecallRate: number;
    fallbackRate: number;
    p95LatencyRatio: number;
    avgTokensRatio: number;
  };
};

const EPSILON = 1e-9;

function ratio(candidate: number, baseline: number): number {
  if (baseline === 0) return candidate === 0 ? 1 : Number.POSITIVE_INFINITY;
  return candidate / baseline;
}

export function compareRagReports(
  baseline: RagBaselineReport,
  candidate: RagBaselineReport,
): RagBaselineComparison {
  const reasons: string[] = [];
  if (baseline.fingerprints.dataset !== candidate.fingerprints.dataset) reasons.push("dataset_fingerprint_mismatch");
  if (baseline.fingerprints.knowledge !== candidate.fingerprints.knowledge) reasons.push("knowledge_fingerprint_mismatch");
  if (baseline.fingerprints.scorer !== candidate.fingerprints.scorer) reasons.push("scorer_fingerprint_mismatch");
  if (baseline.sampleCount !== candidate.sampleCount) reasons.push("sample_count_mismatch");

  const keywordDelta = candidate.avgKeywordHitRate - baseline.avgKeywordHitRate;
  const docDelta = candidate.avgDocRecallRate - baseline.avgDocRecallRate;
  const primaryQualityDelta = Math.max(keywordDelta, docDelta);
  const secondaryQualityDelta = Math.min(keywordDelta, docDelta);
  const p95LatencyRatio = ratio(candidate.p95LatencyMs, baseline.p95LatencyMs);
  const avgTokensRatio = ratio(candidate.avgTokens, baseline.avgTokens);

  if (primaryQualityDelta + EPSILON < 0.05) reasons.push("quality_uplift_below_five_points");
  if (secondaryQualityDelta < -0.02 - EPSILON) reasons.push("secondary_quality_regression_exceeded");
  if (candidate.fallbackRate > baseline.fallbackRate + EPSILON) reasons.push("fallback_rate_increased");
  if (p95LatencyRatio > 1.2 + EPSILON) reasons.push("p95_latency_budget_exceeded");
  if (avgTokensRatio > 1.15 + EPSILON) reasons.push("token_budget_exceeded");

  return {
    decision: reasons.length ? "not_recommended" : "recommended",
    reasons,
    deltas: {
      keywordHitRate: keywordDelta,
      docRecallRate: docDelta,
      fallbackRate: candidate.fallbackRate - baseline.fallbackRate,
      p95LatencyRatio,
      avgTokensRatio,
    },
  };
}
