import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadRequirementSystemConfigStore } from "./system.repository";

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
