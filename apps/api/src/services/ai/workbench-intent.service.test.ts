import assert from "node:assert/strict";
import test from "node:test";
import {
  routeWorkbenchIntent,
  classifyIntentWithModel,
  hasOngoingWorkbenchToolInteraction,
  INTENT_CLASSIFICATION_PROMPT,
} from "./workbench-intent.service";

// ============================================================
// 批次 4 · 正则意图退役后的路由契约
//
// 判据来自雷达文档 §三③：分的不是「规则 vs 模型谁更强」，而是**发起人是谁**。
// 本文件因此只剩三类断言：
//  ① 保留项仍在位（锚定寒暄 / 附件结构事实 / 前端 clientAction）；
//  ② 退役项确认没了（措辞一律落 default_domain_qa，交回模型 + 工具）；
//  ③ 批次 1a / 1c 的既有守护逐字不失效。
// 每条退役断言都附退役前实取到的误伤句子，见各组注释。
// ============================================================

// ── ① 保留项 ────────────────────────────────────────────────
// 保留的硬性理由（不是「怕出事」，逐条可查）：
//  · greeting_keywords —— 锚定全串 `^(…)$`，只有「整句就是寒暄」才命中，不存在被长句
//    夹带的形态；且 capability handler 是唯一在模型不可用时仍能静态应答的路径。
//  · attachment_context —— 判据是 `hasAttachment`，服务端从本轮是否带**已解析附件**得出，
//    压根没读用户说了什么。
//  · client_action —— 前端按钮提交的结构化动作，语义已由点击确定。

test("保留：锚定寒暄仍走本地能力说明", () => {
  const result = routeWorkbenchIntent({ message: "你好", hasAttachment: false });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.routingRule, "greeting_keywords");
});

test("保留：寒暄锚点是全串的，夹带在长句里不得命中", () => {
  for (const message of ["你好，我想问下存货核算怎么配", "在吗？我的项目进展如何"]) {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.routingRule, "greeting_keywords", `实取 ${JSON.stringify(result)}`);
  }
});

test("保留：附件在场是结构事实 → attachment_qa / attachment_summary", () => {
  const asked = routeWorkbenchIntent({ message: "多组织业务往来一般包含哪些模块？", hasAttachment: true });
  assert.equal(asked.intent, "attachment_qa");
  assert.equal(asked.routingRule, "attachment_context");

  const silent = routeWorkbenchIntent({ message: "", hasAttachment: true });
  assert.equal(silent.intent, "attachment_summary");
  assert.equal(silent.routingRule, "attachment_context");
});

test("保留：前端结构化动作优先于一切（含批次 1c 的让位短路）", () => {
  const submitted = routeWorkbenchIntent({ message: "提交补充信息", hasAttachment: false, clientAction: "submit_structured_answers" });
  assert.equal(submitted.intent, "harness_answer_submission");
  assert.equal(submitted.routingRule, "client_action");

  const generated = routeWorkbenchIntent({ message: "任意文本", hasAttachment: false, clientAction: "generate_requirement_report" });
  assert.equal(generated.intent, "harness_report_generation");
  assert.equal(generated.routingRule, "client_action");
});

// ── ② 退役项：措辞不再被词表截走 ─────────────────────────────

// capability_keywords 退役 → describe_capabilities 工具。
// 退役前实取的夹带误伤（三个都要的不是能力清单）：
//   「产品帮助文档在哪里？」命中「帮助」、「这个需求你能做什么样的拆解？」命中「能做什么」、
//   「我需要给新同事提供帮助清单」命中「帮助」。
test("退役：能力问法与夹带问法一律交回模型", () => {
  for (const message of [
    "你能做什么？",
    "你可以做什么",
    "你会干什么",
    "支持哪些操作",
    "产品帮助文档在哪里？",
    "这个需求你能做什么样的拆解？",
    "我需要给新同事提供帮助清单",
  ]) {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.routingRule, "capability_keywords", "该规则已下线");
    assert.equal(result.intent, "domain_qa", `「${message}」应交回模型，实取 ${JSON.stringify(result)}`);
  }
});

// wes_data_keywords 退役 → 已注册的 project_list / estimate_history 工具。
// 退役前实取的错配：「评估状态怎么流转？」是流程口径问题，却被回成一份项目清单；
// 「今天有哪些待确认动作？」静态 handler 根本没有这个能力，只会把项目列表吐回来。
test("退役：项目/评估类问法交回模型，由其选 project_list / estimate_history", () => {
  for (const message of [
    "我之前创建过哪些项目？",
    "看看我的项目",
    "我有哪些待确认动作？",
    "查询我建立的项目",
    "我创建了什么项目",
    "我建了哪些项目",
    "评估状态怎么流转？",
  ]) {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.intent, "wes_data_query", "意图已退役");
    assert.notEqual(result.routingRule, "wes_data_keywords", "该规则已下线");
    assert.equal(result.routingRule, "default_domain_qa", `「${message}」实取 ${JSON.stringify(result)}`);
  }
});

// 三条知识库词表退役 → 已注册的 knowledge_query 工具。
// 失效实证（批次 1c 的原始缺陷现场）：对上一轮追问的回答「客户名称：…； 客户行业：…；」
// 因含「行业」二字被判成行业知识查询，模型压根没收到这句话。
test("退役：知识/行业类问法交回模型，由其选 knowledge_query", () => {
  for (const message of [
    "智能会计平台是什么，可以支持哪些模块？",
    "购买存货核算模块必须购买哪些相关模块？",
    "帮我看看知识库中有没有与这份需求相关的解决方案",
    "文档有没有相关的方案",
    "有没有相关文档",
    "搜索知识库",
    "制造业财务共享中心的痛点有哪些？",
    "客户名称：深圳蓝海集团； 客户行业：综合集团；",
  ]) {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.intent, "knowledge_query", "意图已退役");
    assert.equal(result.routingRule, "default_domain_qa", `「${message}」实取 ${JSON.stringify(result)}`);
  }
});

// 报告两条词表退役 → command（前端按钮）。按钮分支仍在，见上方「保留」。
test("退役：口头报告请求交回模型；v1/v2 之分不再是路由判据", () => {
  for (const message of ["请生成需求解析报告", "生成需求解析报告", "帮我创建评估草稿", "帮我输出需求包"]) {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.routingRule, "report_generation_keywords", "该规则已下线");
    assert.equal(result.routingRule, "default_domain_qa", `「${message}」实取 ${JSON.stringify(result)}`);
  }
  // v2 词表同样退役：有 v1 artifact 与否都不再由路由判定
  const v2 = routeWorkbenchIntent({ message: "请基于我补充的信息生成 v2 报告", hasAttachment: false });
  assert.notEqual(v2.intent, "harness_answer_submission");
  assert.equal(v2.routingRule, "default_domain_qa");
});

// ── ②b 逐条规则名的退役确认（每条一个可独立失败的断言，失败信息直接指向规则）──
// 为什么按规则名单独拆：退役最怕「规则名字还在、行为已变」或反之。
// 每个规则名各配一句退役前必然命中它的话，断言该规则名再也产不出来。

const RETIRED_RULES: Array<{ rule: string; probe: string }> = [
  { rule: "capability_keywords", probe: "你能做什么" },
  { rule: "wes_data_keywords", probe: "我之前创建过哪些项目" },
  { rule: "report_generation_keywords", probe: "生成需求解析报告" },
  { rule: "report_generation_keywords_with_v1", probe: "生成需求解析报告" },
  { rule: "v2_explicit_keywords", probe: "生成 v2 报告" },
  { rule: "explicit_knowledge_query", probe: "搜索知识库" },
  { rule: "product_knowledge_terms", probe: "智能会计平台是什么" },
  { rule: "industry_knowledge_terms", probe: "制造业的痛点有哪些" },
];

for (const { rule, probe } of RETIRED_RULES) {
  test(`退役规则 ${rule} 再也产不出来（探针「${probe}」）`, () => {
    const result = routeWorkbenchIntent({ message: probe, hasAttachment: false });
    assert.notEqual(result.routingRule, rule, `该规则应已整体删除，实取 ${JSON.stringify(result)}`);
    assert.equal(result.routingRule, "default_domain_qa", `探针应落兜底，实取 ${JSON.stringify(result)}`);
  });
}

// ── ①b 保留规则的边界（逐条，防止「保留」被扩大解释）────────────

for (const greeting of ["你好", "您好", "hello", "HI", "嗨", "在吗", "你好！", "hi."]) {
  test(`保留：寒暄「${greeting}」仍命中锚定白名单`, () => {
    const result = routeWorkbenchIntent({ message: greeting, hasAttachment: false });
    assert.equal(result.routingRule, "greeting_keywords", `实取 ${JSON.stringify(result)}`);
    assert.equal(result.intent, "capability_discovery");
  });
}

for (const notGreeting of ["你好，帮我看下这份附件", "在吗？我的项目呢", "hello world 是什么", "嗨，存货核算怎么配"]) {
  test(`保留边界：「${notGreeting}」不得被寒暄锚点吃掉`, () => {
    const result = routeWorkbenchIntent({ message: notGreeting, hasAttachment: false });
    assert.notEqual(result.routingRule, "greeting_keywords", `锚定全串不得被夹带命中，实取 ${JSON.stringify(result)}`);
    assert.equal(result.routingRule, "default_domain_qa");
  });
}

test("保留：附件是结构判据——同一句话有附件时归附件问答，无附件时交回模型", () => {
  const message = "多组织业务往来一般包含哪些模块？";
  assert.equal(routeWorkbenchIntent({ message, hasAttachment: true }).intent, "attachment_qa");
  assert.equal(routeWorkbenchIntent({ message, hasAttachment: false }).intent, "domain_qa");
});

test("保留：寒暄优先于附件归属（有附件时问候仍是问候）", () => {
  const result = routeWorkbenchIntent({ message: "你好", hasAttachment: true });
  assert.equal(result.routingRule, "greeting_keywords", `实取 ${JSON.stringify(result)}`);
});

test("保留：clientAction 优先于寒暄与附件（结构化动作语义已定）", () => {
  const overGreeting = routeWorkbenchIntent({ message: "你好", hasAttachment: false, clientAction: "generate_requirement_report" });
  assert.equal(overGreeting.routingRule, "client_action");
  const overAttachment = routeWorkbenchIntent({ message: "随便说点什么", hasAttachment: true, clientAction: "submit_structured_answers" });
  assert.equal(overAttachment.routingRule, "client_action");
  assert.equal(overAttachment.intent, "harness_answer_submission");
});

// ── ③ 批次 1a 既有守护（write_action_request）─────────────────

for (const message of ["进入正式评估", "发布正式需求记录", "帮我创建草稿"]) {
  test(`批次1a退役：「${message}」不再被写动作正则截走`, () => {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.intent, "write_action_request", "该意图已下线");
    assert.notEqual(result.routingRule, "write_action_keywords", "该规则已下线");
    assert.equal(result.routingRule, "default_domain_qa", `必须交回模型，实取 ${JSON.stringify(result)}`);
  });
}

for (const message of ["帮我创建广州可味达项目", "新建一个项目", "创建项目评估", "帮我创建一个ERP项目"]) {
  test(`批次1a退役：「${message}」走模型路径（原 write_action_request）`, () => {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
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

// 批次 4 连带影响（如实登记）：批次 1a 曾把「帮我创建评估草稿」记为「改由报告生成规则接管」，
// 那是退役写动作词表后的残留落点。批次 4 把报告词表也撤了，该句因此直落兜底。
test("批次4连带：「帮我创建评估草稿」不再落到报告规则，直落兜底交回模型", () => {
  const result = routeWorkbenchIntent({ message: "帮我创建评估草稿", hasAttachment: false });
  assert.equal(result.routingRule, "default_domain_qa", `实取 ${JSON.stringify(result)}`);
});

// ── RP-003: classifyIntentWithModel ─────────────────────────

test("classifyIntentWithModel returns classification when model returns valid JSON", async () => {
  const mockModelChat = async () => ({
    answer: JSON.stringify({ intent: "domain_qa", confidence: 0.85, reason: "普通业务问答" }),
    rawContent: "",
  });
  const result = await classifyIntentWithModel("这个风险是什么意思", mockModelChat);
  assert.ok(result);
  assert.equal(result.intent, "domain_qa");
  assert.equal(result.confidence, 0.85);
  assert.equal(result.reason, "普通业务问答");
  assert.ok(result.latencyMs >= 0);
});

test("批次4：分类器不再往已退役的 knowledge_query / wes_data_query 桶里投", async () => {
  for (const retired of ["knowledge_query", "wes_data_query"]) {
    const result = await classifyIntentWithModel("测试", async () => ({
      answer: JSON.stringify({ intent: retired, confidence: 0.99, reason: "模型仍这么答" }),
      rawContent: "",
    }));
    assert.equal(result, null, `${retired} 已随正则退出词汇表，不得被采纳`);
  }
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
  assert.match(INTENT_CLASSIFICATION_PROMPT, /domain_qa/);
  assert.match(INTENT_CLASSIFICATION_PROMPT, /unsupported_or_out_of_scope/);
  // 批次 4：词汇表随正则收缩，两个已无生产方的桶不得再留在提示词里
  assert.doesNotMatch(INTENT_CLASSIFICATION_PROMPT, /knowledge_query/);
  assert.doesNotMatch(INTENT_CLASSIFICATION_PROMPT, /wes_data_query/);
});

// ── 批次 1c · 缺陷二：进行中的工具交互不得被意图路由劫走 ────────────────
// 两句原话取自真实会话 830bdb17-ceb8-421d-ba34-55e68ea31de6（架构侧直接调用
// routeWorkbenchIntent 实取）。批次 4 之后第二句已不再被词表劫走，因此本组改以
// **仍保留的寒暄规则**作为「短路确实盖住了保留规则」的判据——被劫走的对象变了，
// 短路本身的可观测性不降级。

/** 真实会话里的连续两句原话，逐字抄录，不做任何"顺手清洗" */
const REAL_TURN_CREATE = "帮我创建一个新的项目，项目名：测试项目09061112";
const REAL_TURN_ANSWER = "客户名称：深圳蓝海集团； 客户行业：综合集团；";

test("批次1c零回归：不在进行中的会话，两句话的分类结果仍逐字相同", () => {
  const first = routeWorkbenchIntent({ message: REAL_TURN_CREATE, hasAttachment: false });
  assert.deepEqual(first, { intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" });

  // 批次 4 后第二句也落同一处（词表已退役），故这里的相等是「两句话都交回模型」
  const second = routeWorkbenchIntent({ message: REAL_TURN_ANSWER, hasAttachment: false });
  assert.deepEqual(second, { intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" });
});

test("批次1c：进行中的工具交互时，保留的寒暄规则同样必须让位", () => {
  const without = routeWorkbenchIntent({ message: "你好", hasAttachment: false });
  assert.equal(without.routingRule, "greeting_keywords", "对照：不进行中被短路时寒暄规则本应命中");

  const result = routeWorkbenchIntent({ message: "你好", hasAttachment: false, hasOngoingToolInteraction: true });
  assert.equal(result.intent, "domain_qa", `应交回模型路径，实取 ${JSON.stringify(result)}`);
  assert.equal(result.routingRule, "ongoing_tool_interaction", `实取 ${JSON.stringify(result)}`);
});

test("批次1c：进行中短路覆盖所有保留规则，但不夺走前端结构化动作", () => {
  const hijackCandidates = [
    "你好",
    "在吗",
    "我之前创建过哪些项目？",
    "请生成需求解析报告",
    "智能会计平台是什么，可以支持哪些模块？",
    "搜索知识库",
    "多组织业务往来一般包含哪些模块？",
  ];
  for (const message of hijackCandidates) {
    const result = routeWorkbenchIntent({ message, hasAttachment: false, hasOngoingToolInteraction: true });
    assert.equal(result.routingRule, "ongoing_tool_interaction", `「${message}」未被短路，实取 ${JSON.stringify(result)}`);
    assert.equal(result.intent, "domain_qa");
  }
  // 有附件时短路同样要盖住 attachment_context（结构判据也在「让位」范围内）
  const attached = routeWorkbenchIntent({ message: REAL_TURN_ANSWER, hasAttachment: true, hasOngoingToolInteraction: true });
  assert.equal(attached.routingRule, "ongoing_tool_interaction");
  assert.equal(attached.intent, "domain_qa");

  // 结构化卡片提交不是"一句话"，是按钮：仍按 clientAction 走
  const structured = routeWorkbenchIntent({
    message: REAL_TURN_ANSWER,
    hasAttachment: false,
    clientAction: "submit_structured_answers",
    hasOngoingToolInteraction: true,
  });
  assert.equal(structured.routingRule, "client_action");
  assert.equal(structured.intent, "harness_answer_submission");
});

test("批次1c：进行中短路不得触发模型二次分类兜底", () => {
  // dispatch 只在 routingRule === "default_domain_qa" 时才调 classifyIntentWithModel。
  // 若本短路复用 default_domain_qa，一句残缺的「客户行业：综合集团」会被分类器
  // 判成 unsupported_or_out_of_scope 而直接拒答——那正是本批要消灭的劫走形态。
  const result = routeWorkbenchIntent({ message: REAL_TURN_ANSWER, hasAttachment: false, hasOngoingToolInteraction: true });
  assert.notEqual(result.routingRule, "default_domain_qa");
});

// ── hasOngoingWorkbenchToolInteraction：服务端事实判定 ──────────────────
// 本组是 check:session-history-parity 第 ④ 层的同源判据，批次 4 逐字未动。

test("进行中判定：最后一条 assistant 消息带工具痕迹即为 true", () => {
  const messages = [
    { role: "user", content: REAL_TURN_CREATE },
    { role: "assistant", content: "已创建", metadata: { toolCalls: [{ callIndex: 1, name: "create_project", status: "completed" }] } },
    { role: "user", content: REAL_TURN_ANSWER },
  ];
  assert.equal(hasOngoingWorkbenchToolInteraction(messages), true);
});

test("进行中判定：本轮用户消息之前的那条 assistant 才是判据（不看更早的轮次）", () => {
  const messages = [
    { role: "user", content: REAL_TURN_CREATE },
    { role: "assistant", content: "已创建", metadata: { toolCalls: [{ callIndex: 1, name: "create_project", status: "completed" }] } },
    { role: "user", content: "行业知识问题" },
    { role: "assistant", content: "制造业常见痛点是……" },
    { role: "user", content: REAL_TURN_ANSWER },
  ];
  assert.equal(hasOngoingWorkbenchToolInteraction(messages), false, "上一轮无工具痕迹即不得长期关掉正则路由");
});

test("进行中判定：空列表 / 无 assistant / 工具痕迹为空数组都判 false", () => {
  assert.equal(hasOngoingWorkbenchToolInteraction([]), false);
  assert.equal(hasOngoingWorkbenchToolInteraction(undefined), false);
  assert.equal(hasOngoingWorkbenchToolInteraction(null), false);
  assert.equal(hasOngoingWorkbenchToolInteraction([{ role: "user", content: "hi" }]), false);
  assert.equal(
    hasOngoingWorkbenchToolInteraction([{ role: "assistant", content: "hi", metadata: { toolCalls: [] } }]),
    false,
    "空数组是「本轮没有工具调用」，不是「有工具调用」",
  );
  assert.equal(
    hasOngoingWorkbenchToolInteraction([{ role: "assistant", content: "hi", metadata: { toolCalls: "not-an-array" } }]),
    false,
    "持久化字段形状异常时按未发生处理（失败方向关闭）",
  );
});
