import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultRegistry } from "./default-registry";
import type { AuthUser } from "../types";
import type { Capability } from "../rbac/permissions";

const fakeUser: AuthUser = {
  id: "u-test",
  username: "agent-tester",
  passwordHash: "hash",
  role: "user",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
};

/** 全能力位视图（覆盖全部 8 个工具所需能力位） */
const FULL_CAPS: Capability[] = ["estimates:read", "estimates:create", "estimates:write"];

function visibleNames(registry: ReturnType<typeof createDefaultRegistry>, caps: Capability[]): string[] {
  return registry
    .listToolsFor({ id: fakeUser.id, capabilities: caps })
    .map((t) => t.function.name)
    .sort();
}

test("createDefaultRegistry: 注册数 ≥11 且工具名单快照（含内置 list_tools）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const names = visibleNames(registry, FULL_CAPS);

  assert.ok(names.length >= 11, `注册数应 ≥11，实际 ${names.length}`);
  assert.deepEqual(names, [
    "ask_user",
    "create_project",
    // 批次 4：capability_discovery 正则退役后的承接工具
    "describe_capabilities",
    "estimate_history",
    "estimate_implementation",
    "export_report",
    "generate_wbs",
    "knowledge_query",
    "list_tools",
    "project_list",
    "rule_lookup",
  ]);
});

test("createDefaultRegistry: 能力位 → 工具映射快照", () => {
  const registry = createDefaultRegistry(fakeUser);

  // estimates:read：4 个查询工具 + 批次 4 的能力清单 + 批次 9 的 ask_user + 内置发现工具 list_tools
  // （ask_user 用只读档是裁决：凡能用工作台的人都可被提问）
  assert.deepEqual(visibleNames(registry, ["estimates:read"]), [
    "ask_user",
    "describe_capabilities",
    "estimate_history",
    "knowledge_query",
    "list_tools",
    "project_list",
    "rule_lookup",
  ]);
  // estimates:create：初估 + 建项目
  assert.deepEqual(visibleNames(registry, ["estimates:create"]), [
    "create_project",
    "estimate_implementation",
  ]);
  // estimates:write：WBS 生成 + 报告导出
  assert.deepEqual(visibleNames(registry, ["estimates:write"]), [
    "export_report",
    "generate_wbs",
  ]);
});

test("listToolsFor: 无能力位用户看不到任何工具", () => {
  const registry = createDefaultRegistry(fakeUser);
  const tools = registry.listToolsFor({ id: fakeUser.id, capabilities: [] });

  assert.deepEqual(tools, []);
});

test("execute: 无能力位用户调用写工具被拒绝（执行时二次校验）", async () => {
  const registry = createDefaultRegistry(fakeUser);

  await assert.rejects(
    () => registry.execute("create_project", { projectName: "x" }, { id: fakeUser.id, capabilities: [] }),
    /无权限调用工具 create_project/,
  );
});

// ============================================================
// SP-2026-007 MS3：工具发现两段式（list_tools + 注入收敛）
// ============================================================

test("MS3: 默认注册表含内置 list_tools（发现类，核心注入）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const tool = registry.get("list_tools");

  assert.ok(tool, "list_tools 应已注册");
  assert.equal(tool.mutates, false);
  assert.equal(tool.category, "discovery");
  assert.notEqual(tool.discoverable, true, "list_tools 本身应常驻核心注入集");
});

test("MS3: 全量回退注入与旧行为逐字节一致（原 8 工具、原顺序、无 list_tools；批次 9 起末尾追加 ask_user）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const names = registry
    .listFullToolsFor({ id: fakeUser.id, capabilities: FULL_CAPS })
    .map((t) => t.function.name);

  assert.deepEqual(names, [
    "estimate_implementation",
    "project_list",
    "estimate_history",
    "knowledge_query",
    "rule_lookup",
    "create_project",
    "generate_wbs",
    "export_report",
    // 批次 9 注册在原 8 个之后、发现工具之前：旧注入顺序逐字节不变
    "ask_user",
    // 批次 4 追加在 ask_user 之后：前 9 项顺序仍逐字节不变
    "describe_capabilities",
  ]);
});

test("MS3: 默认按需发现注入集 = 核心工具 + list_tools，较全量下降 ≥50%", () => {
  const registry = createDefaultRegistry(fakeUser);
  const user = { id: fakeUser.id, capabilities: FULL_CAPS };

  const full = registry.listFullToolsFor(user).map((t) => t.function.name);
  const core = registry.listCoreToolsFor(user).map((t) => t.function.name);
  const discovery = registry.listDiscoveryToolsFor(user).map((t) => t.function.name);

  assert.deepEqual(discovery, ["list_tools"]);
  const injected = [...core, ...discovery];
  assert.ok(injected.includes("list_tools"));
  assert.ok(!injected.includes("knowledge_query"), "discoverable 工具不应默认注入");
  assert.ok(
    injected.length <= full.length / 2,
    `默认注入 ${injected.length} 应 ≤ 全量 ${full.length} 的 50%`,
  );
  assert.ok(full.includes("describe_capabilities"), "批次 4：全量注入集含能力清单工具（工作台据此可调用）");
  assert.ok(!core.includes("describe_capabilities"), "能力清单是 discoverable，不进常驻注入集");
});

test("MS3: RP-018 知识库工具注册为首个 discoverable 试点", () => {
  const registry = createDefaultRegistry(fakeUser);
  const tool = registry.get("knowledge_query");

  assert.equal(tool?.discoverable, true);
  assert.equal(tool?.category, "knowledge");
});

test("MS3: list_tools 按意图返回匹配工具说明书子集", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "list_tools",
    { intent: "知识库" },
    { id: fakeUser.id, capabilities: FULL_CAPS },
  )) as { tools: Array<{ name: string; parameters?: unknown }> };

  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes("knowledge_query"), `意图「知识库」应命中 knowledge_query，实际 ${names}`);
  assert.ok(!names.includes("list_tools"), "发现结果不应包含 list_tools 自身");
  assert.ok(result.tools.every((t) => t.parameters), "说明书应含参数 schema");
});

test("MS3: list_tools 结果经 RBAC 能力位过滤（越权工具不可见）", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "list_tools",
    {},
    { id: fakeUser.id, capabilities: ["estimates:read"] },
  )) as { tools: Array<{ name: string }> };

  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes("knowledge_query"));
  assert.ok(!names.includes("create_project"), "无 estimates:create 不应看到 create_project");
  assert.ok(!names.includes("export_report"), "无 estimates:write 不应看到 export_report");
});

test("MS3: list_tools 按类别过滤", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "list_tools",
    { category: "export" },
    { id: fakeUser.id, capabilities: FULL_CAPS },
  )) as { tools: Array<{ name: string; category: string }> };

  assert.deepEqual(result.tools.map((t) => t.name), ["export_report"]);
  assert.ok(result.tools.every((t) => t.category === "export"));
});

// ============================================================
// 批次 4 · knowledge_query 工具的选库口径
//
// 这些断言原先挂在 workbench-dispatch.service.test.ts 上，锁的是
// 「词表命中 → knowledge-query.handler 选库」。词表与 handler 一起退役后，
// `runKnowledgeQuery` 成为唯一生产方，口径因此搬到这里逐条重锁——
// 尤其是**按业务角色过滤可见库**这一条：退役后若它还留着 `profiles[0]`，
// 就等于让模型替用户挑一个对方本来不该看见的知识库。
// ============================================================

import { runKnowledgeQuery, type KnowledgeQueryDeps } from "./default-registry";
import type { KnowledgeBaseProfile } from "../types";
import type { ZhipuKnowledgeToolTrace } from "../services/ai/knowledge-tool.service";

function kbProfile(overrides: Partial<KnowledgeBaseProfile>): KnowledgeBaseProfile {
  return {
    id: "solutions",
    name: "金蝶解决方案知识库",
    description: "产品方案与实施边界",
    knowledgeId: "kb-solutions",
    routingKeywords: ["产品方案", "标准模块"],
    allowedBusinessRoles: [],
    enabled: true,
    isDefault: true,
    priority: 100,
    ...overrides,
  };
}

const kbCatalog = {
  apiKey: "fixture-key",
  model: "glm-test",
  apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed" as const, rerankStatus: 1 as const, rerankModel: "rerank", fractionalThreshold: 0.2 },
  promptProfile: { id: "rag-answer", version: 1 },
  configVersion: 4,
  source: "store" as const,
  profiles: [
    kbProfile({}),
    kbProfile({
      id: "treasury",
      name: "司库与银企知识库",
      description: "资金计划、网上银行、银企直联",
      knowledgeId: "kb-treasury",
      routingKeywords: ["资金计划", "网上银行", "网银", "银企"],
      allowedBusinessRoles: ["pre_sales", "delivery", "pm"],
      isDefault: false,
      priority: 10,
    }),
    kbProfile({
      id: "dev-private",
      name: "研发内部知识库",
      knowledgeId: "kb-dev",
      routingKeywords: ["研发规范"],
      allowedBusinessRoles: ["dev"],
      isDefault: false,
      priority: 20,
    }),
  ],
};

function kbTrace(query: string, knowledgeId: string, overrides: Partial<ZhipuKnowledgeToolTrace> = {}): ZhipuKnowledgeToolTrace {
  return {
    toolId: "knowledge_base.query_product_knowledge",
    available: true,
    model: "GLM-test",
    knowledgeId,
    query,
    answer: "存货核算通常需要结合库存管理等模块。",
    confidence: "high",
    retrievalTriggered: true,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    latencyMs: 1,
    contextRef: `knowledge:${knowledgeId}:chunks=2:score=0.9`,
    chunksCount: 2,
    topScore: 0.9,
    prompt: { id: "rag-answer", version: 1, hash: "a".repeat(64) },
    retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed", rerankStatus: 1, rerankModel: "rerank", fractionalThreshold: 0.2 },
    ...overrides,
  };
}

/** 返回记录调用序列的 invoke 桩；空 knowledgeId 视为「无库可查」 */
function kbRecorder(result?: (knowledgeId: string) => Partial<ZhipuKnowledgeToolTrace>) {
  const calls: Array<{ knowledgeId: string; apiKey: string }> = [];
  const invoke: NonNullable<KnowledgeQueryDeps["invoke"]> = async (query, config) => {
    calls.push({ knowledgeId: config.knowledgeId ?? "", apiKey: config.apiKey ?? "" });
    return kbTrace(query, config.knowledgeId ?? "", result?.(config.knowledgeId ?? ""));
  };
  return { calls, invoke };
}

const depsFor = (invoke: KnowledgeQueryDeps["invoke"]): KnowledgeQueryDeps => ({
  loadCatalog: async () => kbCatalog,
  invoke,
});

test("批次4·知识库工具：按业务角色授权选库，越权库永不被选中", async () => {
  const { calls, invoke } = kbRecorder();
  // pre_sales 可访问 solutions + treasury，不可访问 dev-private
  await runKnowledgeQuery("网上银行实施边界怎么划分？", "pre_sales", undefined, depsFor(invoke));
  assert.deepEqual(calls.map((c) => c.knowledgeId), ["kb-treasury"], "关键词应命中授权范围内的司库库");

  // 即便用户话里点名了越权库，也不得选中它（授权在选库之前，不是事后过滤）
  const probe = kbRecorder();
  await runKnowledgeQuery("研发规范里怎么要求？", "pre_sales", undefined, depsFor(probe.invoke));
  assert.ok(!probe.calls.some((c) => c.knowledgeId === "kb-dev"), `越权库不得被查询，实取 ${JSON.stringify(probe.calls)}`);
});

test("批次4·知识库工具：仅 retrieval_empty 才回退一次授权内候选库", async () => {
  const { calls, invoke } = kbRecorder((knowledgeId) =>
    knowledgeId === "kb-treasury" ? { fallbackReason: "retrieval_empty", chunksCount: 0, topScore: 0, confidence: "low" } : {},
  );
  await runKnowledgeQuery("网上银行实施边界怎么划分？", "pre_sales", undefined, depsFor(invoke));
  assert.deepEqual(calls.map((c) => c.knowledgeId), ["kb-treasury", "kb-solutions"]);
});

test("批次4·知识库工具：其它失败就地收口，不向多库扩散", async () => {
  const { calls, invoke } = kbRecorder(() => ({ fallbackReason: "retrieval_failed", chunksCount: 0, topScore: 0, confidence: "low" }));
  await runKnowledgeQuery("网上银行实施边界怎么划分？", "pre_sales", undefined, depsFor(invoke));
  assert.deepEqual(calls.map((c) => c.knowledgeId), ["kb-treasury"], "只允许一次命中尝试");
});

test("批次4·知识库工具：无可见库时以空凭据下传（失败方向关闭）", async () => {
  const { calls, invoke } = kbRecorder();
  const emptyDeps: KnowledgeQueryDeps = {
    loadCatalog: async () => ({ ...kbCatalog, profiles: [kbProfile({ id: "dev-only", knowledgeId: "kb-dev", allowedBusinessRoles: ["dev"], isDefault: false })] }),
    invoke,
  };
  await runKnowledgeQuery("随便问点什么", "pre_sales", undefined, emptyDeps);
  assert.deepEqual(calls, [{ knowledgeId: "", apiKey: "" }], "无授权库时不得带凭据去查任何库");
});

// 痕迹的「归属」字段（选了哪个库 / 按什么口径选的 / 每次尝试的结果）退役前由
// knowledge-query.handler 挂载，是前端来源卡片与 trace 知识库 span 的数据源。
// 批次 4 把检索入口收拢到 runKnowledgeQuery 后，这组字段必须一并搬过来。
test("批次4·知识库工具：痕迹带上选库归属（profile 名称 + route.attempts），与退役前同形", async () => {
  const { invoke } = kbRecorder();
  const trace = await runKnowledgeQuery("网上银行实施边界怎么划分？", "pre_sales", undefined, depsFor(invoke));

  assert.equal(trace.knowledgeBaseProfileId, "treasury");
  assert.equal(trace.knowledgeBaseName, "司库与银企知识库");
  assert.equal(trace.route?.primaryProfileId, "treasury");
  assert.ok(trace.route?.reason, "route.reason 必须留下选库理由");
  assert.deepEqual(
    trace.route?.attempts.map((attempt) => [attempt.profileId, attempt.chunksCount]),
    [["treasury", 2]],
    "单次命中只应记录一次尝试",
  );
});

test("批次4·知识库工具：回退成功时 attempts 记录两次并写出 fallbackProfileId", async () => {
  const { invoke } = kbRecorder((knowledgeId) =>
    knowledgeId === "kb-treasury" ? { fallbackReason: "retrieval_empty", chunksCount: 0, topScore: 0, confidence: "low" } : {},
  );
  const trace = await runKnowledgeQuery("网上银行实施边界怎么划分？", "pre_sales", undefined, depsFor(invoke));

  assert.equal(trace.knowledgeBaseProfileId, "solutions", "最终归属必须是实际作答的那个库");
  assert.equal(trace.route?.fallbackProfileId, "solutions");
  assert.deepEqual(
    trace.route?.attempts.map((attempt) => [attempt.profileId, attempt.fallbackReason ?? ""]),
    [["treasury", "retrieval_empty"], ["solutions", ""]],
  );
});

// ── 批次 4 · describe_capabilities ──────────────────────────
// 退役前由 capability_keywords 词表决定「这句话要回能力清单」；退役后由模型自己调本工具。
// 事实源本身没变：仍是 CAPABILITY_FACTS 单一来源，防的是模型编造未实现能力。

test("批次4·describe_capabilities：返回事实表原文与越界约束", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "describe_capabilities",
    {},
    { id: fakeUser.id, capabilities: FULL_CAPS },
  )) as { groundingRule: string; facts: string; capabilityIds: string[] };

  assert.match(result.groundingRule, /禁止新增未实现的能力承诺/);
  assert.match(result.facts, /需求解析报告/);
  assert.ok(result.capabilityIds.includes("report_v1"), "事实条目 id 全集应可核对");
});

test("批次4·describe_capabilities：可经 list_tools 按意图发现", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const found = (await registry.execute(
    "list_tools",
    { intent: "能力" },
    { id: fakeUser.id, capabilities: FULL_CAPS },
  )) as { tools: Array<{ name: string }> };
  assert.ok(found.tools.map((t) => t.name).includes("describe_capabilities"), `实取 ${JSON.stringify(found.tools)}`);
});
