// ============================================================
// O10 Batch C: 能力回复自然化与回归加固测试
// RED 先行 — 断言新行为，先跑红再实现。
// ============================================================
// S3B1（2026-09-01，台账 B4 分诊）：接入 test:modules。原 10 条中删除 2 条重复——
//  - 「unsupported classification at 0.9 still adopted」：与
//    workbench-dispatch.service.test.ts:660（同场景 unsupported 0.9 采纳 +
//    model_classification_fallback + 「超出了我的能力范围」）完全等价 → 删；
//  - 「greeting '你好' still routes to capability_discovery」：与
//    workbench-intent.service.test.ts:16 完全重复 → 删。
// 其余 8 条为增量（新问法「你会干什么/你能帮我干啥/支持哪些操作/你有什么能力」
// 与 capability handler 模型辅助/降级路径，既有套件未覆盖）。

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
//
// 批次 4 口径变更（本文件原 1–4 条断言的是能力词表命中，该词表已整体退役）：
// 「你会干什么 / 支持哪些操作 / 你有什么能力」这类句子现在落兜底 domain_qa，
// 由模型自行决定是否调用 describe_capabilities 工具取能力事实表。
// 留在路由层的正则只剩锚定全串的寒暄，故 capability handler 的可达入口改用「你好」。
// 下面四条因此从「断言命中」改写为「断言不再命中」的退役守护（同批次 1a 的写法）。

// 1. 能力问法不再被词表截走

for (const message of ["你会干什么", "你能帮我干啥", "支持哪些操作", "你有什么能力"]) {
  test(`批次4退役：「${message}」不再由能力词表截走，交回模型`, () => {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.notEqual(result.routingRule, "capability_keywords", "该规则已下线");
    assert.notEqual(result.intent, "capability_discovery");
    assert.equal(result.routingRule, "default_domain_qa", `必须交回模型，实取 ${JSON.stringify(result)}`);
  });
}

// 1b. 原词表的夹带误伤面（退役理由的实证）：这些句子要的**不是**能力清单

for (const message of ["产品帮助文档在哪里？", "这个需求你能做什么样的拆解？", "我需要给新同事提供帮助清单"]) {
  test(`批次4退役：「${message}」曾被能力词表劫走，现交回模型`, () => {
    const result = routeWorkbenchIntent({ message, hasAttachment: false });
    assert.equal(result.intent, "domain_qa", `实取 ${JSON.stringify(result)}`);
  });
}

// 2. 能力+业务混合意图：批次 4 后两类句子同走模型路径，不存在「谁优先」

test("批次4退役：能力问法与业务问法混合时不再有优先级之争（两条规则都已退役）", () => {
  const result = routeWorkbenchIntent({ message: "你会干什么，还有多组织业务往来怎么理解", hasAttachment: false });
  assert.equal(result.routingRule, "default_domain_qa");
});

// 3. 报告请求改由 command 承接（词表退役，按钮保留）

test("批次4退役：「生成需求解析报告」不再被报告词表截走，改由按钮 command 承接", () => {
  const spoken = routeWorkbenchIntent({ message: "生成需求解析报告", hasAttachment: false });
  assert.notEqual(spoken.routingRule, "report_generation_keywords", "该规则已下线");
  assert.equal(spoken.routingRule, "default_domain_qa", `应交回模型，实取 ${JSON.stringify(spoken)}`);

  // 显式入口（前端按钮 = 结构化动作）必须仍然可达，且是**唯一**入口
  const clicked = routeWorkbenchIntent({ message: "", hasAttachment: false, clientAction: "generate_requirement_report" });
  assert.equal(clicked.intent, "harness_report_generation");
  assert.equal(clicked.routingRule, "client_action");
});

// 4. 问候语仍走 capability_discovery（硬口径零变更）
// （S3B1：原「greeting '你好'」用例与 workbench-intent.service.test.ts:16 重复，已删）

// ── Dispatch / Handler 层测试（≥4 类）────────────────────────

// 6. 模型辅助路径：capability handler 调用 modelChat 并返回模型回复

test("O10-C: capability handler uses model-assisted reply when model returns valid answer", async () => {
  // 批次 4：能力词表退役后，capability handler 经「锚定寒暄」这条保留规则可达。
  // handler 自身的职责（事实表接地 + 静态降级）不因入口变更而失效，断言原样保留。
  const result = await dispatchHomeWorkbenchTurn({
    user,
    workflowKey: "free_chat",
    message: "你好",
    businessRole: "pre_sales",
    roleLabel: "售前顾问",
    model: "kimi-test",
    modelChat: async ({ systemPrompt, userContent }) => {
      // 验证 system prompt 包含事实表约束
      assert.match(systemPrompt, /真实能力清单/);
      assert.match(systemPrompt, /禁止编造/);
      assert.match(userContent, /你好/);
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
    message: "你好",
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
    message: "你好",
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

// 10. 附件仍是结构判据：有附件时寒暄以外的任何问法都归附件问答（批次 4 保留项）

test("批次4保留：附件在场是服务端结构事实，不因问法措辞而改变归属", () => {
  const withAttachment = routeWorkbenchIntent({ message: "你有什么能力", hasAttachment: true });
  assert.equal(withAttachment.intent, "attachment_qa");
  assert.equal(withAttachment.routingRule, "attachment_context");
  // 同句无附件 → 交回模型（词表已退役）
  const withoutAttachment = routeWorkbenchIntent({ message: "你有什么能力", hasAttachment: false });
  assert.equal(withoutAttachment.intent, "domain_qa");
});
