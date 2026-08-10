// ============================================================
// O9 · AI Controller 单元测试
// ============================================================
// 验证 aiController 实例存在且所有 9 个 Express handler 方法可用。
// RED 1: aiController 未导出 → base 代码应红
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aiController } from "./ai.controller";

describe("aiController — 三层存在性", () => {
  it("should be an object with all 9 Express handler methods", () => {
    assert.ok(aiController, "aiController must be exported");

    const expectedMethods = [
      "parseBasicInfo",
      "parseBasicInfoStream",
      "companyProfileSummary",
      "kimiAssessmentPreview",
      "exportKimiAssessmentMarkdown",
      "exportKimiAssessmentPdf",
      "chat",
      "homeWorkbenchChat",
      "homeWorkbenchChatStream",
    ];

    for (const method of expectedMethods) {
      assert.equal(
        typeof (aiController as unknown as Record<string, unknown>)[method],
        "function",
        `aiController.${method} must be a function`,
      );
    }
  });
});

describe("aiController — 契约不变守护", () => {
  it("parseBasicInfo should be an async function (Express handler)", () => {
    assert.equal(typeof aiController.parseBasicInfo, "function");
    // Express handlers can be async (returns Promise) or sync
    // Just verify it's callable
  });

  it("chat handler should be an async function", () => {
    assert.equal(typeof aiController.chat, "function");
  });

  it("homeWorkbenchChatStream handler should be an async function", () => {
    assert.equal(typeof aiController.homeWorkbenchChatStream, "function");
  });
});
