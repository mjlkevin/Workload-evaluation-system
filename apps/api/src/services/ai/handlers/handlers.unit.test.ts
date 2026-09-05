// ============================================================
// O4 S5：7 个 handler 的直接单元测试
// 不经 dispatch，逐 handler 断言其 intents 声明与输出契约，
// 保证搬迁后的 handler 可独立被分发器调用。
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser } from "../../../types";
import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchHandlerParams } from "./handler.types";
import { capabilityHandler } from "./capability.handler";
import { wesDataQueryHandler } from "./wes-data-query.handler";
import { writeActionHandler } from "./write-action.handler";
import { harnessReportHandler } from "./harness-report.handler";
import { knowledgeQueryHandler } from "./knowledge-query.handler";
import { attachmentQaHandler } from "./attachment-qa.handler";
import { domainQaHandler, unsupportedHandler } from "./domain-qa.handler";
import type { ZhipuKnowledgeToolTrace } from "../knowledge-tool.service";

const user: AuthUser = {
  id: "user-o4-handler-test",
  username: "handler-tester",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-08-06T00:00:00.000Z",
  lastLoginAt: "2026-08-06T00:00:00.000Z",
};

function makeContext(overrides: Partial<WorkbenchContext> = {}): WorkbenchContext {
  return {
    user: { id: user.id, username: user.username, role: user.role, capabilities: [] },
    visibleProjects: [],
    contextRefs: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<WorkbenchDispatchInput> = {}): WorkbenchDispatchInput {
  return {
    user,
    workflowKey: "free_chat",
    message: "测试消息",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({ answer: "模型回复", rawContent: "模型回复", provider: "kimi", model: "kimi-test" }),
    ...overrides,
  };
}

function paramsFor(intent: WorkbenchHandlerParams["intent"], input: WorkbenchDispatchInput, context?: WorkbenchContext): WorkbenchHandlerParams {
  return { intent, context: context ?? makeContext(), input };
}

const MODEL_CLASSIFICATION = { intent: "domain_qa", confidence: 0.4, reason: "单测注入", latencyMs: 1 };

test("capabilityHandler: intents 声明 + 静态能力回复 + modelClassification 透传", async () => {
  assert.deepEqual([...capabilityHandler.intents], ["capability_discovery"]);
  const result = await capabilityHandler.handle({
    ...paramsFor({ intent: "capability_discovery", confidence: 0.95, routingRule: "capability_keywords" }, makeInput()),
    modelClassification: MODEL_CLASSIFICATION,
  });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /WES AI 工作台/);
  assert.deepEqual(result.trace.modelClassification, MODEL_CLASSIFICATION);
});

test("wesDataQueryHandler: intents 声明 + owner 数据查询静态回复", async () => {
  assert.deepEqual([...wesDataQueryHandler.intents], ["wes_data_query"]);
  const result = await wesDataQueryHandler.handle(
    paramsFor({ intent: "wes_data_query", confidence: 0.9, routingRule: "wes_data_keywords" }, makeInput()),
  );
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.model, "rule-static");
  assert.equal(result.suggestedActions[0]?.actionType, "open_project_list");
});

test("writeActionHandler: 带项目名返回 create_project_evaluation 待确认动作", async () => {
  assert.deepEqual([...writeActionHandler.intents], ["write_action_request"]);
  const result = await writeActionHandler.handle(
    paramsFor(
      { intent: "write_action_request", confidence: 0.85, routingRule: "write_action_keywords" },
      makeInput({ message: "帮我创建广州可味达项目" }),
    ),
  );
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.suggestedActions[0]?.actionType, "create_project_evaluation");
  assert.equal(result.suggestedActions[0]?.requiresConfirm, true);
  assert.equal(result.suggestedActions[0]?.payload?.projectName, "广州可味达");
});

test("writeActionHandler: 疑问句提取出的垃圾名不生成任何确认动作", async () => {
  const result = await writeActionHandler.handle(
    paramsFor(
      { intent: "write_action_request", confidence: 0.85, routingRule: "write_action_keywords" },
      makeInput({ message: "我创建了什么项目" }),
    ),
  );
  assert.equal(result.intent, "write_action_request");
  assert.deepEqual(result.suggestedActions, []);
  assert.ok(result.answer.includes("项目"));
  assert.equal(result.answer.includes("写动作"), false);
});

test("harnessReportHandler: 覆盖报告生成与 v2 提交两类意图", async () => {
  assert.deepEqual([...harnessReportHandler.intents], ["harness_report_generation", "harness_answer_submission"]);
  const v1 = await harnessReportHandler.handle(
    paramsFor({ intent: "harness_report_generation", confidence: 0.9, routingRule: "report_generation_keywords" }, makeInput()),
  );
  assert.equal(v1.suggestedActions[0]?.actionType, "generate_requirement_report");
  const v2 = await harnessReportHandler.handle(
    paramsFor({ intent: "harness_answer_submission", confidence: 1, routingRule: "client_action" }, makeInput()),
  );
  assert.equal(v2.suggestedActions[0]?.actionType, "submit_structured_answers");
});

test("knowledgeQueryHandler: 调用注入的知识库工具并透出 knowledgeTool trace", async () => {
  assert.deepEqual([...knowledgeQueryHandler.intents], ["knowledge_query"]);
  const trace: ZhipuKnowledgeToolTrace = {
    toolId: "knowledge_base.query_product_knowledge",
    available: true,
    model: "GLM-5V-Turbo",
    knowledgeId: "kb-solutions",
    query: "存货核算相关模块",
    answer: "存货核算通常需要结合库存管理等模块。",
    confidence: "high",
    retrievalTriggered: true,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    latencyMs: 5,
    contextRef: "knowledge:kb-solutions:handler-test",
    chunksCount: 2,
    topScore: 0.8,
    prompt: { id: "rag-answer", version: 1, hash: "c".repeat(64) },
    retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed", rerankStatus: 1, rerankModel: "rerank", fractionalThreshold: 0.2 },
  };
  const result = await knowledgeQueryHandler.handle(
    paramsFor(
      { intent: "knowledge_query", confidence: 0.86, routingRule: "product_knowledge_terms" },
      makeInput({ knowledgeQuery: async () => trace }),
    ),
  );
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.trace.knowledgeTool?.toolId, "knowledge_base.query_product_knowledge");
  assert.match(result.answer, /知识库参考/);
});

test("attachmentQaHandler: 覆盖 attachment_qa/attachment_summary，产出轻量 modelRun", async () => {
  assert.deepEqual([...attachmentQaHandler.intents], ["attachment_qa", "attachment_summary"]);
  const context = makeContext({ contextRefs: ["attachment:需求.xlsx"] });
  const result = await attachmentQaHandler.handle({
    ...paramsFor(
      { intent: "attachment_qa", confidence: 0.8, routingRule: "attachment_context" },
      makeInput({ attachment: { name: "需求.xlsx", parsedSummary: "项目：X" } }),
      context,
    ),
    modelClassification: MODEL_CLASSIFICATION,
  });
  assert.equal(result.intent, "attachment_qa");
  assert.equal(result.trace.modelRun?.runKind, "attachment_qa");
  assert.equal(result.trace.modelRun?.createsHarnessRun, false);
  assert.deepEqual(result.trace.modelClassification, MODEL_CLASSIFICATION);
});

test("domainQaHandler: 模型自然回复 + modelClassification 透传", async () => {
  assert.deepEqual([...domainQaHandler.intents], ["domain_qa"]);
  const result = await domainQaHandler.handle({
    ...paramsFor({ intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" }, makeInput()),
    modelClassification: MODEL_CLASSIFICATION,
  });
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.answer, "模型回复");
  assert.deepEqual(result.trace.modelClassification, MODEL_CLASSIFICATION);
});

test("unsupportedHandler: 超范围静态拦截 + modelClassification 入 trace", async () => {
  assert.deepEqual([...unsupportedHandler.intents], ["unsupported_or_out_of_scope"]);
  const result = await unsupportedHandler.handle({
    ...paramsFor({ intent: "unsupported_or_out_of_scope", confidence: 0.9, routingRule: "model_classification_fallback" }, makeInput()),
    modelClassification: MODEL_CLASSIFICATION,
  });
  assert.equal(result.intent, "unsupported_or_out_of_scope");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /超出了我的能力范围/);
  assert.deepEqual(result.trace.modelClassification, MODEL_CLASSIFICATION);
});

// ─── ISS-2026-08-08-001: 静态报告 handler 文案上下文感知 ─────────────────────────

test("harnessReportHandler: 会话已有附件上下文时 v1 文案不再要求重新上传", async () => {
  const result = await harnessReportHandler.handle(
    paramsFor(
      { intent: "harness_report_generation", confidence: 0.9, routingRule: "report_generation_keywords" },
      makeInput(),
      makeContext({ contextRefs: ["attachment:存量附件.xlsx"] }),
    ),
  );
  assert.match(result.answer, /检测到会话已有附件《存量附件.xlsx》/);
  assert.match(result.answer, /生成需求解析报告/);
  assert.ok(!result.answer.includes("请上传需求文件"), "有附件上下文时不得再要求上传需求文件");
  assert.equal(result.suggestedActions[0]?.actionType, "generate_requirement_report");
});

test("harnessReportHandler: 无附件上下文时保留原上传引导文案", async () => {
  const result = await harnessReportHandler.handle(
    paramsFor(
      { intent: "harness_report_generation", confidence: 0.9, routingRule: "report_generation_keywords" },
      makeInput(),
      makeContext({ contextRefs: [] }),
    ),
  );
  assert.match(result.answer, /请上传需求文件/);
  assert.equal(result.suggestedActions[0]?.actionType, "generate_requirement_report");
});
