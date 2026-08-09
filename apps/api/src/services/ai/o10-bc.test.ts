// ============================================================
// O10 Batch C: 能力回复自然化与回归加固测试
// RED 先行 — 断言新行为，先跑红再实现。
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { routeWorkbenchIntent } from "./workbench-intent.service";
import { dispatchHomeWorkbenchTurn } from "./workbench-dispatch.service";
import { capabilityHandler } from "./handlers/capability.handler";
import type { AuthUser } from "../../types";

const user: AuthUser = {
  id: "user-o10-test",
  username: "kevin",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-08-09T00:00:00.000Z",
  lastLoginAt: "2026-08-09T00:00:00.000Z",
};

// ── Intent 层测试（≥5 类）────────────────────────────────────

// 1. 自然问法命中能力发现

test("O10-C: routes '你会干什么' to capability_discovery", () => {
  const result = routeWorkbenchIntent({ message: "你会干什么", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.routingRule, "capability_keywords");
});

test("O10-C: routes '你能帮我干啥' to capability_discovery", () => {
  const result = routeWorkbenchIntent({ message: "你能帮我干啥", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
});

test("O10-C: routes '支持哪些操作' to capability_discovery", () => {
  const result = routeWorkbenchIntent({ message: "支持哪些操作", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
});

// 2. 能力+业务混合意图不误判 — 先命中 capability，不落入 domain_qa

test("O10-C: '你会干什么，还有多组织业务往来' routes to capability_discovery (priority)", () => {
  const result = routeWorkbenchIntent({ message: "你会干什么，还有多组织业务往来怎么理解", hasAttachment: false, hasLatestV1Artifact: false });
  // capability_keywords 优先级高于 product_knowledge_terms
  assert.equal(result.intent, "capability_discovery");
});

// 3. Batch A unsupported_or_out_of_scope 行为不回退

test("O10-C: unsupported classification at 0.9 still adopted (Batch A not regressed)", async () => {
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
          answer: JSON.stringify({ intent: "unsupported_or_out_of_scope", confidence: 0.9, reason: "创作请求" }),
          rawContent: "",
        };
      }
      throw new Error("model_should_not_be_called");
    },
  });

  assert.equal(result.intent, "unsupported_or_out_of_scope");
  assert.equal(result.trace.routingRule, "model_classification_fallback");
  assert.match(result.answer, /超出了我的能力范围/);
});

// 4. 报告显式请求不误入 capability_reply

test("O10-C: explicit report request '生成需求解析报告' routes to harness_report_generation, not capability", () => {
  const result = routeWorkbenchIntent({ message: "生成需求解析报告", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "harness_report_generation");
  assert.equal(result.routingRule, "report_generation_keywords");
});

// 5. 问候语仍走 capability_discovery（硬口径零变更）

test("O10-C: greeting '你好' still routes to capability_discovery (unchanged)", () => {
  const result = routeWorkbenchIntent({ message: "你好", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.routingRule, "greeting_keywords");
});

// ── Dispatch / Handler 层测试（≥4 类）────────────────────────

// 6. 模型辅助路径：capability handler 调用 modelChat 并返回模型回复

test("O10-C: capability handler uses model-assisted reply when model returns valid answer", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "你能做什么",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt, userContent }) => {
      // 验证 system prompt 包含事实表约束
      assert.match(systemPrompt, /真实能力清单/);
      assert.match(systemPrompt, /禁止编造/);
      assert.match(userContent, /你能做什么/);
      return {
        answer: "我可以帮你上传文件、生成报告、查询项目数据等。",
        rawContent: "",
        model: "kimi-mock",
      };
    },
  });

  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.model, "kimi-mock");
  assert.match(result.answer, /上传文件/);
  // 旧模板文案不应再出现
  assert.ok(!result.answer.includes("WES AI 工作台"), "model-assisted reply should not contain old static template");
});

// 7. 降级路径：模型调用失败时返回结构化事实表摘要

test("O10-C: capability handler falls back to structured facts when model throws", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "你能做什么",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => {
      throw new Error("model unavailable");
    },
  });

  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /以下为能力清单摘要/);
  assert.match(result.answer, /上传需求文件/);
});

// 8. 降级路径：模型返回空内容时降级

test("O10-C: capability handler falls back when model returns empty answer", async () => {
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "你能做什么",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async () => ({
      answer: "   ",
      rawContent: "",
    }),
  });

  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /以下为能力清单摘要/);
});

// 9. 直接 handler 调用：验证 modelClassification 透传 + 降级标注

test("O10-C: capability handler direct call passes modelClassification and produces fallback on error", async () => {
  const modelClassification = { intent: "capability_discovery", confidence: 0.95, reason: "测试", latencyMs: 1 };
  const result = await capabilityHandler.handle({
    intent: { intent: "capability_discovery", confidence: 0.95, routingRule: "capability_keywords" },
    context: {
      user: { id: user.id, username: user.username, role: user.role, capabilities: [] },
      visibleProjects: [],
      contextRefs: [],
    },
    input: {
      user,
      workflowKey: "free_chat",
      message: "你会干什么",
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "kimi-test",
      modelChat: async () => { throw new Error("no model"); },
    },
    modelClassification,
  });

  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.model, "rule-static");
  assert.match(result.answer, /以下为能力清单摘要/);
  assert.deepEqual(result.trace.modelClassification, modelClassification);
});

// 10. 混合意图：附件+能力问法 → 能力发现优先（无附件时）

test("O10-C: capability question without attachment routes to capability, not attachment_qa", () => {
  const result = routeWorkbenchIntent({ message: "你有什么能力", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
});
