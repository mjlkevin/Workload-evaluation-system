// ============================================================
// O9 · AI Usecase 单元测试
// ============================================================
// RED 2: aiUsecase 未导出 → base 代码应红
// RED 3: usecase.test.ts 覆盖意图路由分支 ≥2 条 → base 无该文件应红
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aiUsecase } from "./ai.usecase";

describe("aiUsecase — 三层存在性", () => {
  it("should be an object with business orchestration methods", () => {
    assert.ok(aiUsecase, "aiUsecase must be exported");
    assert.equal(typeof aiUsecase.chat, "function", "chat must be a function");
    assert.equal(typeof aiUsecase.companyProfileSummary, "function", "companyProfileSummary must be a function");
    assert.equal(typeof aiUsecase.kimiAssessmentPreview, "function", "kimiAssessmentPreview must be a function");
    assert.equal(typeof aiUsecase.buildAssessmentMarkdown, "function", "buildAssessmentMarkdown must be a function");
  });

  it("should expose delegated service handlers for streaming/complex operations", () => {
    assert.equal(typeof aiUsecase.parseBasicInfoHandler, "function", "parseBasicInfoHandler must be a function");
    assert.equal(typeof aiUsecase.homeWorkbenchChatHandler, "function", "homeWorkbenchChatHandler must be a function");
    assert.equal(typeof aiUsecase.homeWorkbenchChatStreamHandler, "function", "homeWorkbenchChatStreamHandler must be a function");
  });
});

// ─── 意图路由分支 1: chat ────────────────────────────────────
describe("aiUsecase.chat — 意图路由分支: 基础对话", () => {
  it("should return validation error for empty messages", async () => {
    const result = await aiUsecase.chat({ messages: [] });
    assert.ok("error" in result, "empty messages should return error");
    if ("error" in result) assert.equal(result.error.field, "messages");
  });

  it("should return validation error for messages with no content", async () => {
    const result = await aiUsecase.chat({
      messages: [
        { role: "user", content: "" },
        { role: "assistant", content: "" },
      ],
    });
    assert.ok("error" in result, "empty content messages should return error");
    if ("error" in result) assert.equal(result.error.field, "messages");
  });
});

// ─── 意图路由分支 2: companyProfileSummary ──────────────────
describe("aiUsecase.companyProfileSummary — 意图路由分支: 企业画像摘要", () => {
  it("should return validation error for empty customerName", async () => {
    const result = await aiUsecase.companyProfileSummary({
      customerName: "",
    });
    assert.ok("error" in result, "empty customerName should return error");
    if ("error" in result) assert.equal(result.error.field, "customerName");
  });

  it("should return validation error for whitespace-only customerName", async () => {
    const result = await aiUsecase.companyProfileSummary({
      customerName: "   ",
    });
    assert.ok("error" in result, "whitespace customerName should return error");
    if ("error" in result) assert.equal(result.error.field, "customerName");
  });
});

// ─── 意图路由分支 3: kimiAssessmentPreview ──────────────────
describe("aiUsecase.kimiAssessmentPreview — 意图路由分支: 评估预览", () => {
  it("should return validation error for empty snapshot", async () => {
    const result = await aiUsecase.kimiAssessmentPreview({
      requirementSnapshot: {},
    });
    assert.ok("error" in result, "empty snapshot should return error");
    if ("error" in result) assert.equal(result.error.field, "requirementSnapshot");
  });
});

// ─── 意图路由分支 4: buildAssessmentMarkdown ────────────────
describe("aiUsecase.buildAssessmentMarkdown — 意图路由分支: 导出 Markdown", () => {
  it("should return error for empty assessmentDraft", () => {
    const result = aiUsecase.buildAssessmentMarkdown({
      assessmentDraft: {},
    });
    assert.ok("error" in result, "empty draft should return error");
    if ("error" in result) {
      assert.equal(result.error.field, "assessmentDraft");
    }
  });

  it("should return markdown string for valid draft", () => {
    const result = aiUsecase.buildAssessmentMarkdown({
      assessmentDraft: { productLines: ["财务云"], moduleItems: [{ cloudProduct: "金蝶云", skuName: "GL", standardDays: 5, suggestedDays: 6 }] },
      projectName: "测试项目",
    });
    assert.ok(!("error" in result), "valid draft should not return error");
    if ("markdown" in result) {
      assert.equal(typeof result.markdown, "string", "markdown must be a string");
      assert.ok(result.markdown.length > 0, "markdown must not be empty");
    }
  });
});
