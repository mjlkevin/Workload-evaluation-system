import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  _resetKimiImportCheck,
  _resetSystemRepositoryForTest,
  computeKnowledgeBaseConfigHash,
  computeKnowledgeBaseProfileHash,
  getSystemRepository,
  loadRequirementSystemConfigStore,
  mergeKnowledgeBaseCredentialsPatch,
  normalizeKnowledgeBaseConfig,
  validateKnowledgeBaseProfiles,
  saveRequirementSystemConfigStore,
  resolveActiveRequirementKimiApiKey,
  resolveDraftKimiApiKeyForTest,
} from "./system.repository";
import { createSystemPgRepository } from "./system-pg.repository";
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

// ─── 选择器（阶段 2 批 4 第 3 步：缺省 JSON，严格 === "true" 切 PG） ───

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

test("选择器缺省（未设开关）装配 JSON 实现", () => {
  delete process.env.WES_STORE_SYSTEM_PG;
  _resetSystemRepositoryForTest();
  const repo = getSystemRepository();
  assert.equal(isPgRepo(repo), false, "缺省必须走 JSON（回滚安全）");
});

test("选择器严格语义：仅 'true' 切 PG，歧义值一律 JSON", () => {
  for (const value of ["1", "yes", "TRUE", "True", ""]) {
    process.env.WES_STORE_SYSTEM_PG = value;
    _resetSystemRepositoryForTest();
    assert.equal(isPgRepo(getSystemRepository()), false, `歧义值 ${JSON.stringify(value)} 必须回落 JSON`);
  }
  process.env.WES_STORE_SYSTEM_PG = "true";
  _resetSystemRepositoryForTest();
  assert.equal(isPgRepo(getSystemRepository()), true, "'true' 必须切 PG");
  delete process.env.WES_STORE_SYSTEM_PG;
  _resetSystemRepositoryForTest();
});

test("选择器记忆化：装配后 env 变更不影响既有单例", () => {
  process.env.WES_STORE_SYSTEM_PG = "true";
  _resetSystemRepositoryForTest();
  const first = getSystemRepository();
  process.env.WES_STORE_SYSTEM_PG = "false";
  const second = getSystemRepository();
  assert.equal(first, second, "进程内只读一次开关（翻开关需重启，与 §3.1 对齐）");
  delete process.env.WES_STORE_SYSTEM_PG;
  _resetSystemRepositoryForTest();
});

test("PG 工厂为函数且可装配", () => {
  assert.equal(typeof createSystemPgRepository, "function");
});

// ─── JSON 整存 RMW 已知缺陷记录（并发 RMW 丢失更新） ─────────────
// §4.6 模板的 JSON 对照用例：阶段 1 异步化产生的 await 挂起点使两个
// RMW 的 load 必然先于任一 save 完成（A/B 各自拿到同一全量快照），
// 随后两次整存 save 先后落盘，后写者把前写者的改动整个覆盖——确定性
// 复现（不靠时序碰运气）。本用例把缺陷形态钉死为红线回归：未来第 4 步
// 删除 JSON 路径时本用例随实现一并删除。
// 隔离：chdir 到独立临时根的 config/system 沙箱，不触碰真实配置文件。

test("对照：JSON 整存 RMW 并发改不同字段必现丢失更新（已知缺陷记录）", async () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-system-rmw-"));
  fs.mkdirSync(path.join(tmpDir, "config/system"), { recursive: true });
  try {
    process.chdir(tmpDir);
    // 两个 RMW 并发起步：各自先拿全量快照（await 挂起点保证交错）
    const loadA = loadRequirementSystemConfigStore();
    const loadB = loadRequirementSystemConfigStore();
    const storeA = await loadA;
    const storeB = await loadB;

    // 各自只改一个字段（管理界面两个配置项并发保存的形态）
    storeA.draft.kimiEvaluation.model = "wes-t-rmw-a";
    storeB.draft.fileParsing.maxFileSizeMb = 99;

    await saveRequirementSystemConfigStore(storeA);
    await saveRequirementSystemConfigStore(storeB); // 整存写：B 的快照覆盖 A 的改动

    const final = await loadRequirementSystemConfigStore();
    assert.equal(final.draft.fileParsing.maxFileSizeMb, 99, "后写者 B 的改动必须在");
    assert.notEqual(final.draft.kimiEvaluation.model, "wes-t-rmw-a",
      "丢失更新：A 的改动被整存覆盖（PG 行级写不会丢，对照 system-pg 并发用例）");
  } finally {
    process.chdir(originalCwd);
    _resetKimiImportCheck();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
