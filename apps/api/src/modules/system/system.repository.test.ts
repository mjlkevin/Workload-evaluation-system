import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeKnowledgeBaseConfigHash,
  loadRequirementSystemConfigStore,
  mergeKnowledgeBaseCredentialsPatch,
  normalizeKnowledgeBaseConfig,
} from "./system.repository";

test("loadRequirementSystemConfigStore: 迁移旧 Kimi 模型到 K2.5 默认模型", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-kimi-config-"));
  const configDir = path.join(tmpDir, "config/system");
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "requirement-settings.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: 1,
        draft: {
          kimiEvaluation: { model: "moonshot-v1-128k" },
          fileParsing: { model: "kimi-k2-turbo-preview" },
          kimiGeneration: { model: "moonshot-v1-128k" },
          kimiCredentials: { apiKey: "" },
        },
        active: {
          kimiEvaluation: { model: "moonshot-v1-8k" },
          fileParsing: { model: "kimi-k2-turbo-preview" },
          kimiGeneration: { model: "moonshot-v1-128k" },
          kimiCredentials: { apiKey: "" },
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  try {
    process.chdir(tmpDir);
    const store = loadRequirementSystemConfigStore();

    assert.equal(store.draft.kimiEvaluation.model, "kimi-k2.5");
    assert.equal(store.draft.fileParsing.model, "kimi-k2.6");
    assert.equal(store.draft.kimiGeneration.model, "kimi-k2.5");
    assert.equal(store.active.kimiEvaluation.model, "kimi-k2.5");
    assert.equal(store.active.fileParsing.model, "kimi-k2.6");
    assert.equal(store.active.kimiGeneration.model, "kimi-k2.5");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("knowledge base legacy config receives safe retrieval defaults", () => {
  const normalized = normalizeKnowledgeBaseConfig({
    model: "glm-test",
    credentials: { apiKey: "", knowledgeId: "" },
  });
  assert.deepEqual(normalized.retrievalParams, {
    topK: 8,
    topN: 20,
    recallMethod: "mixed",
    rerankStatus: 1,
    rerankModel: "rerank",
    fractionalThreshold: 0.2,
  });
});

test("knowledge base retrieval parameters are clamped and internally consistent", () => {
  const normalized = normalizeKnowledgeBaseConfig({
    retrievalParams: {
      topK: 999,
      topN: 2,
      recallMethod: "unknown",
      rerankStatus: 9,
      rerankModel: "",
      fractionalThreshold: -1,
    },
  });
  assert.deepEqual(normalized.retrievalParams, {
    topK: 50,
    topN: 50,
    recallMethod: "mixed",
    rerankStatus: 1,
    rerankModel: "rerank",
    fractionalThreshold: 0,
  });
});

test("knowledge base credential patch distinguishes keep, replace and clear", () => {
  const previous = { apiKey: "stored-key", knowledgeId: "stored-kb" };
  assert.deepEqual(mergeKnowledgeBaseCredentialsPatch(previous, undefined), previous);
  assert.deepEqual(
    mergeKnowledgeBaseCredentialsPatch(previous, { apiKey: "", knowledgeId: "" }),
    previous,
  );
  assert.deepEqual(
    mergeKnowledgeBaseCredentialsPatch(previous, { apiKey: "new-key", knowledgeId: "new-kb" }),
    { apiKey: "new-key", knowledgeId: "new-kb" },
  );
  assert.deepEqual(
    mergeKnowledgeBaseCredentialsPatch(previous, { apiKey: null, knowledgeId: null }),
    { apiKey: "", knowledgeId: "" },
  );
});

test("knowledge base config hash changes with credentials and retrieval settings", () => {
  const base = normalizeKnowledgeBaseConfig({
    model: "glm-test",
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    credentials: { apiKey: "fixture-key", knowledgeId: "kb-one" },
  });
  const first = computeKnowledgeBaseConfigHash(base);
  const changedKnowledge = computeKnowledgeBaseConfigHash({
    ...base,
    credentials: { ...base.credentials, knowledgeId: "kb-two" },
  });
  const changedRetrieval = computeKnowledgeBaseConfigHash({
    ...base,
    retrievalParams: { ...base.retrievalParams, topK: 9 },
  });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, changedKnowledge);
  assert.notEqual(first, changedRetrieval);
});
