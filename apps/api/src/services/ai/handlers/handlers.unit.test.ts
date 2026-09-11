// ============================================================
// O4 S5：handler 的直接单元测试
// 不经 dispatch，逐 handler 断言其 intents 声明与输出契约，
// 保证搬迁后的 handler 可独立被分发器调用。
// （批次 1a：write_action_request 的正则 handler 已退役——「帮我创建XX项目」这类话
//  必须走到模型 + 工具 + 执行前审批闸门，被正则截走即等于闸门永远不被经过。）
// （批次 4：knowledgeQueryHandler / wesDataQueryHandler 连同其正则规则一并删除——
//  「该查知识库还是该查我的项目」是自然语言判断，交回模型选工具；本文件因此不再覆盖它们。
//  工具侧的对应断言见 agent/default-registry.test.ts 与 agent/tools/query.tools.test.ts。）
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser } from "../../../types";
import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchHandlerParams } from "./handler.types";
import { capabilityHandler } from "./capability.handler";
import { harnessReportHandler } from "./harness-report.handler";
import { attachmentQaHandler } from "./attachment-qa.handler";
import { domainQaHandler, unsupportedHandler } from "./domain-qa.handler";

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

// ─── 批次 4：正则退役后，幸存 handler 的契约边界 ───────────────────────────
// 退役改变的是「谁决定用哪个 handler」，不该改变 handler 自身的保证。
// 下面三条把这条口径钉住：接地事实仍强制、附件轻量审计仍记录、模型路径不伪造检索痕迹。

test("批次4：capability handler 仍把能力事实表原文压进 system prompt（防编造未实现能力）", async () => {
  let prompt = "";
  const result = await capabilityHandler.handle({
    ...paramsFor(
      { intent: "capability_discovery", confidence: 0.9, routingRule: "greeting_keywords" },
      makeInput({
        modelChat: async ({ systemPrompt }) => {
          prompt = systemPrompt;
          return { answer: "我可以帮你解析需求文件并生成报告。", rawContent: "" };
        },
      }),
    ),
  });
  assert.match(prompt, /唯一事实源/);
  assert.match(prompt, /禁止编造/);
  assert.match(prompt, /需求解析报告/, "事实表条目应随提示词一并送达");
  assert.equal(result.answer, "我可以帮你解析需求文件并生成报告。");
});

test("批次4：附件空消息走 attachment_summary，轻量审计口径与问答态同形", async () => {
  const result = await attachmentQaHandler.handle({
    ...paramsFor(
      { intent: "attachment_summary", confidence: 0.8, routingRule: "attachment_context" },
      makeInput({ message: "", attachment: { name: "需求.xlsx", parsedSummary: "项目：X" } }),
    ),
  });
  assert.equal(result.intent, "attachment_summary");
  assert.equal(result.trace.modelRun?.runKind, "attachment_summary");
  assert.equal(result.trace.modelRun?.createsHarnessRun, false, "上传附件仅提问不得建 Harness Run");
});

test("批次4：知识类问法改走 domain_qa 后，不伪造知识库检索痕迹", async () => {
  // 退役前这类句子由 knowledge-query handler 产出 trace.knowledgeTool；
  // 退役后落模型路径，若仍出现 knowledgeTool 即为凭空捏造的检索证据。
  const result = await domainQaHandler.handle(
    paramsFor({ intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" }, makeInput({ message: "存货核算必须购买哪些模块？" })),
  );
  assert.equal(result.trace.knowledgeTool, undefined);
  assert.equal(result.intent, "domain_qa");
});
