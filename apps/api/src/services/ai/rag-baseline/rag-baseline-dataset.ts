import { createHash } from "node:crypto";
import fs from "node:fs";

import type { RagBaselineSample } from "./rag-baseline-runner";

export type RagBaselineDataset = {
  version: string;
  description?: string;
  samples: RagBaselineSample[];
  fingerprint: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input.map((item) => String(item).trim()).filter(Boolean);
  return values.length ? values : undefined;
}

export function loadRagBaselineDataset(filePath: string): RagBaselineDataset {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    version?: unknown;
    description?: unknown;
    samples?: unknown;
  };
  const version = String(parsed.version || "").trim();
  if (!version) throw new Error("dataset_version_required");
  if (!Array.isArray(parsed.samples) || parsed.samples.length < 20) {
    throw new Error("dataset_requires_at_least_20_samples");
  }
  const ids = new Set<string>();
  const samples = parsed.samples.map((raw, index) => {
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = String(source.id || "").trim();
    const question = String(source.question || "").trim();
    if (!id) throw new Error(`sample_id_required:${index}`);
    if (ids.has(id)) throw new Error(`duplicate_sample_id:${id}`);
    ids.add(id);
    if (!question) throw new Error(`sample_question_required:${id}`);
    const expectedKeywords = cleanStringArray(source.expectedKeywords);
    const expectedDocs = cleanStringArray(source.expectedDocs);
    const hasExpectation = Boolean(expectedKeywords?.length || expectedDocs?.length)
      || typeof source.expectAnswer === "boolean";
    if (!hasExpectation) throw new Error(`sample_expectation_required:${id}`);
    return {
      id,
      question,
      ...(expectedKeywords ? { expectedKeywords } : {}),
      ...(expectedDocs ? { expectedDocs } : {}),
      ...(typeof source.expectAnswer === "boolean" ? { expectAnswer: source.expectAnswer } : {}),
    } satisfies RagBaselineSample;
  });
  const description = String(parsed.description || "").trim();
  const canonical = JSON.stringify({ version, samples });
  return {
    version,
    ...(description ? { description } : {}),
    samples,
    fingerprint: sha256(canonical),
  };
}
