import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { AuthUser, KnowledgeBaseProfile } from "../../types";
import { versionsStorePath } from "../../utils";
import { dispatchHomeWorkbenchTurn } from "./workbench-dispatch.service";
import type { ZhipuKnowledgeToolTrace } from "./knowledge-tool.service";

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

async function withVersionsSnapshot(run: () => Promise<void>): Promise<void> {
  const filePath = versionsStorePath();
  const existed = fs.existsSync(filePath);
  const before = existed ? fs.readFileSync(filePath, "utf-8") : "";
  try {
    await run();
  } finally {
    if (existed) {
      fs.writeFileSync(filePath, before, "utf-8");
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function writeProjectEvaluationFixtures() {
  fs.writeFileSync(versionsStorePath(), JSON.stringify({
    records: [
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
    ],
  }, null, 2), "utf-8");
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
  await withVersionsSnapshot(async () => {
    writeProjectEvaluationFixtures();

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

test("workbench dispatch returns confirm_write_action for write action without project name", async () => {
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
  assert.equal(result.suggestedActions.length, 1);
  assert.equal(result.suggestedActions[0].actionType, "confirm_write_action");
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
