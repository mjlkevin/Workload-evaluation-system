import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadRagBaselineDataset } from "./rag-baseline-dataset";

test("the v1 dataset contains at least 20 valid, unique and sanitized samples", () => {
  const dataset = loadRagBaselineDataset(path.join(process.cwd(), "config/rag/baseline-samples.v1.json"));
  assert.equal(dataset.version, "rag-baseline-v1");
  assert.ok(dataset.samples.length >= 20);
  assert.equal(new Set(dataset.samples.map((item) => item.id)).size, dataset.samples.length);
  assert.match(dataset.fingerprint, /^[0-9a-f]{64}$/);
  for (const sample of dataset.samples) {
    assert.ok(sample.question.trim());
    assert.ok(
      (sample.expectedKeywords?.length || 0) > 0
      || (sample.expectedDocs?.length || 0) > 0
      || typeof sample.expectAnswer === "boolean",
    );
  }
  assert.doesNotMatch(JSON.stringify(dataset.samples), /api[_ -]?key|authorization|bearer\s+[a-z0-9]/i);
});

test("dataset loader rejects duplicate IDs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-rag-dataset-"));
  const file = path.join(dir, "duplicate.json");
  fs.writeFileSync(file, JSON.stringify({
    version: "duplicate",
    samples: Array.from({ length: 20 }, (_, index) => ({
      id: index < 2 ? "same" : `s-${index}`,
      question: `question ${index}`,
      expectAnswer: true,
    })),
  }));
  assert.throws(() => loadRagBaselineDataset(file), /duplicate_sample_id/);
  fs.rmSync(dir, { recursive: true, force: true });
});
