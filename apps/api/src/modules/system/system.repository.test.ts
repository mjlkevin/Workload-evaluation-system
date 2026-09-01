import test from "node:test";
import assert from "node:assert/strict";

import {
  _resetSystemRepositoryForTest,
  computeKnowledgeBaseConfigHash,
  computeKnowledgeBaseProfileHash,
  getSystemRepository,
  mergeKnowledgeBaseCredentialsPatch,
  normalizeKnowledgeBaseConfig,
  normalizeRequirementSystemConfig,
  validateKnowledgeBaseProfiles,
  resolveActiveRequirementKimiApiKey,
  resolveDraftKimiApiKeyForTest,
} from "./system.repository";
import { createSystemPgRepository } from "./system-pg.repository";
import {
  resetCredentialCache,
  setCachedApiKey,
  KIMI_SCOPE,
} from "./credentials.store";

// S3（2026-08-30）口径：system 四配置 JSON 读写路径删除后本域恒 PG。
// 原四条依赖 JSON 的用例已随实现退役（逐条去向见下方登记）：
//  - 「loadRequirementSystemConfigStore: 文件有 apiKey 时清空文件并填充缓存」
//    与「文件无 apiKey 时不触发导入」：文件→DB 一次性密钥导入是 JSON 读路径
//    专属 shim（system-pg.repository.ts:35-37 自承「PG 路径不适用」）；导入函数
//    本身的幂等语义由 credentials.store.test.ts 直接持 pool 覆盖（S3B1 2026-09-01
//    前该文件零引用从未运行，本条注释曾以它为覆盖依据——假绿证据；本批已将其
//    接入 test:modules，声明成立）。
//  - 「saveRequirementSystemConfigStore: 即使 store 有 apiKey 也写空串到文件」：
//    职责由 system-pg.repository.test.ts「requirementSettings round-trip：store
//    深相等且 apiKey 读回必为空（密钥不落库）」承担，并补上原未断的缓存填充。
//  - 「对照：JSON 整存 RMW 并发改不同字段必现丢失更新」：该用例自身注释已声明
//    「未来第 4 步删除 JSON 路径时本用例随实现一并删除」；PG 侧等价约束由
//    system-pg.repository.test.ts「并发写同一 config key：收敛为其中一个完整
//    输入（无字段混写）」与「并发写不同 config key：互不覆盖」承担。

test("normalizeRequirementSystemConfig: 迁移旧 Kimi 模型到 K2.5/K2.6 默认模型", () => {
  // 原用例经 chdir + 写 JSON 文件构造 legacy 输入，再断读路径迁移。JSON 读路径
  // 删除后 PG 读路径按设计不做读时迁移（seed 已经过 normalize，实测在库配置仅
  // 含 kimi-k2.6、无 legacy 值），迁移语义的唯一承载点就是 normalizeRequirementConfig
  // 本身，故断言直接打在导出的纯函数上——与用例主题一致，不经存储。
  const draft = normalizeRequirementSystemConfig({
    kimiEvaluation: { model: "moonshot-v1-128k" },
    fileParsing: { model: "kimi-k2-turbo-preview" },
    kimiGeneration: { model: "moonshot-v1-128k" },
    kimiCredentials: { apiKey: "" },
  });
  assert.equal(draft.kimiEvaluation.model, "kimi-k2.5");
  assert.equal(draft.fileParsing.model, "kimi-k2.6");
  assert.equal(draft.kimiGeneration.model, "kimi-k2.5");

  const active = normalizeRequirementSystemConfig({
    kimiEvaluation: { model: "moonshot-v1-8k" },
    fileParsing: { model: "kimi-k2-turbo-preview" },
    kimiGeneration: { model: "moonshot-v1-128k" },
    kimiCredentials: { apiKey: "" },
  });
  assert.equal(active.kimiEvaluation.model, "kimi-k2.5");
  assert.equal(active.fileParsing.model, "kimi-k2.6");
  assert.equal(active.kimiGeneration.model, "kimi-k2.5");
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

// ─── 选择器（S3 第 4 步：JSON 路径删除后恒 PG） ─────────────────

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

test("选择器恒装配 PG 实现（S3 JSON 路径删除后）", () => {
  _resetSystemRepositoryForTest();
  assert.equal(isPgRepo(getSystemRepository()), true, "必须恒走 PG");
});

test("选择器记忆化：多次取用返回同一单例", () => {
  _resetSystemRepositoryForTest();
  const first = getSystemRepository();
  const second = getSystemRepository();
  assert.equal(first, second, "进程内单例记忆化");
});

test("PG 工厂签名与选择器装配一致", () => {
  const pgMarker = createSystemPgRepository;
  assert.equal(typeof pgMarker, "function");
});
