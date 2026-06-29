import type {
  HarnessRequirementReportV1Content,
  HarnessRequirementReportV2Content,
} from "./harness.types";

export const HARNESS_REGRESSION_SAMPLE_VERSION = "harness-regression-sample.v1" as const;
export const HARNESS_REGRESSION_EXPECTED_VERSION = "harness-regression-expected.v1" as const;
export const HARNESS_REGRESSION_SCORE_TYPE = "requirement_match_v1" as const;

export type HarnessRegressionSampleType = "requirement_report_v1" | "requirement_report_v2";

export type HarnessRegressionExpectedRequirement = {
  domain?: string;
  scenario?: string;
  moduleHint?: string;
  evidenceRefs?: string[];
};

export type HarnessRegressionExpected = {
  version: typeof HARNESS_REGRESSION_EXPECTED_VERSION;
  threshold: number;
  project?: {
    projectName?: string;
    customerName?: string;
    industry?: string;
  };
  requirementFindings: HarnessRegressionExpectedRequirement[];
};

export type HarnessRegressionSample = {
  version: typeof HARNESS_REGRESSION_SAMPLE_VERSION;
  caseKey: string;
  title: string;
  sampleType: HarnessRegressionSampleType;
  fileRefs: string[];
  active: boolean;
  metadata: Record<string, unknown>;
  expected: HarnessRegressionExpected;
};

export type HarnessRegressionSampleInput = {
  caseKey?: unknown;
  title?: unknown;
  sampleType?: unknown;
  fileRefs?: unknown;
  active?: unknown;
  metadata?: unknown;
  expected?: {
    threshold?: unknown;
    project?: unknown;
    requirementFindings?: unknown;
  };
};

export type HarnessRegressionScore = {
  scoreType: typeof HARNESS_REGRESSION_SCORE_TYPE;
  value: number;
  passed: boolean;
  threshold: number;
  details: {
    project: {
      expectedFields: number;
      matchedFields: number;
      score: number;
    };
    requirements: {
      expectedCount: number;
      matchedCount: number;
      coverage: number;
      matches: Array<{ expectedIndex: number; actualIndex: number; score: number }>;
      unmatched: Array<{ expectedIndex: number; expected: HarnessRegressionExpectedRequirement }>;
    };
    evidence: {
      expectedRefs: string[];
      matchedRefs: string[];
      coverage: number;
    };
    weights: {
      project: number;
      requirements: number;
      evidence: number;
    };
  };
};

type HarnessRegressionReport = HarnessRequirementReportV1Content | HarnessRequirementReportV2Content;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return asText(value).replace(/\s+/g, " ").toLowerCase();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}

function normalizeThreshold(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.8;
}

function normalizeSampleType(value: unknown): HarnessRegressionSampleType {
  return value === "requirement_report_v1" ? "requirement_report_v1" : "requirement_report_v2";
}

function normalizeRequirement(value: unknown): HarnessRegressionExpectedRequirement {
  const record = asRecord(value);
  return {
    domain: asText(record.domain) || undefined,
    scenario: asText(record.scenario) || undefined,
    moduleHint: asText(record.moduleHint) || undefined,
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function normalizeProject(value: unknown): HarnessRegressionExpected["project"] {
  const record = asRecord(value);
  const project = {
    projectName: asText(record.projectName) || undefined,
    customerName: asText(record.customerName) || undefined,
    industry: asText(record.industry) || undefined,
  };
  return Object.values(project).some(Boolean) ? project : undefined;
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}

function fieldMatches(expected: unknown, actual: unknown): boolean {
  const expectedText = normalizeText(expected);
  const actualText = normalizeText(actual);
  if (!expectedText) return true;
  if (!actualText) return false;
  return actualText === expectedText || actualText.includes(expectedText) || expectedText.includes(actualText);
}

export function normalizeHarnessRegressionSample(input: HarnessRegressionSampleInput): HarnessRegressionSample {
  const expected = input.expected ?? {};
  const caseKey = asText(input.caseKey) || "unnamed-regression-case";
  const requirementFindings = Array.isArray(expected.requirementFindings)
    ? expected.requirementFindings.map(normalizeRequirement)
    : [];

  return {
    version: HARNESS_REGRESSION_SAMPLE_VERSION,
    caseKey,
    title: asText(input.title) || caseKey,
    sampleType: normalizeSampleType(input.sampleType),
    fileRefs: asStringArray(input.fileRefs),
    active: typeof input.active === "boolean" ? input.active : true,
    metadata: asRecord(input.metadata),
    expected: {
      version: HARNESS_REGRESSION_EXPECTED_VERSION,
      threshold: normalizeThreshold(expected.threshold),
      project: normalizeProject(expected.project),
      requirementFindings,
    },
  };
}

function scoreProject(report: HarnessRegressionReport, expected: HarnessRegressionExpected["project"]) {
  const expectedEntries = Object.entries(expected ?? {}).filter(([, value]) => Boolean(value));
  const matchedFields = expectedEntries.filter(([key, value]) =>
    fieldMatches(value, report.project[key as keyof HarnessRegressionReport["project"]])).length;
  const expectedFields = expectedEntries.length;
  return {
    expectedFields,
    matchedFields,
    score: expectedFields === 0 ? 1 : roundScore(matchedFields / expectedFields),
  };
}

function scoreRequirement(expected: HarnessRegressionExpectedRequirement, actual: HarnessRegressionReport["requirementFindings"][number]): number {
  const expectedFields = [
    ["domain", expected.domain],
    ["scenario", expected.scenario],
    ["moduleHint", expected.moduleHint],
  ].filter(([, value]) => Boolean(value)) as Array<["domain" | "scenario" | "moduleHint", string]>;
  if (expectedFields.length === 0) return 0;
  const matchedFields = expectedFields.filter(([key, value]) => fieldMatches(value, actual[key])).length;
  return roundScore(matchedFields / expectedFields.length);
}

function scoreRequirements(report: HarnessRegressionReport, expectedRequirements: HarnessRegressionExpectedRequirement[]) {
  const matches: Array<{ expectedIndex: number; actualIndex: number; score: number }> = [];
  const unmatched: Array<{ expectedIndex: number; expected: HarnessRegressionExpectedRequirement }> = [];

  expectedRequirements.forEach((expected, expectedIndex) => {
    const best = report.requirementFindings.reduce((current, actual, actualIndex) => {
      const score = scoreRequirement(expected, actual);
      return score > current.score ? { actualIndex, score } : current;
    }, { actualIndex: -1, score: 0 });

    if (best.score === 1) matches.push({ expectedIndex, actualIndex: best.actualIndex, score: best.score });
    else unmatched.push({ expectedIndex, expected });
  });

  return {
    expectedCount: expectedRequirements.length,
    matchedCount: matches.length,
    coverage: expectedRequirements.length === 0 ? 1 : roundScore(matches.length / expectedRequirements.length),
    matches,
    unmatched,
  };
}

function collectEvidenceRefsFromReport(report: HarnessRegressionReport): Set<string> {
  return new Set(report.requirementFindings.flatMap((finding) => finding.evidenceRefs.map(normalizeText)).filter(Boolean));
}

function scoreEvidence(report: HarnessRegressionReport, expectedRequirements: HarnessRegressionExpectedRequirement[]) {
  const expectedRefs = expectedRequirements.flatMap((item) => item.evidenceRefs ?? []).filter(Boolean);
  const actualRefs = collectEvidenceRefsFromReport(report);
  const matchedRefs = expectedRefs.filter((ref) => actualRefs.has(normalizeText(ref)));
  return {
    expectedRefs,
    matchedRefs,
    coverage: expectedRefs.length === 0 ? 1 : roundScore(matchedRefs.length / expectedRefs.length),
  };
}

export function scoreHarnessRegressionReport(
  report: HarnessRegressionReport,
  expected: HarnessRegressionExpected,
): HarnessRegressionScore {
  const project = scoreProject(report, expected.project);
  const requirements = scoreRequirements(report, expected.requirementFindings);
  const evidence = scoreEvidence(report, expected.requirementFindings);
  const weights = {
    project: project.expectedFields > 0 ? 0.3 : 0,
    requirements: requirements.expectedCount > 0 ? 0.5 : 0,
    evidence: evidence.expectedRefs.length > 0 ? 0.2 : 0,
  };
  const totalWeight = weights.project + weights.requirements + weights.evidence || 1;
  const value = roundScore((
    project.score * weights.project +
    requirements.coverage * weights.requirements +
    evidence.coverage * weights.evidence
  ) / totalWeight);

  return {
    scoreType: HARNESS_REGRESSION_SCORE_TYPE,
    value,
    passed: value >= expected.threshold,
    threshold: expected.threshold,
    details: {
      project,
      requirements,
      evidence,
      weights,
    },
  };
}

export const DEFAULT_HARNESS_REGRESSION_SAMPLES: HarnessRegressionSample[] = [
  normalizeHarnessRegressionSample({
    caseKey: "manufacturing-procurement-mvp",
    title: "制造业采购闭环 MVP",
    sampleType: "requirement_report_v2",
    fileRefs: ["fixtures/harness/blueocean-procurement-requirements.xlsx"],
    metadata: {
      industry: "manufacturing",
      phase: "Phase 1H-B",
      owner: "Harness Regression",
    },
    expected: {
      threshold: 0.8,
      project: {
        projectName: "蓝海采购协同",
        customerName: "蓝海制造",
        industry: "制造业",
      },
      requirementFindings: [
        {
          domain: "供应链",
          scenario: "采购到入库闭环",
          moduleHint: "供应链云",
          evidenceRefs: ["需求清单!B12"],
        },
        {
          domain: "财务核算",
          scenario: "自动生成采购凭证",
          moduleHint: "总账",
          evidenceRefs: ["需求清单!B14"],
        },
      ],
    },
  }),
];
