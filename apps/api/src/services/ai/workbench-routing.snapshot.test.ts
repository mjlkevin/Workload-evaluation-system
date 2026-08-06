// ============================================================
// O4 R3 前置快照测试集 — 意图路由 + 闸门判定行为锁定
// 目的：在 handler 化重构（纯结构搬迁）前锁定现状行为基线。
// 固定输入消息 → 断言固定意图与路由结果；覆盖全部 7 类 handler 意图。
// 任何一条快照在重构后发生变化即视为行为变更，必须停止并报告。
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser } from "../../types";
import { dispatchHomeWorkbenchTurn, type WorkbenchDispatchInput } from "./workbench-dispatch.service";
import { isExplicitReportRequest } from "./chat.service";
import type { ZhipuKnowledgeToolTrace } from "./knowledge-tool.service";

const user: AuthUser = {
  id: "user-o4-snapshot",
  username: "snapshot",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-08-06T00:00:00.000Z",
  lastLoginAt: "2026-08-06T00:00:00.000Z",
};

const STATIC_MODEL_CHAT: WorkbenchDispatchInput["modelChat"] = async () => {
  throw new Error("model_should_not_be_called_for_static_route");
};

const NATURAL_MODEL_CHAT: WorkbenchDispatchInput["modelChat"] = async () => ({
  answer: "模型自然回复：已结合上下文回答。",
  rawContent: "模型自然回复：已结合上下文回答。",
  provider: "kimi",
  model: "kimi-test",
});

function classifyingModelChat(classification: { intent: string; confidence: number; reason: string }): WorkbenchDispatchInput["modelChat"] {
  return async ({ systemPrompt }) => {
    if (systemPrompt.includes("意图分类器")) {
      return { answer: JSON.stringify(classification), rawContent: "" };
    }
    return {
      answer: "模型自然回复：已结合上下文回答。",
      rawContent: "模型自然回复：已结合上下文回答。",
      provider: "kimi",
      model: "kimi-test",
    };
  };
}

function baseInput(overrides: Partial<WorkbenchDispatchInput>): WorkbenchDispatchInput {
  return {
    user,
    workflowKey: "free_chat",
    message: "",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: NATURAL_MODEL_CHAT,
    ...overrides,
  };
}

function knowledgeTrace(query: string): ZhipuKnowledgeToolTrace {
  return {
    toolId: "knowledge_base.query_product_knowledge",
    available: true,
    model: "GLM-5V-Turbo",
    knowledgeId: "kb-solutions",
    query,
    answer: "存货核算通常需要结合库存管理、采购管理、应付和总账等模块确认边界。",
    confidence: "high",
    retrievalTriggered: true,
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    latencyMs: 10,
    contextRef: "knowledge:kb-solutions:snapshot:chunks=3:score=0.9",
    chunksCount: 3,
    topScore: 0.9,
    prompt: { id: "rag-answer", version: 1, hash: "b".repeat(64) },
    retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed", rerankStatus: 1, rerankModel: "rerank", fractionalThreshold: 0.2 },
  };
}

// ── 1. capability handler（能力发现）────────────────────────────────────

test("snapshot: 能力发现关键词 → capability_discovery / capability_keywords（静态，不调模型）", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "你能做什么",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.trace.routingRule, "capability_keywords");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /WES AI 工作台/);
  assert.equal(result.trace.modelClassification, undefined);
});

test("snapshot: 简短问候 → capability_discovery / greeting_keywords（静态，不调模型）", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "你好",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.trace.routingRule, "greeting_keywords");
  assert.equal(result.model, "rule-static");
});

// ── 2. wes-data-query handler（WES 数据查询）─────────────────────────────

test("snapshot: 查询自己的项目 → wes_data_query / wes_data_keywords（静态，不调模型）", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "我创建过哪些项目",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.trace.routingRule, "wes_data_keywords");
  assert.equal(result.model, "rule-static");
  assert.equal(result.suggestedActions[0]?.actionType, "open_project_list");
});

// ── 3. write-action handler（写动作确认 + stage 校验防护）─────────────────

test("snapshot: 带项目名的创建请求 → write_action_request，仅返回待确认动作", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "帮我创建广州可味达项目",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.trace.routingRule, "write_action_keywords");
  assert.equal(result.model, "rule-static");
  assert.equal(result.suggestedActions.length, 1);
  assert.equal(result.suggestedActions[0].actionType, "create_project_evaluation");
  assert.equal(result.suggestedActions[0].requiresConfirm, true);
  assert.equal(result.suggestedActions[0].payload?.projectName, "广州可味达");
});

test("snapshot: 无项目名的写动作 → write_action_request，confirm_write_action 需确认", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "帮我创建评估草稿",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.suggestedActions[0]?.actionType, "confirm_write_action");
  assert.equal(result.suggestedActions[0]?.requiresConfirm, true);
});

// ── 4. harness-report handler（报告生成 / v2 提交建议）─────────────────────

test("snapshot: 明确要求生成报告（无附件）→ harness_report_generation，仅建议动作不生成", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "生成需求解析报告",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "harness_report_generation");
  assert.equal(result.trace.routingRule, "report_generation_keywords");
  assert.equal(result.model, "rule-static");
  assert.equal(result.suggestedActions[0]?.actionType, "generate_requirement_report");
});

test("snapshot: 前端显式 clientAction 提交 → harness_answer_submission / client_action", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "提交补充信息",
    clientAction: "submit_structured_answers",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "harness_answer_submission");
  assert.equal(result.trace.routingRule, "client_action");
  assert.equal(result.suggestedActions[0]?.actionType, "submit_structured_answers");
});

test("snapshot: 已有 v1 报告时生成 v2 → harness_answer_submission / v2_explicit_keywords", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "生成 v2 报告",
    latestHarnessArtifact: { artifactType: "requirement_report_v1", harnessRunId: "run-v1" },
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(result.intent, "harness_answer_submission");
  assert.equal(result.trace.routingRule, "v2_explicit_keywords");
});

// ── 5. attachment-qa handler（附件问答 / 摘要，含"文件上传不触发工作流"）─────

const ATTACHMENT = {
  name: "蓝海需求.xlsx",
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  parsedSummary: "项目：蓝海 WMS\n业务需求：多组织库存协同\n风险：交付周期紧",
};

test("snapshot: 附件 + 提问 → attachment_qa / attachment_context，轻量 modelRun 不建 Harness Run", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "这个附件里有哪些风险？",
    attachment: ATTACHMENT,
    workflowKey: "parse_requirement_file",
  }));
  assert.equal(result.intent, "attachment_qa");
  assert.equal(result.trace.routingRule, "attachment_context");
  assert.equal(result.trace.modelRun?.runKind, "attachment_qa");
  assert.equal(result.trace.modelRun?.createsHarnessRun, false);
  assert.ok(result.trace.contextRefs.includes("attachment:蓝海需求.xlsx"));
});

test("snapshot: 附件 + 空消息 → attachment_summary / attachment_context", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "",
    attachment: ATTACHMENT,
  }));
  assert.equal(result.intent, "attachment_summary");
  assert.equal(result.trace.routingRule, "attachment_context");
  assert.equal(result.trace.modelRun?.runKind, "attachment_summary");
  assert.equal(result.trace.modelRun?.createsHarnessRun, false);
});

test("snapshot: 文件上传不触发工作流 — 附件 + 非报告类提问不进入报告生成路径", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "请帮我看看这份附件",
    attachment: ATTACHMENT,
  }));
  // 核心守护：上传文件仅提问时，意图保持 attachment_qa，绝不变成 harness_report_generation
  assert.equal(result.intent, "attachment_qa");
  assert.notEqual(result.intent, "harness_report_generation");
  assert.notEqual(result.intent, "harness_answer_submission");
  // 仅产生轻量 modelRun，不创建 Harness Run
  assert.equal(result.trace.modelRun?.createsHarnessRun, false);
});

// ── 6. knowledge-query handler（知识库查询）───────────────────────────────

test("snapshot: 产品知识问题 → knowledge_query / product_knowledge_terms（走知识库工具）", async () => {
  let capturedQuery = "";
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "购买存货核算模块必须购买哪些相关模块？",
    modelChat: STATIC_MODEL_CHAT,
    knowledgeQuery: async (query) => {
      capturedQuery = query;
      return knowledgeTrace(query);
    },
  }));
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.trace.routingRule, "product_knowledge_terms");
  assert.equal(capturedQuery, "购买存货核算模块必须购买哪些相关模块？");
  assert.equal(result.trace.knowledgeTool?.toolId, "knowledge_base.query_product_knowledge");
});

// ── 7. domain-qa handler（普通业务问答 + O10 Batch A 兜底采纳锁定）──────────

test("snapshot: 无规则命中 → domain_qa / default_domain_qa，模型自然回复", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "这个风险是什么意思",
    modelChat: classifyingModelChat({ intent: "domain_qa", confidence: 0.4, reason: "不确定" }),
  }));
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.notEqual(result.model, "rule-static");
  assert.match(result.answer, /模型自然回复/);
  // 分类结果无论是否采纳都写 trace
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.confidence, 0.4);
});

test("snapshot: O10 Batch A — 超范围分类 ≥0.85 被采纳 → unsupported_or_out_of_scope 静态拦截", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "帮我写一首诗",
    modelChat: classifyingModelChat({ intent: "unsupported_or_out_of_scope", confidence: 0.9, reason: "创作请求与系统能力无关" }),
  }));
  assert.equal(result.intent, "unsupported_or_out_of_scope");
  assert.equal(result.trace.routingRule, "model_classification_fallback");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /超出了我的能力范围/);
  assert.ok(result.trace.modelClassification);
});

test("snapshot: O10 Batch A — 白名单外分类（capability 0.9）不采纳，保持 domain_qa", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "我需要发什么类型的文件给你",
    modelChat: classifyingModelChat({ intent: "capability_discovery", confidence: 0.9, reason: "询问可上传的文件类型" }),
  }));
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.notEqual(result.model, "rule-static");
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.intent, "capability_discovery");
});

test("snapshot: O10 Batch A — 超范围分类低于 0.85 阈值不采纳，保持 domain_qa", async () => {
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "今天心情不错",
    modelChat: classifyingModelChat({ intent: "unsupported_or_out_of_scope", confidence: 0.7, reason: "疑似闲聊但置信不足" }),
  }));
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.ok(result.trace.modelClassification);
  assert.equal(result.trace.modelClassification?.confidence, 0.7);
});

// ── 后端闸门：isExplicitReportRequest（chat.service 内 2 处正则判定）────────

test("snapshot gate: isExplicitReportRequest — 明确报告请求判定", () => {
  assert.equal(isExplicitReportRequest("请生成需求解析报告"), true);
  assert.equal(isExplicitReportRequest("输出评估草稿"), true);
  assert.equal(isExplicitReportRequest("启动需求包整理"), true);
});

test("snapshot gate: isExplicitReportRequest — 非报告请求不误判", () => {
  assert.equal(isExplicitReportRequest("帮我看看这个报告"), false); // 无生成类动词
  assert.equal(isExplicitReportRequest("创建项目"), false); // 有动词但目标不是报告类
  assert.equal(isExplicitReportRequest("这个附件里有哪些风险？"), false);
  assert.equal(isExplicitReportRequest(""), false);
});
