import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { saveRagBaselineArtifact } from "./rag-baseline-report.repository";

test("writes a sanitized report only inside the ignored runtime report directory", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wes-rag-report-"));
  const artifact = {
    kind: "baseline",
    apiKey: "unit-secret-value",
    authorization: "Bearer unit-secret-token",
    accessToken: "another-unit-secret",
    avgTokens: 321.5,
    nested: {
      answer: "safe",
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    },
  };
  const file = saveRagBaselineArtifact(artifact, {
    projectRoot,
    datasetVersion: "rag-baseline-v1",
    now: new Date("2026-08-02T12:34:56.000Z"),
  });
  assert.equal(path.dirname(file), path.join(projectRoot, "data", "rag-baseline-reports"));
  assert.match(path.basename(file), /^rag-baseline-v1-20260802T123456000Z\.json$/);
  const serialized = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(serialized, /apiKey|authorization|accessToken|unit-secret/i);
  assert.match(serialized, /"answer": "safe"/);
  assert.match(serialized, /"avgTokens": 321\.5/);
  assert.match(serialized, /"promptTokens": 200/);
  assert.match(serialized, /"completionTokens": 100/);
  assert.match(serialized, /"totalTokens": 300/);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("rejects an output directory outside the runtime report boundary", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wes-rag-report-boundary-"));
  assert.throws(() => saveRagBaselineArtifact({}, {
    projectRoot,
    outputDirectory: path.join(projectRoot, "tracked-reports"),
    datasetVersion: "v1",
  }), /report_output_directory_not_allowed/);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});
