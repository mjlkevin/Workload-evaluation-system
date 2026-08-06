import assert from "node:assert/strict";
import test from "node:test";
import { routeWorkbenchIntent, classifyIntentWithModel, INTENT_CLASSIFICATION_PROMPT } from "./workbench-intent.service";

test("routes capability discovery", () => {
  const result = routeWorkbenchIntent({ message: "你能做什么？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.routingRule, "capability_keywords");
});

test("routes capability discovery for '你可以做什么'", () => {
  const result = routeWorkbenchIntent({ message: "你可以做什么", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
});

test("routes simple greetings to local capability discovery", () => {
  const result = routeWorkbenchIntent({ message: "你好", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.routingRule, "greeting_keywords");
});

test("does not route post-v1 ordinary question to v2", () => {
  const result = routeWorkbenchIntent({ message: "这个风险是什么意思？", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.routingRule, "default_domain_qa");
});

test("routes explicit v2 generation only when requested with v1", () => {
  const result = routeWorkbenchIntent({ message: "请基于我补充的信息生成 v2 报告", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "harness_answer_submission");
});

test("does not route to v2 without explicit v2 keywords", () => {
  const result = routeWorkbenchIntent({ message: "这个模块怎么理解？", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "domain_qa");
});

test("routes attachment business question to attachment qa", () => {
  const result = routeWorkbenchIntent({ message: "多组织业务往来一般包含哪些模块？", hasAttachment: true, hasLatestV1Artifact: false });
  assert.equal(result.intent, "attachment_qa");
  assert.equal(result.routingRule, "attachment_context");
});

test("routes attachment with no text to attachment summary", () => {
  const result = routeWorkbenchIntent({ message: "", hasAttachment: true, hasLatestV1Artifact: false });
  assert.equal(result.intent, "attachment_summary");
});

test("routes WES data query", () => {
  const result = routeWorkbenchIntent({ message: "我之前创建过哪些项目？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.routingRule, "wes_data_keywords");
});

test("routes WES data query for '我的项目'", () => {
  const result = routeWorkbenchIntent({ message: "看看我的项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
});

test("routes pending WES action questions to data query", () => {
  const result = routeWorkbenchIntent({ message: "我有哪些待确认动作？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.routingRule, "wes_data_keywords");
});

// 查询句式回归：显式查询动词 / 疑问句式不得落入兜底 domain_qa 或被误判为写动作
test("routes '查询我建立的项目' to wes_data_query", () => {
  const result = routeWorkbenchIntent({ message: "查询我建立的项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.routingRule, "wes_data_keywords");
});

test("routes interrogative '我创建了什么项目' to wes_data_query instead of write_action", () => {
  const result = routeWorkbenchIntent({ message: "我创建了什么项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.routingRule, "wes_data_keywords");
});

test("routes '我建了哪些项目' to wes_data_query", () => {
  const result = routeWorkbenchIntent({ message: "我建了哪些项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
});

test("routes product knowledge questions to knowledge query", () => {
  const result = routeWorkbenchIntent({ message: "智能会计平台是什么，可以支持哪些模块？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.routingRule, "product_knowledge_terms");
  assert.ok(result.confidence >= 0.8);
});

test("routes product module dependency questions to knowledge query", () => {
  const result = routeWorkbenchIntent({ message: "购买存货核算模块必须购买哪些相关模块？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.routingRule, "product_knowledge_terms");
});

test("keeps owner-scoped project list questions as WES data queries before knowledge routing", () => {
  const result = routeWorkbenchIntent({ message: "我之前创建过哪些项目？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
  assert.equal(result.routingRule, "wes_data_keywords");
});

test("routes explicit report generation", () => {
  const result = routeWorkbenchIntent({ message: "请生成需求解析报告", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "harness_report_generation");
  assert.equal(result.routingRule, "report_generation_keywords");
});

test("routes explicit report generation with attachment", () => {
  const result = routeWorkbenchIntent({ message: "请基于这个文件生成需求解析报告", hasAttachment: true, hasLatestV1Artifact: false });
  assert.equal(result.intent, "harness_report_generation");
});

test("routes clientAction submit_structured_answers to harness_answer_submission", () => {
  const result = routeWorkbenchIntent({ message: "任意文本", hasAttachment: false, hasLatestV1Artifact: true, clientAction: "submit_structured_answers" });
  assert.equal(result.intent, "harness_answer_submission");
  assert.equal(result.routingRule, "client_action");
});

test("routes clientAction generate_requirement_report to harness_report_generation", () => {
  const result = routeWorkbenchIntent({ message: "任意文本", hasAttachment: false, hasLatestV1Artifact: false, clientAction: "generate_requirement_report" });
  assert.equal(result.intent, "harness_report_generation");
  assert.equal(result.routingRule, "client_action");
});

test("routes write action request for creating draft", () => {
  const result = routeWorkbenchIntent({ message: "帮我创建评估草稿", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.routingRule, "write_action_keywords");
});

test("routes write action request for entering formal estimation", () => {
  const result = routeWorkbenchIntent({ message: "进入正式评估", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "write_action_request");
});

test("routes write action request for publishing", () => {
  const result = routeWorkbenchIntent({ message: "发布正式需求记录", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "write_action_request");
});

test("default domain_qa for ordinary question after v1", () => {
  const result = routeWorkbenchIntent({ message: "这个风险是什么意思？", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "domain_qa");
});

test("v1 follow-up with '生成报告' routes to v2 submission", () => {
  const result = routeWorkbenchIntent({ message: "请生成需求解析报告", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "harness_answer_submission");
});

test("routes explicit knowledge base query to knowledge_query", () => {
  const result = routeWorkbenchIntent({ message: "帮我看看知识库中有没有与这份需求相关的解决方案", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.routingRule, "explicit_knowledge_query");
  assert.ok(result.confidence >= 0.8);
});

test("routes explicit knowledge base query for document search", () => {
  const result = routeWorkbenchIntent({ message: "文档有没有相关的方案", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.routingRule, "explicit_knowledge_query");
});

test("routes explicit knowledge base query for solution search", () => {
  const result = routeWorkbenchIntent({ message: "有没有相关文档", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.routingRule, "explicit_knowledge_query");
});

test("routes search knowledge base query", () => {
  const result = routeWorkbenchIntent({ message: "搜索知识库", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.routingRule, "explicit_knowledge_query");
});

// RP-025: 项目创建意图路由
test("routes create project with name to write_action_request", () => {
  const result = routeWorkbenchIntent({ message: "帮我创建广州可味达项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.routingRule, "write_action_keywords");
});

test("routes create project without name to write_action_request", () => {
  const result = routeWorkbenchIntent({ message: "新建一个项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.routingRule, "write_action_keywords");
});

test("routes create project evaluation to write_action_request", () => {
  const result = routeWorkbenchIntent({ message: "创建项目评估", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "write_action_request");
  assert.equal(result.routingRule, "write_action_keywords");
});

// ── RP-003: classifyIntentWithModel ──────────────────────────────────

test("classifyIntentWithModel returns classification when model returns valid JSON", async () => {
  const mockModelChat = async () => ({
    answer: JSON.stringify({ intent: "knowledge_query", confidence: 0.85, reason: "产品知识问题" }),
    rawContent: "",
  });
  const result = await classifyIntentWithModel("金蝶云是什么", mockModelChat);
  assert.ok(result);
  assert.equal(result.intent, "knowledge_query");
  assert.equal(result.confidence, 0.85);
  assert.equal(result.reason, "产品知识问题");
  assert.ok(result.latencyMs >= 0);
});

test("classifyIntentWithModel returns null when model throws", async () => {
  const mockModelChat = async () => { throw new Error("model unavailable"); };
  const result = await classifyIntentWithModel("test", mockModelChat);
  assert.equal(result, null);
});

test("classifyIntentWithModel returns null for unknown intent", async () => {
  const mockModelChat = async () => ({
    answer: JSON.stringify({ intent: "invalid_intent", confidence: 0.9, reason: "test" }),
    rawContent: "",
  });
  const result = await classifyIntentWithModel("test", mockModelChat);
  assert.equal(result, null);
});

test("classifyIntentWithModel returns null for non-JSON response", async () => {
  const mockModelChat = async () => ({
    answer: "这不是 JSON",
    rawContent: "",
  });
  const result = await classifyIntentWithModel("test", mockModelChat);
  assert.equal(result, null);
});

test("classifyIntentWithModel extracts JSON from mixed text", async () => {
  const mockModelChat = async () => ({
    answer: '根据分析，结果是 {"intent":"domain_qa","confidence":0.7,"reason":"普通业务问答"}',
    rawContent: "",
  });
  const result = await classifyIntentWithModel("这个风险是什么意思", mockModelChat);
  assert.ok(result);
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.confidence, 0.7);
});

test("INTENT_CLASSIFICATION_PROMPT contains all supported intents", () => {
  assert.match(INTENT_CLASSIFICATION_PROMPT, /capability_discovery/);
  assert.match(INTENT_CLASSIFICATION_PROMPT, /knowledge_query/);
  assert.match(INTENT_CLASSIFICATION_PROMPT, /domain_qa/);
  assert.match(INTENT_CLASSIFICATION_PROMPT, /unsupported_or_out_of_scope/);
});
