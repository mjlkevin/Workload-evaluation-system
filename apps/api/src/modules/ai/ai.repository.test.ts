// ============================================================
// O9 · AI Repository 单元测试
// ============================================================
// 验证 aiRepository 实例存在且提供数据访问方法。
// RED 1: aiRepository 未导出 → base 代码应红
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aiRepository } from "./ai.repository";

describe("aiRepository", () => {
  it("should be an object with data access methods", () => {
    assert.ok(aiRepository, "aiRepository must be exported");
    assert.equal(typeof aiRepository.loadRequirementSettings, "function", "loadRequirementSettings must be a function");
    assert.equal(typeof aiRepository.resolveApiKey, "function", "resolveApiKey must be a function");
  });

  it("loadRequirementSettings returns a store with .active property", async () => {
    // 阶段 1 批 5：loadRequirementSettings 已返回 Promise，补 await（断言不变）。
    const store = await aiRepository.loadRequirementSettings();
    assert.ok(store, "store must be truthy");
    assert.ok(store.active, "store.active must exist");
    assert.ok(store.active.kimiEvaluation, "store.active.kimiEvaluation must exist");
  });

  it("resolveApiKey returns an object with apiKey field", () => {
    const result = aiRepository.resolveApiKey();
    assert.ok(result, "result must be truthy");
    assert.equal(typeof result, "object", "result must be an object");
    // apiKey may be empty string in test env, but the field must exist
    assert.ok("apiKey" in result, "result must have apiKey field");
  });
});
