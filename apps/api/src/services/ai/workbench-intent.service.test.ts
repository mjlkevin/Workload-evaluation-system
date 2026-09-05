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

// ── 批次 1a：write_action_request 规则退役守护 ──────────────────────
// 原规则命中「写动作词 + 写目标词」即判 write_action_request 并交给静态 handler，
// 模型与工具在这一步之前就被绕过——只加审批闸门而不退役它，本批等于没做。
// 退役后这类措辞一律落到能被模型接管的路径（domain_qa 兜底 → 工具循环 → 执行前审批闸门）。
for (const message of ["进入正式评估", "发布正式需求记录", "帮我创建草稿"]) {
  test(`批次1a退役：「${message}」不再被写动作正则截走`, () => {
    const result = routeWorkbenchIntent({ message, hasAttachment: false, hasLatestV1Artifact: false });
    assert.notEqual(result.intent, "write_action_request", "该意图已下线");
    assert.notEqual(result.routingRule, "write_action_keywords", "该规则已下线");
    assert.equal(result.routingRule, "default_domain_qa", `必须交回模型，实取 ${JSON.stringify(result)}`);
  });
}

// 退役的连带影响（如实登记，不藏）：原规则 4 排在报告生成之前，会把
// 「创建评估草稿」这类措辞先截走；删掉它之后这类话落到报告生成规则。
// 这不是本批要修的路由设计（批次 4 整体退役正则时一并处理），但必须留痕：
// 有人在此断言被改成 domain_qa 时，说明报告生成规则也被动了。
test("批次1a连带影响：「帮我创建评估草稿」改由报告生成规则接管（不再经写动作规则）", () => {
  const result = routeWorkbenchIntent({ message: "帮我创建评估草稿", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.routingRule, "report_generation_keywords", `实取 ${JSON.stringify(result)}`);
  assert.equal(result.intent, "harness_report_generation");
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

// RP-025: 项目创建意图路由（批次 1a 起交回模型 + create_project 工具 + 审批闸门）
for (const message of ["帮我创建广州可味达项目", "新建一个项目", "创建项目评估", "帮我创建一个ERP项目"]) {
  test(`批次1a退役：「${message}」走模型路径（原 write_action_request）`, () => {
    const result = routeWorkbenchIntent({ message, hasAttachment: false, hasLatestV1Artifact: false });
    assert.equal(result.routingRule, "default_domain_qa", `实取 ${JSON.stringify(result)}`);
    assert.notEqual(result.intent, "write_action_request");
  });
}

test("批次1a退役：模型分类兜底也不采纳 write_action_request", async () => {
  // 词汇表已删该意图：模型就算这么答，也必须被判为无效分类（返回 null → 保持 domain_qa）
  const result = await classifyIntentWithModel("帮我创建一个ERP项目", async () => ({
    answer: JSON.stringify({ intent: "write_action_request", confidence: 0.99, reason: "自称写动作" }),
    rawContent: "",
  }));
  assert.equal(result, null, "已下线的意图不得被采纳");
});

test("批次1a退役：疑问句仍走数据查询，不得被误当成创建请求", () => {
  const result = routeWorkbenchIntent({ message: "我创建了什么项目", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
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
