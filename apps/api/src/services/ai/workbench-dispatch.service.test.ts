import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser, KnowledgeBaseProfile, VersionRecord } from "../../types";
import { dispatchHomeWorkbenchTurn } from "./workbench-dispatch.service";
import type { ZhipuKnowledgeToolTrace } from "./knowledge-tool.service";
import { buildWorkbenchChatModelChat, type HomeMessageInput } from "./handlers/workbench-shared";
import { defaultProviderRegistry, type ModelProvider, type ChatCompletionRequest, type ChatCompletionResponse } from "../../ai/provider";
import { loadRequirementSystemConfigStore, saveRequirementSystemConfigStore } from "../../modules/system/system.repository";
import { _resetVersionsRepositoryForTest, getVersionsRepository } from "../../modules/versions/versions.repository";

const user: AuthUser = {
  id: "user-rp-013",
  username: "kevin",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-06-24T00:00:00.000Z",
  lastLoginAt: "2026-06-24T00:00:00.000Z",
};

function createKnowledgeTrace(overrides: Partial<ZhipuKnowledgeToolTrace> = {}): ZhipuKnowledgeToolTrace {
  return {
    toolId: "knowledge_base.query_product_knowledge",
    available: true,
    model: "GLM-5V-Turbo",
    knowledgeId: "kb-sales",
    query: "购买存货核算模块必须购买哪些相关模块？",
    answer: "存货核算通常需要结合库存管理、采购管理、应付和总账等模块确认边界。",
    confidence: "high",
    retrievalTriggered: true,
    promptTokens: 1420,
    completionTokens: 48,
    totalTokens: 1468,
    latencyMs: 12,
    contextRef: "knowledge:kb-sales:%E5%AD%98%E8%B4%A7:chunks=5:score=0.92",
    chunksCount: 5,
    topScore: 0.92,
    prompt: { id: "rag-answer", version: 1, hash: "a".repeat(64) },
    retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed", rerankStatus: 1, rerankModel: "rerank", fractionalThreshold: 0.2 },
    ...overrides,
  };
}

function knowledgeProfile(overrides: Partial<KnowledgeBaseProfile>): KnowledgeBaseProfile {
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

const multiKnowledgeCatalog = {
  apiKey: "fixture-key",
  model: "glm-test",
  apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed" as const, rerankStatus: 1 as const, rerankModel: "rerank", fractionalThreshold: 0.2 },
  promptProfile: { id: "rag-answer", version: 1 },
  configVersion: 4,
  source: "store" as const,
  profiles: [
    knowledgeProfile({}),
    knowledgeProfile({
      id: "treasury",
      name: "司库与银企知识库",
      description: "资金计划、网上银行、银企直联",
      knowledgeId: "kb-treasury",
      routingKeywords: ["资金计划", "网上银行", "网银", "银企"],
      allowedBusinessRoles: ["pre_sales", "delivery", "pm"],
      isDefault: false,
      priority: 10,
    }),
    knowledgeProfile({
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

/**
 * S4（2026-08-30）：原形态是「delete 开关强制走 JSON + 整份写 records.json + 跑完
 * 还原文件」（C10）。versions 的 JSON 读写路径随本批删除、域恒 PG，这里改为
 * 「起始按 owner 清空 + 经仓储批量种入 + finally 清空」。owner 集合含 other-user
 * 那条——用例正是用它断 owner 作用域隔离，清理也必须覆盖到它。
 * version_records 是行级域（条件 DELETE），不整表 TRUNCATE，C14 不适用。
 */
const FIXTURE_OWNER_USER_IDS = [user.id, "other-user"];

async function resetVersionsRowsForFixtureOwners(): Promise<void> {
  const repo = getVersionsRepository();
  for (const ownerUserId of FIXTURE_OWNER_USER_IDS) {
    for (const record of await repo.listRecords({ ownerUserId })) {
      await repo.deleteVersionRecord({ recordId: record.id, checkReferenced: false });
    }
  }
}

async function withVersionsFixtures(run: () => Promise<void>): Promise<void> {
  // S4 commit C：versions 已恒 PG（WES_STORE_VERSIONS_PG 随本批退役），此处只
  // 重置进程内仓储单例 + 按 owner 做行级重置（重置钩子是测试能力，不依赖开关）。
  _resetVersionsRepositoryForTest();
  await resetVersionsRowsForFixtureOwners();
  try {
    await getVersionsRepository().upsertVersionRecords(projectEvaluationFixtures());
    await run();
  } finally {
    await resetVersionsRowsForFixtureOwners();
    _resetVersionsRepositoryForTest();
  }
}

function projectEvaluationFixtures(): VersionRecord[] {
  return [
    {
      id: "project-draft",
      type: "global",
      versionCode: "PROJECT-DRAFT",
      templateId: "project-evaluation",
      ownerUserId: user.id,
      status: "draft",
      payload: {
        recordKind: "project_evaluation",
        projectName: "蓝海 WMS 项目",
        customerName: "蓝海制造",
        industry: "制造业",
        projectStatus: "draft",
        createdFromHarnessRunId: "harness-run-1",
      },
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T01:00:00.000Z",
      createdByUserId: user.id,
      createdByUsername: user.username,
      updatedByUserId: user.id,
      updatedByUsername: user.username,
      checkoutStatus: "checked_in",
      versionDocStatus: "drafting",
      majorLetter: "A",
      minorNumber: 0,
      baseCode: "PROJECT-DRAFT",
      isHistoricalArchive: false,
      lastCheckinPayload: {},
    },
    {
      id: "project-reviewing",
      type: "global",
      versionCode: "PROJECT-REVIEWING",
      templateId: "project-evaluation",
      ownerUserId: user.id,
      status: "draft",
      payload: {
        recordKind: "project_evaluation",
        projectName: "星河 ERP 项目",
        customerName: "星河集团",
        industry: "零售",
        projectStatus: "reviewing",
      },
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T02:00:00.000Z",
      createdByUserId: user.id,
      createdByUsername: user.username,
      updatedByUserId: user.id,
      updatedByUsername: user.username,
      checkoutStatus: "checked_in",
      versionDocStatus: "drafting",
      majorLetter: "A",
      minorNumber: 0,
      baseCode: "PROJECT-REVIEWING",
      isHistoricalArchive: false,
      lastCheckinPayload: {},
    },
    {
      id: "project-other-owner",
      type: "global",
      versionCode: "PROJECT-OTHER",
      templateId: "project-evaluation",
      ownerUserId: "other-user",
      status: "draft",
      payload: {
        recordKind: "project_evaluation",
        projectName: "其他用户项目",
        customerName: "不应出现",
        projectStatus: "published",
      },
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T03:00:00.000Z",
      createdByUserId: "other-user",
      createdByUsername: "other",
      updatedByUserId: "other-user",
      updatedByUsername: "other",
      checkoutStatus: "checked_in",
      versionDocStatus: "drafting",
      majorLetter: "A",
      minorNumber: 0,
      baseCode: "PROJECT-OTHER",
      isHistoricalArchive: false,
      lastCheckinPayload: {},
    },
  ];
}

test("workbench dispatch extracts a valid formBlock and strips protocol JSON from answer", async () => {
  let capturedSystemPrompt = "";
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请帮我继续澄清项目信息",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    rolePrompt: "售前顾问上下文",
    modelChat: async ({ systemPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      return {
        answer: [
          "需要补充几个关键信息。",
          "",
          "```json",
          JSON.stringify({
            formBlock: {
              blockId: "project-clarification",
              title: "补充项目信息",
              submitLabel: "提交补充",
              fields: [
                {
                  id: "amountRange",
                  label: "预计金额范围",
                  type: "single_select",
                  required: true,
                  options: [
                    { label: "50万以下", value: "under_500k" },
                    { label: "50万-200万", value: "500k_2m" },
                  ],
                },
                { id: "deliveryMonths", label: "目标交付周期（月）", type: "number" },
              ],
            },
          }),
          "```",
        ].join("\n"),
        rawContent: "",
      };
    },
  });

  assert.equal(result.answer.trim(), "需要补充几个关键信息。");
  assert.equal((result as any).formBlock?.blockId, "project-clarification");
  assert.equal((result as any).formBlock?.fields?.[0]?.type, "single_select");
  assert.match(capturedSystemPrompt, /formBlock/);
});

test("ISS-2026-08-11-007: streaming dispatch extracts formBlock instead of returning protocol JSON as answer", async () => {
  const streamedAnswer = [
    "请补充关键项目信息。",
    "",
    "```json",
    JSON.stringify({
      formBlock: {
        blockId: "stream-project-clarification",
        title: "补充项目信息",
        submitLabel: "提交补充",
        fields: [{ id: "scope", label: "实施范围", type: "textarea" }],
      },
    }),
    "```",
  ].join("\n");
  const received: string[] = [];

  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请结合附件继续澄清",
    attachment: { name: "客户需求.xlsx", parsedSummary: "项目：蓝海制造" },
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => { throw new Error("streaming path must not call modelChat"); },
    streamingAdapter: { onToken: (chunk) => received.push(chunk.contentDelta) },
    modelChatStream: async function* () {
      yield { contentDelta: streamedAnswer, model: "kimi-test", finishReason: "stop" };
    },
  });

  assert.equal(received.join(""), streamedAnswer, "传输层仍接收原始 token，结构化在终态结果完成");
  assert.equal(result.answer, "请补充关键项目信息。");
  assert.equal(result.formBlock?.blockId, "stream-project-clarification");
});

test("workbench dispatch downgrades invalid formBlock protocol and strips residual JSON from answer", async () => {
  const rawAnswer = [
    "先确认上线时间。",
    "",
    "```json",
    JSON.stringify({
      formBlock: {
        blockId: "bad-form",
        title: "错误表单",
        submitLabel: "提交",
        fields: [{ id: "launchDate", label: "上线日期", type: "date" }],
      },
    }),
    "```",
  ].join("\n");

  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请继续澄清",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({ answer: rawAnswer, rawContent: rawAnswer }),
  });

  assert.equal((result as any).formBlock, undefined);
  // 提取失败时，残留的 JSON 代码块应被清理，避免前端渲染为纯代码
  assert.equal(result.answer, "先确认上线时间。");
});

test("workbench dispatch repairs truncated JSON and extracts formBlock", async () => {
  // 模拟模型因 token 限制截断的 JSON 输出（只缺最外层 }）
  const fullJson = {
    formBlock: {
      blockId: "truncated-form",
      title: "补充信息",
      submitLabel: "提交",
      fields: [
        { id: "name", label: "项目名称", type: "text", required: true },
        { id: "type", label: "类型", type: "single_select", options: [{ label: "A", value: "a" }] },
      ],
    },
  };
  const jsonStr = JSON.stringify(fullJson);
  // 截掉最后一个 }，即外层对象的闭合
  const truncatedJson = jsonStr.slice(0, -1);

  const rawAnswer = `需要补充以下信息。\n\n\`\`\`json\n${truncatedJson}`;

  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请分析这个需求还缺什么信息",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({ answer: rawAnswer, rawContent: rawAnswer }),
  });

  // 修复后应成功提取 formBlock
  assert.equal((result as any).formBlock?.blockId, "truncated-form");
  assert.equal((result as any).formBlock?.fields?.length, 2);
  // answer 应清理掉残留的 JSON 代码块
  assert.equal(result.answer.trim(), "需要补充以下信息。");
});

test("workbench dispatch calls knowledge tool and exposes auditable trace", async () => {
  let capturedQuery = "";
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "购买存货核算模块必须购买哪些相关模块？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => {
      throw new Error("kimi_should_not_be_called_for_knowledge_query");
    },
    knowledgeQuery: async (query) => {
      capturedQuery = query;
      return createKnowledgeTrace({ query });
    },
  });

  assert.equal(capturedQuery, "购买存货核算模块必须购买哪些相关模块？");
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.model, "GLM-5V-Turbo");
  assert.match(result.answer, /知识库参考/);
  assert.match(result.answer, /存货核算/);
  assert.match(result.answer, /不会自动改写正式估算/);
  assert.equal(result.trace.knowledgeTool?.toolId, "knowledge_base.query_product_knowledge");
  assert.equal(result.trace.knowledgeTool?.retrievalTriggered, true);
  assert.equal(result.trace.knowledgeTool?.confidence, "high");
  assert.equal(result.trace.knowledgeTool?.chunksCount, 5);
  assert.ok(result.trace.contextRefs.includes("knowledge:kb-sales:%E5%AD%98%E8%B4%A7:chunks=5:score=0.92"));
  assert.deepEqual(result.suggestedActions, []);
});

test("workbench dispatch falls back to model when knowledge tool has fallbackReason", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "智能会计平台是什么？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({
      answer: "⚠️ 知识库未检索到相关文档，以下为模型通用知识。智能会计平台是...",
      rawContent: "⚠️ 知识库未检索到相关文档，以下为模型通用知识。智能会计平台是...",
      provider: "kimi",
      model: "kimi-test",
    }),
    knowledgeQuery: async (query) => createKnowledgeTrace({
      available: false,
      query,
      answer: "智谱知识库配置不完整，当前无法读取知识库。",
      confidence: "low",
      retrievalTriggered: false,
      fallbackReason: "missing_config",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      contextRef: "knowledge:unconfigured:unavailable",
      chunksCount: 0,
      topScore: 0,
    }),
  });

  assert.equal(result.intent, "knowledge_query");
  assert.match(result.answer, /智谱知识库配置不完整/);
  assert.match(result.answer, /missing_config/);
  assert.match(result.answer, /智能会计平台/);
  assert.equal(result.trace.knowledgeTool?.available, false);
  assert.equal(result.trace.knowledgeTool?.fallbackReason, "missing_config");
  assert.ok(result.trace.contextRefs.includes("knowledge:unconfigured:unavailable"));
  assert.equal(result.trace.modelRun?.runKind, "knowledge_fallback");
});

test("workbench dispatch routes a strong keyword to one profile without route-model classification", async () => {
  let routeModelCalled = false;
  let selectedKnowledgeId = "";
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请查询知识库：网上银行实施边界怎么划分？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    knowledgeBaseCatalog: multiKnowledgeCatalog,
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("知识库路由器")) routeModelCalled = true;
      throw new Error("model_should_not_be_called");
    },
    knowledgeQuery: async (query, config?: any) => {
      selectedKnowledgeId = config?.knowledgeId || "";
      return createKnowledgeTrace({ query, knowledgeId: selectedKnowledgeId });
    },
  });

  assert.equal(routeModelCalled, false);
  assert.equal(selectedKnowledgeId, "kb-treasury");
  assert.equal(result.trace.knowledgeTool?.route?.mode, "rule");
  assert.equal(result.trace.knowledgeTool?.knowledgeBaseProfileId, "treasury");
});

test("workbench dispatch uses the model router only with authorized candidates", async () => {
  let routePrompt = "";
  let selectedKnowledgeId = "";
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请查询知识库，这个业务边界怎么判断？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    knowledgeBaseCatalog: multiKnowledgeCatalog,
    modelChat: async ({ systemPrompt, userContent }) => {
      if (systemPrompt.includes("知识库路由器")) {
        routePrompt = `${systemPrompt}\n${userContent}`;
        const raw = JSON.stringify({ knowledgeBaseId: "treasury", confidence: 0.88, reason: "涉及司库业务" });
        return { answer: raw, rawContent: raw };
      }
      return { answer: "通用回答", rawContent: "通用回答" };
    },
    knowledgeQuery: async (query, config?: any) => {
      selectedKnowledgeId = config?.knowledgeId || "";
      return createKnowledgeTrace({ query, knowledgeId: selectedKnowledgeId });
    },
  });

  assert.match(routePrompt, /treasury/);
  assert.doesNotMatch(routePrompt, /dev-private/);
  assert.equal(selectedKnowledgeId, "kb-treasury");
  assert.equal(result.trace.knowledgeTool?.route?.mode, "model");
});

test("workbench dispatch retries exactly one authorized fallback only for empty retrieval", async () => {
  const calls: string[] = [];
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请查询知识库：网上银行实施边界怎么划分？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    knowledgeBaseCatalog: multiKnowledgeCatalog,
    modelChat: async () => { throw new Error("model_should_not_be_called"); },
    knowledgeQuery: async (query, config?: any) => {
      calls.push(config?.knowledgeId || "");
      if (config?.knowledgeId === "kb-treasury") {
        return createKnowledgeTrace({
          query,
          knowledgeId: "kb-treasury",
          answer: "未检索到相关文档。",
          confidence: "low",
          fallbackReason: "retrieval_empty",
          chunksCount: 0,
          topScore: 0,
          contextRef: "knowledge:kb-treasury:empty",
        });
      }
      return createKnowledgeTrace({ query, knowledgeId: "kb-solutions" });
    },
  });

  assert.deepEqual(calls, ["kb-treasury", "kb-solutions"]);
  assert.equal(result.trace.knowledgeTool?.knowledgeBaseProfileId, "solutions");
  assert.equal(result.trace.knowledgeTool?.route?.attempts.length, 2);
  assert.equal(result.trace.knowledgeTool?.route?.fallbackProfileId, "solutions");
});

test("workbench dispatch does not fan out on provider failures", async () => {
  const calls: string[] = [];
  await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "请查询知识库：网上银行实施边界怎么划分？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    knowledgeBaseCatalog: multiKnowledgeCatalog,
    modelChat: async () => ({ answer: "⚠️ 通用知识", rawContent: "⚠️ 通用知识" }),
    knowledgeQuery: async (query, config?: any) => {
      calls.push(config?.knowledgeId || "");
      return createKnowledgeTrace({
        query,
        knowledgeId: config?.knowledgeId,
        confidence: "low",
        fallbackReason: "retrieval_failed",
        chunksCount: 0,
        topScore: 0,
      });
    },
  });

  assert.deepEqual(calls, ["kb-treasury"]);
});

test("workbench dispatch summarizes owner scoped project status and pending AI draft review", async () => {
  await withVersionsFixtures(async () => {
    const result = await dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: "我的评估状态和待确认动作有哪些？",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "kimi-test",
      modelChat: async () => {
        throw new Error("model_should_not_be_called_for_wes_data_query");
      },
    });

    assert.equal(result.intent, "wes_data_query");
    assert.match(result.answer, /状态汇总/);
    assert.match(result.answer, /草稿：1/);
    assert.match(result.answer, /评审中：1/);
    assert.match(result.answer, /待确认 AI 草稿：1/);
    assert.match(result.answer, /蓝海 WMS 项目/);
    assert.match(result.answer, /星河 ERP 项目/);
    assert.doesNotMatch(result.answer, /其他用户项目/);
    assert.ok(result.trace.contextRefs.includes("project:project-draft"));
    assert.ok(result.trace.contextRefs.includes("project:project-reviewing"));
    assert.equal(result.suggestedActions[0]?.actionType, "open_project_list");
  });
});

test("workbench dispatch exposes lightweight modelRun trace for attachment qa", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "parse_requirement_file",
    message: "这个附件里有哪些风险？",
    attachment: {
      name: "蓝海需求.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parsedSummary: "项目：蓝海 WMS\n业务需求：多组织库存协同\n风险：交付周期紧",
    },
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({
      answer: "主要风险是多组织库存协同边界和交付周期。",
      rawContent: "raw model payload",
      provider: "kimi",
      model: "kimi-test",
      attempts: 1,
      finishReason: "stop",
    }),
  });

  assert.equal(result.intent, "attachment_qa");
  assert.equal(result.trace.modelRun?.runKind, "attachment_qa");
  assert.equal(result.trace.modelRun?.provider, "kimi");
  assert.equal(result.trace.modelRun?.model, "kimi-test");
  assert.equal(result.trace.modelRun?.attempts, 1);
  assert.equal(result.trace.modelRun?.finishReason, "stop");
  assert.equal(result.trace.modelRun?.rawContentLength, "raw model payload".length);
  assert.ok(result.trace.modelRun?.latencyMs !== undefined);
  assert.ok(result.trace.modelRun?.contextRefs.includes("attachment:蓝海需求.xlsx"));
  assert.ok(result.trace.contextRefs.includes("attachment:蓝海需求.xlsx"));
});

// RP-025: 项目创建意图路由分发
test("workbench dispatch returns create_project_evaluation action with project name", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "帮我创建广州可味达项目",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({ answer: "", rawContent: "" }),
  });

  assert.equal(result.intent, "write_action_request");
  assert.equal(result.suggestedActions.length, 1);
  assert.equal(result.suggestedActions[0].actionType, "create_project_evaluation");
  assert.equal(result.suggestedActions[0].payload?.projectName, "广州可味达");
  assert.ok(result.answer.includes("广州可味达"));
});

test("workbench dispatch returns no suggested action for write action without project name", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "帮我创建评估草稿",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({ answer: "", rawContent: "" }),
  });

  assert.equal(result.intent, "write_action_request");
  assert.deepEqual(result.suggestedActions, []);
  assert.ok(result.answer.includes("项目"));
});

// ── RP-003: 模型意图分类兜底 ──────────────────────────────────

test("workbench dispatch uses model classification when rule fallback and model returns high confidence", async () => {
  let classificationCallCount = 0;
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "今天天气怎么样",  // 不匹配任何规则，兆底到 default_domain_qa
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      // 第一次调用是分类，第二次是实际回复
      if (systemPrompt.includes("意图分类器")) {
        classificationCallCount++;
        return {
          answer: JSON.stringify({ intent: "unsupported_or_out_of_scope", confidence: 0.9, reason: "无关闲聊" }),
          rawContent: "",
        };
      }
      return { answer: "模型回复", rawContent: "" };
    },
  });

  assert.equal(classificationCallCount, 1);
  assert.equal(result.intent, "unsupported_or_out_of_scope");
  assert.equal(result.trace.routingRule, "model_classification_fallback");
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.intent, "unsupported_or_out_of_scope");
  assert.equal(result.trace.modelClassification?.confidence, 0.9);
  assert.match(result.answer, /超出了我的能力范围/);
});

test("workbench dispatch falls back to domain_qa when model classification returns low confidence", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "这个风险是什么意思",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        return {
          answer: JSON.stringify({ intent: "domain_qa", confidence: 0.4, reason: "不确定" }),
          rawContent: "",
        };
      }
      return { answer: "这是业务风险解释", rawContent: "" };
    },
  });

  // 低置信度不替换 intent，继续走 domain_qa
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  // 但记录了分类结果
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.confidence, 0.4);
});

test("workbench dispatch falls back to domain_qa when model classification throws", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "随便问问",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        throw new Error("model unavailable");
      }
      return { answer: "模型回复", rawContent: "" };
    },
  });

  // 模型调用失败，降级回 domain_qa
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.equal(result.trace.modelClassification, undefined);
});

test("workbench dispatch does not call model classification when rule matches", async () => {
  let classificationCalled = false;
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "你能做什么",  // 匹配 capability_keywords，不触发分类
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        classificationCalled = true;
      }
      return { answer: "", rawContent: "" };
    },
  });

  assert.equal(classificationCalled, false);
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.trace.routingRule, "capability_keywords");
  assert.equal(result.trace.modelClassification, undefined);
});

// ── RP-049 Batch A: 分类兜底采纳条件收紧（白名单 + 0.85 阈值）────────────────────────────────

test("RP-049: capability classification at 0.9 is not adopted, stays domain_qa with model answer and trace record", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "我需要发什么类型的文件给你", // 不命中任何关键词规则，兜底到 default_domain_qa
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        return {
          answer: JSON.stringify({ intent: "capability_discovery", confidence: 0.9, reason: "询问可上传的文件类型" }),
          rawContent: "",
        };
      }
      return { answer: "你可以上传需求说明书、SOW 或 Excel 需求清单，我会基于文件内容协助解析。", rawContent: "" };
    },
  });

  // capability 不在采纳白名单：不替换意图，保持 domain_qa 模型自然回复
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.notEqual(result.model, "rule-static");
  assert.match(result.answer, /需求说明书/);
  // 分类结果未采纳也写入 trace
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.intent, "capability_discovery");
  assert.equal(result.trace.modelClassification?.confidence, 0.9);
});

test("RP-049: unsupported classification at 0.9 is adopted and returns static out-of-scope rejection", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "帮我写一首诗",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        return {
          answer: JSON.stringify({ intent: "unsupported_or_out_of_scope", confidence: 0.9, reason: "创作请求与系统能力无关" }),
          rawContent: "",
        };
      }
      throw new Error("model_should_not_be_called_after_unsupported_adoption");
    },
  });

  // 白名单内且 ≥ 0.85：采纳，返回超范围静态拒绝
  assert.equal(result.intent, "unsupported_or_out_of_scope");
  assert.equal(result.trace.routingRule, "model_classification_fallback");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /超出了我的能力范围/);
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.confidence, 0.9);
});

test("RP-049: unsupported classification below 0.85 threshold is not adopted, stays domain_qa", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "今天心情不错",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        return {
          answer: JSON.stringify({ intent: "unsupported_or_out_of_scope", confidence: 0.7, reason: "疑似闲聊但置信不足" }),
          rawContent: "",
        };
      }
      return { answer: "我可以协助需求解析、工作量评估与项目管理相关问题。", rawContent: "" };
    },
  });

  // 低于 0.85 阈值：不采纳，保持 domain_qa 模型回复
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.notEqual(result.model, "rule-static");
  assert.match(result.answer, /需求解析/);
  // 分类结果未采纳也写入 trace
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.intent, "unsupported_or_out_of_scope");
  assert.equal(result.trace.modelClassification?.confidence, 0.7);
});

test("RP-049: wes_data_query and write_action_request classifications are never adopted regardless of confidence", async () => {
  for (const classifiedIntent of ["wes_data_query", "write_action_request"] as const) {
    const result = await dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: "这个说法准确吗",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "kimi-test",
      modelChat: async ({ systemPrompt }) => {
        if (systemPrompt.includes("意图分类器")) {
          return {
            answer: JSON.stringify({ intent: classifiedIntent, confidence: 0.9, reason: "mock 分类结果" }),
            rawContent: "",
          };
        }
        return { answer: "模型自然回复：需要结合具体来源判断。", rawContent: "" };
      },
    });

    // 白名单外：任何置信度均不采纳，保持 domain_qa 模型自然回复
    assert.equal(result.intent, "domain_qa", `${classifiedIntent} 不应被采纳`);
    assert.equal(result.trace.routingRule, "default_domain_qa", `${classifiedIntent} 不应替换路由规则`);
    assert.notEqual(result.model, "rule-static");
    assert.match(result.answer, /模型自然回复/);
    // 分类结果未采纳也写入 trace
    assert.ok(result.trace.modelClassification, `${classifiedIntent} 分类结果应写入 trace`);
    assert.equal(result.trace.modelClassification?.intent, classifiedIntent);
  }
});

// ── RP-047 Batch B: 服务端 AbortSignal 取消安全边界 ────────────────

test("RP-047-B: pre-aborted signal rejects before any model call", async () => {
  const controller = new AbortController();
  controller.abort();
  let modelCalled = false;

  await assert.rejects(
    dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: "这个风险是什么意思",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "kimi-test",
      abortSignal: controller.signal,
      modelChat: async () => {
        modelCalled = true;
        return { answer: "不应到达", rawContent: "" };
      },
    }),
    (err: unknown) => err instanceof Error && err.name === "WorkbenchDispatchCancelledError",
  );
  assert.equal(modelCalled, false, "pre-aborted dispatch must never invoke the model");
});

test("RP-047-B: abort during streaming stops chunk consumption at the boundary", async () => {
  const controller = new AbortController();
  const receivedTokens: string[] = [];
  let onCompleteCalled = false;

  await assert.rejects(
    dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: "这个风险是什么意思",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "kimi-test",
      abortSignal: controller.signal,
      modelChat: async ({ systemPrompt }) => {
        // 分类阶段：信号未中止，正常返回低置信分类
        if (systemPrompt.includes("意图分类器")) {
          return {
            answer: JSON.stringify({ intent: "domain_qa", confidence: 0.4, reason: "不确定" }),
            rawContent: "",
          };
        }
        throw new Error("streaming path must not fall back to modelChat");
      },
      streamingAdapter: {
        onToken: (chunk) => {
          receivedTokens.push(chunk.contentDelta);
          controller.abort(); // 第一个 chunk 到达后请求取消
        },
        onComplete: () => {
          onCompleteCalled = true;
        },
      },
      modelChatStream: async function* () {
        yield { contentDelta: "chunk-1" };
        yield { contentDelta: "chunk-2" };
        yield { contentDelta: "chunk-3" };
      },
    }),
    (err: unknown) => err instanceof Error && err.name === "WorkbenchDispatchCancelledError",
  );

  assert.deepEqual(receivedTokens, ["chunk-1"], "no chunk may be delivered after the abort boundary");
  assert.equal(onCompleteCalled, false, "onComplete must not fire after cancellation");
});

test("RP-047-B: abort racing a pending non-streaming model call rejects as cancelled", async () => {
  const controller = new AbortController();

  await assert.rejects(
    (async () => {
      const pending = dispatchHomeWorkbenchTurn({
        user,
        workflowKey: "free_chat",
        message: "这个风险是什么意思", // 兜底 domain_qa，必经模型调用
        businessRole: "pre_sales",
        roleLabel: "售前顾问",
        model: "kimi-test",
        abortSignal: controller.signal,
        modelChat: async ({ systemPrompt }) => {
          // 模型迟迟不返回；取消应立即获胜，否则 dispatch 最终会正常完成
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          if (systemPrompt.includes("意图分类器")) {
            return {
              answer: JSON.stringify({ intent: "domain_qa", confidence: 0.4, reason: "不确定" }),
              rawContent: "",
            };
          }
          return { answer: "迟到的模型回复", rawContent: "" };
        },
      });
      controller.abort();
      return pending;
    })(),
    (err: unknown) => err instanceof Error && err.name === "WorkbenchDispatchCancelledError",
  );
});

// ── RP-047 Batch E · C3（异步通道漏带用户问题）：modelChat 工厂消息组装 ────────────────
// 缺陷：异步通道（harness workflow）不传会话历史，safeMessages 为空数组时
// userContent 从未进入发给模型的 messages，意图分类器与回答模型只看到 system prompt。

function createCapturingKimiProvider(): ModelProvider & { lastRequest?: ChatCompletionRequest } {
  return {
    name: "kimi",
    defaultModel: "mock",
    isAvailable: () => true,
    async chatCompletion(req): Promise<ChatCompletionResponse> {
      this.lastRequest = req;
      return { content: "mock-answer", rawContent: "mock-answer", model: "mock", provider: "kimi", attempts: 1 };
    },
  };
}

/** 快照需求系统配置 store 与 provider 注册表，注入测试 apiKey 与 mock provider，结束后原样恢复 */
async function withModelChatSandbox(run: (provider: ModelProvider & { lastRequest?: ChatCompletionRequest }) => Promise<void>): Promise<void> {
  // S3（2026-08-30）：requirementSettings 的状态源已从 config/system/*.json 换成
  // system_configs 单行，没有文件可快照。改用公共 accessor 做逻辑快照（与
  // assessment.service.test.ts 同口径）：为什么不用裸 SQL、代价与串行约束见彼处注释。
  // 本文件原保留的 versionsStorePath 快照已随 S4（2026-08-30）迁为 PG 行级种入
  // + 按 owner 清理（见 withVersionsFixtures）。
  const previousStore = await loadRequirementSystemConfigStore();
  const previousProvider = defaultProviderRegistry.get("kimi");
  const mockProvider = createCapturingKimiProvider();
  defaultProviderRegistry.register(mockProvider, { asDefault: true });
  try {
    // 阶段 1 批 5：store accessor 已异步化，补 await（断言不变）。
    const store = await loadRequirementSystemConfigStore();
    store.active.kimiCredentials = { apiKey: "test-fixture-key" };
    await saveRequirementSystemConfigStore(store);
    await run(mockProvider);
  } finally {
    await saveRequirementSystemConfigStore(previousStore);
    defaultProviderRegistry.unregister("kimi");
    if (previousProvider) defaultProviderRegistry.register(previousProvider);
  }
}

test("C3（异步通道漏带用户问题）: 空会话历史时 modelChat 发出的请求必须包含 role=user 且 content=userContent", async () => {
  await withModelChatSandbox(async (provider) => {
    // 异步通道（harness workflow）不传 messages —— 复现缺陷场景
    const modelChat = buildWorkbenchChatModelChat(user, {});
    await modelChat({ systemPrompt: "你是意图分类器。", userContent: "利润中心是什么" });

    const request = provider.lastRequest;
    assert.ok(request, "mock provider 应收到一次 chatCompletion 请求");
    const userMessages = request!.messages.filter((message) => message.role === "user");
    assert.equal(userMessages.length, 1, "messages 为空数组时也必须带上用户问题，否则模型只看到 system prompt");
    assert.equal(userMessages[0].content, "利润中心是什么");
    assert.equal(request!.messages[0].role, "system");
  });
});

test("C3（异步通道漏带用户问题）守护: 同步通道带会话历史时最后一条用户消息仍被 userContent 覆盖", async () => {
  await withModelChatSandbox(async (provider) => {
    const history: HomeMessageInput[] = [
      { role: "user", content: "上一轮问题", attachments: [] },
      { role: "assistant", content: "上一轮回答", attachments: [] },
      { role: "user", content: "本轮原始消息", attachments: [] },
    ];
    const modelChat = buildWorkbenchChatModelChat(user, { messages: history });
    await modelChat({ systemPrompt: "你是回答模型。", userContent: "本轮含附件上下文的完整问题" });

    const request = provider.lastRequest;
    assert.ok(request);
    // system + 3 条历史，最后一条被 userContent 覆盖（同步通道行为零变化）
    assert.equal(request!.messages.length, 4);
    assert.equal(request!.messages[0].role, "system");
    const last = request!.messages[request!.messages.length - 1];
    assert.equal(last.role, "user");
    assert.equal(last.content, "本轮含附件上下文的完整问题");
  });
});

// ── ISS-2026-08-10-005（回答 Markdown 格式散乱）：系统提示词排版规范 ──────────────
// 缺陷实证：落库原文为单行紧凑 pseudo-markdown（## 无空格、列表无换行），
// 两个 handler 的系统提示词仅要求「简洁回答」、无排版规范。提示词是劝导、解析器是兜底。

test("ISS-005: domain_qa 路径（model-answer）systemPrompt 含输出排版规范", async () => {
  let answerPrompt = "";
  await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "这个风险是什么意思", // 兜底 domain_qa
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      if (systemPrompt.includes("意图分类器")) {
        return {
          answer: JSON.stringify({ intent: "domain_qa", confidence: 0.4, reason: "不确定" }),
          rawContent: "",
        };
      }
      answerPrompt = systemPrompt;
      return { answer: "这是业务风险解释", rawContent: "" };
    },
  });

  assert.ok(answerPrompt, "domain_qa 回答模型应被调用");
  assert.match(answerPrompt, /【输出排版规范】/);
  assert.match(answerPrompt, /# 后必须有空格/);
  assert.match(answerPrompt, /列表项各自独占一行/);
});

test("ISS-005: knowledge fallback 路径（knowledge-query.handler）systemPrompt 含输出排版规范", async () => {
  let fallbackPrompt = "";
  await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "智能会计平台是什么？",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt }) => {
      fallbackPrompt = systemPrompt;
      return {
        answer: "⚠️ 知识库未检索到相关文档，以下为模型通用知识。智能会计平台是...",
        rawContent: "⚠️ 知识库未检索到相关文档，以下为模型通用知识。智能会计平台是...",
      };
    },
    knowledgeQuery: async (query) => createKnowledgeTrace({
      available: false,
      query,
      answer: "智谱知识库配置不完整，当前无法读取知识库。",
      confidence: "low",
      retrievalTriggered: false,
      fallbackReason: "missing_config",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      contextRef: "knowledge:unconfigured:unavailable",
      chunksCount: 0,
      topScore: 0,
    }),
  });

  assert.ok(fallbackPrompt, "knowledge fallback 回答模型应被调用");
  assert.match(fallbackPrompt, /【输出排版规范】/);
  assert.match(fallbackPrompt, /# 后必须有空格/);
  assert.match(fallbackPrompt, /列表项各自独占一行/);
});
