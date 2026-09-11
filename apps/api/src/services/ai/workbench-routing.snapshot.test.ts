// ============================================================
// O4 R3 前置快照测试集 — 意图路由 + 闸门判定行为锁定
// 目的：在 handler 化重构（纯结构搬迁）前锁定现状行为基线。
// 固定输入消息 → 断言固定意图与路由结果。
// 本文件为 O4 结构搬迁的前置快照：搬迁不得改行为，任何变化即视为回归。
// 批次 4 是有意的行为变更（正则意图退役），受影响的两类快照已按批次 1a 的先例
// 改锁**新基线**（措辞不再被词表截走、模型确实被调用），并在每条旁注明退役理由；
// 未受影响的快照（寒暄 / 附件 / clientAction / 兜底 / 超范围采纳）逐字未动。
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
    modelChat: countingModelChat().chat,
  }));
  // 批次 4 退役：能力词表（capability_keywords）已删除，此类问法交回模型，
  // 由模型自行调用 describe_capabilities 工具取 CAPABILITY_FACTS 事实表。
  // 快照随之改锁新基线：模型被调用、不再产出 rule-static。
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.notEqual(result.intent, "capability_discovery");
  assert.notEqual(result.model, "rule-static");
  assert.match(result.answer, /模型自然回复/);
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

// 批次 4 退役：wes_data_keywords 词表整条删除。它原先把「我的项目 / 评估状态 /
// 待确认动作」等措辞一律判成项目列表查询，实取证伪两句：
//   · 「评估状态怎么流转？」是流程口径问题，却被回成一份项目清单；
//   · 「今天有哪些待确认动作？」handler 根本没有这个能力。
// 承接方 = 已注册的 project_list / estimate_history 工具（owner 隔离由注入的
// listProjectEvaluationsForUser(user, …) 保证，模型入参无从越权）。
for (const message of ["我创建过哪些项目", "我创建了什么项目", "评估状态怎么流转？"]) {
  test(`批次4退役快照：「${message}」不再被数据词表截走，模型确实被调用`, async () => {
    const modelChat = countingModelChat();
    const result = await dispatchHomeWorkbenchTurn(baseInput({ message, modelChat: modelChat.chat }));
    assert.notEqual(result.intent, "wes_data_query", "意图已退役");
    assert.equal(result.trace.routingRule, "default_domain_qa", `实取 ${JSON.stringify(result.trace)}`);
    assert.ok(modelChat.calls() >= 1, `退役后模型必须真的被调用，实取 ${modelChat.calls()} 次`);
    assert.deepEqual(
      result.suggestedActions.filter((action) => action.actionType === "open_project_list"),
      [],
      "静态 handler 的 open_project_list 建议动作不得再出现",
    );
  });
}

// ── 3.（批次 1a 退役）write-action handler 已下线：这类措辞必须真的走到模型 ──
// 原快照锁的是「正则命中 → 静态返回 create_project_evaluation 待确认动作」，
// 模型与工具在它之后永不被执行。本批把它退役，快照随之改为锁**新基线**：
// 模型被调用、dispatch 不再自行产出 create_project_evaluation 建议动作。
// 该能力的承接关系：用户点确认后由 create_project 工具 + 执行前审批闸门写入，
// 见 workbench-tool-approval.e2e.test.ts 判据①②（真库零副作用 → 确认后恰好一行）。

function countingModelChat(): { chat: WorkbenchDispatchInput["modelChat"]; calls: () => number } {
  let calls = 0;
  return {
    chat: async () => {
      calls += 1;
      return {
        answer: "模型自然回复：已结合上下文回答。",
        rawContent: "模型自然回复：已结合上下文回答。",
        provider: "kimi",
        model: "kimi-test",
      };
    },
    calls: () => calls,
  };
}

for (const message of ["帮我创建广州可味达项目", "帮我创建一个ERP项目"]) {
  test(`snapshot: 「${message}」→ 交回模型，dispatch 不再自行产出待确认动作`, async () => {
    const modelChat = countingModelChat();
    const result = await dispatchHomeWorkbenchTurn(baseInput({ message, modelChat: modelChat.chat }));
    assert.notEqual(result.intent, "write_action_request", "意图已退役");
    assert.equal(result.trace.routingRule, "default_domain_qa", `实取 ${JSON.stringify(result.trace)}`);
    assert.ok(modelChat.calls() >= 1, `退役后模型必须真的被调用（否则仍被正则截走），实取 ${modelChat.calls()} 次`);
    assert.deepEqual(
      result.suggestedActions.filter((action) => action.actionType === "create_project_evaluation"),
      [],
      "静态 handler 的 create_project_evaluation 建议动作不得再出现",
    );
  });
}

// ── 4. harness-report handler（报告生成 / v2 提交建议）─────────────────────

// 批次 4 退役 → command：报告词表（report_generation_keywords）删除。
// 它从未生成过报告：有附件时真实闸门是各通道的 isExplicitReportRequest（见文件末
// 的 gate 快照，本批逐字未动），无附件时它只回一句「请上传文件并点按钮」。
// 现在这句话交回模型，而**按钮**（clientAction=generate_requirement_report）成为唯一入口。
test("批次4退役快照：口头「生成需求解析报告」交回模型；按钮仍是显式入口", async () => {
  const spoken = countingModelChat();
  const result = await dispatchHomeWorkbenchTurn(baseInput({ message: "生成需求解析报告", modelChat: spoken.chat }));
  assert.notEqual(result.trace.routingRule, "report_generation_keywords", "该规则已下线");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.ok(spoken.calls() >= 1, "退役后模型必须真的被调用");

  const clicked = await dispatchHomeWorkbenchTurn(baseInput({
    message: "",
    clientAction: "generate_requirement_report",
    modelChat: STATIC_MODEL_CHAT,
  }));
  assert.equal(clicked.intent, "harness_report_generation");
  assert.equal(clicked.trace.routingRule, "client_action");
  assert.equal(clicked.suggestedActions[0]?.actionType, "generate_requirement_report");
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

test("批次4退役快照：已有 v1 时口头「生成 v2 报告」不再被词表判成提交动作", async () => {
  const v2 = countingModelChat();
  const result = await dispatchHomeWorkbenchTurn(baseInput({
    message: "生成 v2 报告",
    latestHarnessArtifact: { artifactType: "requirement_report_v1", harnessRunId: "run-v1" },
    modelChat: v2.chat,
  }));
  assert.notEqual(result.trace.routingRule, "v2_explicit_keywords", "该规则已下线");
  assert.equal(result.trace.routingRule, "default_domain_qa");
  assert.ok(v2.calls() >= 1);
  // v1 事实没有消失：它仍随 latestHarnessArtifact 进入上下文与模型提示词
  // （见 model-answer 的【已有 v1 报告】段），由模型判断该追问还是该补充；
  // 卡片提交本身仍走 clientAction（上一条快照守着）。
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

// 批次 4 退役：三条知识库词表（explicit / product / industry）整批删除，
// knowledge_query 意图随之从词汇表移除。承接方 = 已注册的 knowledge_query 工具；
// 该工具本批同时收口为按业务角色选库（见 default-registry.test.ts 的 runKnowledgeQuery 组）。
// 失效实证：「客户名称：X； 客户行业：Y；」这类对上一轮追问的回答，因含「行业」二字
// 曾被判成行业知识查询、模型压根收不到（批次 1c 的原始缺陷现场）。
for (const message of ["购买存货核算模块必须购买哪些相关模块？", "搜索知识库", "制造业财务共享中心的痛点有哪些？"]) {
  test(`批次4退役快照：「${message}」不再被知识库词表截走`, async () => {
    const modelChat = countingModelChat();
    const result = await dispatchHomeWorkbenchTurn(baseInput({ message, modelChat: modelChat.chat }));
    assert.notEqual(result.intent, "knowledge_query", "意图已退役");
    assert.equal(result.trace.routingRule, "default_domain_qa", `实取 ${JSON.stringify(result.trace)}`);
    assert.ok(modelChat.calls() >= 1, "退役后模型必须真的被调用（由其决定是否用 knowledge_query 工具）");
  });
}

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
