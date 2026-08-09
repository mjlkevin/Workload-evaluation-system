// ============================================================
// Sprint 3B · RP-048 骨架 — AI 输出质量回归基线测试运行器
// node:test 形式，纳入 npm run test:ai
// 本批全部为确定性断言，零 LLM 外部依赖
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser } from "../../../types";
import { dispatchHomeWorkbenchTurn } from "../workbench-dispatch.service";
import { routeWorkbenchIntent } from "../workbench-intent.service";
import { EVAL_SAMPLES, getSampleStats } from "./samples";
import { runAssertionsForSample, summarizeResults } from "./assertions";

const user: AuthUser = {
  id: "user-eval-001",
  username: "eval-test",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-08-09T00:00:00.000Z",
  lastLoginAt: "2026-08-09T00:00:00.000Z",
};

/** 为超范围样本提供模型分类兜底的 mock modelChat */
function createMockModelChatForSample(sampleId: string) {
  return async ({ systemPrompt }: { systemPrompt: string; userContent: string }) => {
    // 意图分类器调用：为超范围样本返回高置信 unsupported
    if (systemPrompt.includes("意图分类器")) {
      if (sampleId === "oos-001") {
        return {
          answer: JSON.stringify({ intent: "unsupported_or_out_of_scope", confidence: 0.9, reason: "创作请求与系统能力无关" }),
          rawContent: "",
        };
      }
      if (sampleId === "oos-002") {
        return {
          answer: JSON.stringify({ intent: "unsupported_or_out_of_scope", confidence: 0.92, reason: "天气查询与系统能力无关" }),
          rawContent: "",
        };
      }
      // 其他样本不应触发分类（规则路由已命中），若触发返回低置信 domain_qa
      return {
        answer: JSON.stringify({ intent: "domain_qa", confidence: 0.4, reason: "规则已命中，分类兜底不采纳" }),
        rawContent: "",
      };
    }

    // 普通模型调用（domain_qa / capability 等路径）
    return {
      answer: `[mock] 模型回复样本 ${sampleId}`,
      rawContent: "",
      model: "eval-mock",
    };
  };
}

// ── 样本集元数据校验 ────────────────────────────────────────

test("RP-048: sample set meets minimum requirements", () => {
  const stats = getSampleStats();
  assert.ok(stats.total >= 12, `样本总数 ${stats.total} 应 >= 12`);

  const categoryCount = Object.keys(stats.categories).length;
  assert.ok(categoryCount >= 6, `场景分类数 ${categoryCount} 应 >= 6`);

  // 验证覆盖要求的场景
  const requiredCategories = [
    "capability_discovery",
    "greeting",
    "explicit_report_request",
    "business_consultation",
    "attachment_qa_guidance",
    "out_of_scope",
  ];
  for (const cat of requiredCategories) {
    assert.ok(stats.categories[cat] !== undefined, `缺少必需场景: ${cat}`);
    assert.ok(stats.categories[cat] >= 1, `场景 ${cat} 至少需 1 条样本`);
  }
});

// ── Intent 路由层基线测试（规则路由，零模型调用）──────────────

test("RP-048: intent routing baseline — capability discovery", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "capability_discovery")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
    if (sample.expectedRoutingRule) {
      assert.equal(result.routingRule, sample.expectedRoutingRule, `样本 ${sample.id}: routingRule 不匹配`);
    }
  }
});

test("RP-048: intent routing baseline — greeting", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "greeting")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
  }
});

test("RP-048: intent routing baseline — explicit report request", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "explicit_report_request")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
  }
});

test("RP-048: intent routing baseline — business consultation", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "business_consultation")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
  }
});

test("RP-048: intent routing baseline — attachment qa guidance", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "attachment_qa_guidance")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
  }
});

test("RP-048: intent routing baseline — knowledge query", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "knowledge_query")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
  }
});

test("RP-048: intent routing baseline — wes data query", () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "wes_data_query")) {
    const result = routeWorkbenchIntent({
      message: sample.message,
      hasAttachment: Boolean(sample.hasAttachment),
      hasLatestV1Artifact: Boolean(sample.hasLatestV1Artifact),
      clientAction: sample.clientAction,
    });
    assert.equal(result.intent, sample.expectedIntent, `样本 ${sample.id}: intent 路由错误`);
  }
});

// ── Dispatch 端到端基线测试（含模型 mock）─────────────────────

test("RP-048: dispatch end-to-end baseline — all samples pass assertions", async () => {
  const results = [];

  for (const sample of EVAL_SAMPLES) {
    const mockModelChat = createMockModelChatForSample(sample.id);

    const dispatchResult = await dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: sample.message,
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "eval-mock",
      modelChat: mockModelChat,
      ...(sample.hasAttachment
        ? {
            attachment: {
              name: "test-attachment.xlsx",
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              parsedSummary: "测试附件摘要",
            },
          }
        : {}),
    });

    const assertionResult = runAssertionsForSample(sample, dispatchResult);
    results.push(assertionResult);

    // 单样本断言失败时输出诊断信息，但不立即抛错（让全部样本跑完）
    if (!assertionResult.allPassed) {
      const failed = assertionResult.assertions.filter((a) => !a.pass);
      console.error(`\n[FAIL] 样本 ${sample.id} (${sample.category}):`);
      for (const f of failed) {
        console.error(`  - ${f.label}: ${f.detail}`);
      }
    }
  }

  const summary = summarizeResults(results);

  // 最终断言：全部样本通过
  assert.equal(
    summary.failedSamples,
    0,
    `\n${summary.failedSamples}/${summary.totalSamples} 样本断言失败\n` +
      summary.failures
        .map(
          (f) =>
            `  - ${f.sampleId} (${f.category}): ${f.failedLabels.join(", ")}\n    ${f.details.join("\n    ")}`,
        )
        .join("\n"),
  );

  // 统计摘要输出
  console.log(
    `\n[RP-048 基线结果] 样本: ${summary.passedSamples}/${summary.totalSamples} 通过, ` +
      `断言: ${summary.passedAssertions}/${summary.totalAssertions} 通过`,
  );
});

// ── 专项断言：超范围拦截 ────────────────────────────────────

test("RP-048: out-of-scope samples are intercepted with unsupported_or_out_of_scope", async () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "out_of_scope")) {
    const mockModelChat = createMockModelChatForSample(sample.id);

    const result = await dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: sample.message,
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "eval-mock",
      modelChat: mockModelChat,
    });

    assert.equal(
      result.intent,
      "unsupported_or_out_of_scope",
      `样本 ${sample.id} 应被拦截为 unsupported_or_out_of_scope`,
    );
    assert.equal(result.trace.routingRule, "model_classification_fallback", `样本 ${sample.id} 应走模型分类兜底`);
    assert.equal(result.model, "rule-static", `样本 ${sample.id} 应为静态回复`);
    assert.match(result.answer, /超出了我的能力范围/, `样本 ${sample.id} 回复应包含超范围提示`);
  }
});

// ── 专项断言：报告请求路由 ──────────────────────────────────

test("RP-048: report request samples route to harness_report_generation", async () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "explicit_report_request")) {
    const mockModelChat = createMockModelChatForSample(sample.id);

    const result = await dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: sample.message,
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "eval-mock",
      modelChat: mockModelChat,
    });

    assert.equal(
      result.intent,
      "harness_report_generation",
      `样本 ${sample.id} 应路由到 harness_report_generation`,
    );
    assert.ok(result.answer.length > 0, `样本 ${sample.id} 回复不应为空`);
  }
});

// ── 专项断言：capability 回复事实表边界 ──────────────────────

test("RP-048: capability discovery replies stay within CAPABILITY_FACTS bounds", async () => {
  for (const sample of EVAL_SAMPLES.filter((s) => s.category === "capability_discovery" || s.category === "greeting")) {
    const mockModelChat = createMockModelChatForSample(sample.id);

    const result = await dispatchHomeWorkbenchTurn({
      user,
      workflowKey: "free_chat",
      message: sample.message,
      businessRole: "pre_sales",
      roleLabel: "售前顾问",
      model: "eval-mock",
      modelChat: mockModelChat,
    });

    assert.equal(result.intent, "capability_discovery", `样本 ${sample.id} 应为 capability_discovery`);
    assert.ok(result.answer.length >= 1, `样本 ${sample.id} 回复不应为空`);
    assert.ok(result.answer.length <= 2000, `样本 ${sample.id} 回复不应过长`);

    // 启发式：不应包含明显越界承诺
    const overpromiseKeywords = ["写诗", "作诗", "编程", "画图", "天气预报", "股票"];
    for (const kw of overpromiseKeywords) {
      assert.ok(
        !result.answer.includes(kw),
        `样本 ${sample.id} 不应包含越界承诺: ${kw}`,
      );
    }
  }
});
