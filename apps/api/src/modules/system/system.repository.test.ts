import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeKnowledgeBaseConfigHash,
  computeKnowledgeBaseProfileHash,
  loadRequirementSystemConfigStore,
  mergeKnowledgeBaseCredentialsPatch,
  normalizeKnowledgeBaseConfig,
  validateKnowledgeBaseProfiles,
  saveRequirementSystemConfigStore,
  resolveActiveRequirementKimiApiKey,
  resolveDraftKimiApiKeyForTest,
  _resetKimiImportCheck,
} from "./system.repository";
import {
  resetCredentialCache,
  getCachedApiKey,
  setCachedApiKey,
  KIMI_SCOPE,
} from "./credentials.store";

test("loadRequirementSystemConfigStore: 迁移旧 Kimi 模型到 K2.5 默认模型", async () => {
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
    // 阶段 1 批 5：store accessor 已异步化，补 await（断言不变）。
    const store = await loadRequirementSystemConfigStore();

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

test("knowledge base legacy single id migrates into one default profile", () => {
  const normalized = normalizeKnowledgeBaseConfig({
    model: "glm-test",
    credentials: { apiKey: "fixture-key", knowledgeId: "legacy-kb" },
  });

  assert.equal(normalized.knowledgeBases.length, 1);
  assert.deepEqual(normalized.knowledgeBases[0], {
    id: "legacy-default",
    name: "默认知识库",
    description: "由旧版单知识库配置自动迁移",
    knowledgeId: "legacy-kb",
    routingKeywords: [],
    allowedBusinessRoles: [],
    enabled: true,
    isDefault: true,
    priority: 100,
  });
});

test("knowledge base profiles normalize ids, keywords, roles and a single default", () => {
  const normalized = normalizeKnowledgeBaseConfig({
    credentials: { apiKey: "fixture-key", knowledgeId: "" },
    knowledgeBases: [
      {
        id: "  Finance KB  ",
        name: " 资金方案库 ",
        description: " 资金、银企方案 ",
        knowledgeId: " kb-finance ",
        routingKeywords: ["资金计划", "资金计划", " 网银 "],
        allowedBusinessRoles: ["pre_sales", "pm", "invalid", "pm"],
        enabled: true,
        isDefault: true,
        priority: -3,
      },
    ],
  });

  assert.deepEqual(normalized.knowledgeBases[0], {
    id: "finance-kb",
    name: "资金方案库",
    description: "资金、银企方案",
    knowledgeId: "kb-finance",
    routingKeywords: ["资金计划", "网银"],
    allowedBusinessRoles: ["pre_sales", "pm"],
    enabled: true,
    isDefault: true,
    priority: 0,
  });
});

test("knowledge base profile validation rejects duplicates and multiple defaults", () => {
  const config = normalizeKnowledgeBaseConfig({
    credentials: { apiKey: "fixture-key", knowledgeId: "" },
    knowledgeBases: [
      { id: "solutions", name: "方案库", knowledgeId: "same", enabled: true, isDefault: true },
      { id: "solutions", name: "案例库", knowledgeId: "same", enabled: true, isDefault: true },
    ],
  });

  assert.deepEqual(validateKnowledgeBaseProfiles(config.knowledgeBases).map((item) => item.reason), [
    "duplicate_profile_id",
    "duplicate_knowledge_id",
    "multiple_default_profiles",
  ]);
});

test("knowledge base profile hash binds shared settings and the selected profile only", () => {
  const config = normalizeKnowledgeBaseConfig({
    model: "glm-test",
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    credentials: { apiKey: "fixture-key", knowledgeId: "" },
    knowledgeBases: [
      { id: "solutions", name: "方案库", knowledgeId: "kb-one", enabled: true, isDefault: true },
      { id: "cases", name: "案例库", knowledgeId: "kb-two", enabled: true },
    ],
  });
  const first = computeKnowledgeBaseProfileHash(config, config.knowledgeBases[0]);
  const second = computeKnowledgeBaseProfileHash(config, config.knowledgeBases[1]);
  const renamedOther = computeKnowledgeBaseProfileHash(
    { ...config, knowledgeBases: [config.knowledgeBases[0], { ...config.knowledgeBases[1], name: "新案例库" }] },
    config.knowledgeBases[0],
  );

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(first, renamedOther);
});

// -------------------- 凭据域 DB 化测试 — ISS-2026-08-05-001 --------------------

test("loadRequirementSystemConfigStore: 文件有 apiKey 时清空文件并填充缓存", async () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-cred-import-"));
  const configDir = path.join(tmpDir, "config/system");
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "requirement-settings.json");
  const testApiKey = "sk-test-import-key-12345";

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: 1,
        draft: { kimiCredentials: { apiKey: testApiKey } },
        active: { kimiCredentials: { apiKey: testApiKey } },
      },
      null,
      2,
    ),
    "utf-8",
  );

  _resetKimiImportCheck();
  resetCredentialCache();

  try {
    process.chdir(tmpDir);
    // 阶段 1 批 5：store accessor 已异步化，补 await（断言不变）。
    const store = await loadRequirementSystemConfigStore();

    // 文件 apiKey 应被清空
    const fileContent = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(fileContent.draft.kimiCredentials.apiKey, "");
    assert.equal(fileContent.active.kimiCredentials.apiKey, "");

    // 缓存应被填充
    assert.equal(getCachedApiKey(KIMI_SCOPE), testApiKey);

    // 返回的 store 中 apiKey 也应为空（真实密钥在 DB/缓存）
    assert.equal(store.draft.kimiCredentials.apiKey, "");
    assert.equal(store.active.kimiCredentials.apiKey, "");
  } finally {
    process.chdir(originalCwd);
    _resetKimiImportCheck();
    resetCredentialCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadRequirementSystemConfigStore: 文件无 apiKey 时不触发导入", async () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-cred-noop-"));
  const configDir = path.join(tmpDir, "config/system");
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "requirement-settings.json");

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: 1,
        draft: { kimiCredentials: { apiKey: "" } },
        active: { kimiCredentials: { apiKey: "" } },
      },
      null,
      2,
    ),
    "utf-8",
  );

  _resetKimiImportCheck();
  resetCredentialCache();

  try {
    process.chdir(tmpDir);
    await loadRequirementSystemConfigStore();

    // 缓存应仍为空（未触发导入）
    assert.equal(getCachedApiKey(KIMI_SCOPE), null);
  } finally {
    process.chdir(originalCwd);
    _resetKimiImportCheck();
    resetCredentialCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("saveRequirementSystemConfigStore: 即使 store 有 apiKey 也写空串到文件", async () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-cred-save-"));
  const configDir = path.join(tmpDir, "config/system");
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "requirement-settings.json");

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: 1,
        draft: { kimiCredentials: { apiKey: "" } },
        active: { kimiCredentials: { apiKey: "" } },
      },
      null,
      2,
    ),
    "utf-8",
  );

  _resetKimiImportCheck();

  try {
    process.chdir(tmpDir);
    // 阶段 1 批 5：store accessor 已异步化，补 await（断言不变）。
    const store = await loadRequirementSystemConfigStore();

    // 模拟 mergeKimiCredentialsPatch 后 store 有非空 apiKey
    store.draft.kimiCredentials.apiKey = "sk-should-not-persist";
    store.active.kimiCredentials.apiKey = "sk-should-not-persist";
    await saveRequirementSystemConfigStore(store);

    // 文件 apiKey 应为空串
    const fileContent = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(fileContent.draft.kimiCredentials.apiKey, "");
    assert.equal(fileContent.active.kimiCredentials.apiKey, "");
  } finally {
    process.chdir(originalCwd);
    _resetKimiImportCheck();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveActiveRequirementKimiApiKey: 从 DB 缓存读取密钥", () => {
  resetCredentialCache();

  // 无缓存 → env 或 none
  const before = resolveActiveRequirementKimiApiKey();
  assert.ok(before.source === "env" || before.source === "none");

  // 设置缓存 → 从 store 读取
  setCachedApiKey(KIMI_SCOPE, "sk-from-cache-67890");
  const after = resolveActiveRequirementKimiApiKey();
  assert.equal(after.apiKey, "sk-from-cache-67890");
  assert.equal(after.source, "store");

  resetCredentialCache();
});

test("resolveDraftKimiApiKeyForTest: 从 DB 缓存读取草稿密钥", () => {
  resetCredentialCache();

  // override 优先
  const override = resolveDraftKimiApiKeyForTest("sk-override-key");
  assert.equal(override.apiKey, "sk-override-key");
  assert.equal(override.source, "override");

  // 无 override、无缓存 → env 或 none
  const noCache = resolveDraftKimiApiKeyForTest();
  assert.ok(noCache.source === "env" || noCache.source === "none");

  // 有缓存 → draft
  setCachedApiKey(KIMI_SCOPE, "sk-draft-from-cache");
  const fromCache = resolveDraftKimiApiKeyForTest();
  assert.equal(fromCache.apiKey, "sk-draft-from-cache");
  assert.equal(fromCache.source, "draft");

  resetCredentialCache();
});
