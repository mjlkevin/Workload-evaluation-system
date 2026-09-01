// ============================================================
// O9 · AI Repository 单元测试
// ============================================================
// 验证 aiRepository 实例存在且提供数据访问方法。
// RED 1: aiRepository 未导出 → base 代码应红
// ============================================================
// S3B1（2026-09-01，台账 B4 分诊）：接入 test:modules:serial-store。
// loadRequirementSettings 走默认 db 单例（DATABASE_URL）读 system_configs 单文档表，
// 且缺行返回 null——必须自种 fixture 再断言，并与串行组其他写者互斥（白名单登记
// 见 test-helpers/single-doc-serial-scope.drift.test.ts）。

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { aiRepository } from "./ai.repository";
import {
  normalizeRequirementSystemConfig,
  saveRequirementSystemConfigStore,
} from "../system/system.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let pool: Pool | null = null;

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 3 });
  // 自种 requirementSettings 行（load 缺行返回 null，断言依赖行存在）
  const seed = normalizeRequirementSystemConfig({ kimiCredentials: { apiKey: "" } });
  const now = new Date().toISOString();
  await saveRequirementSystemConfigStore({
    version: 1,
    draft: seed,
    active: seed,
    updatedAt: now,
    effectiveAt: now,
  });
});

after(async () => {
  if (pool) {
    await pool.query("DELETE FROM system_configs WHERE config_key = 'requirementSettings'");
    await pool.end();
  }
});

describe("aiRepository", () => {
  it("should be an object with data access methods", () => {
    assert.ok(aiRepository, "aiRepository must be exported");
    assert.equal(typeof aiRepository.loadRequirementSettings, "function", "loadRequirementSettings must be a function");
    assert.equal(typeof aiRepository.resolveApiKey, "function", "resolveApiKey must be a function");
  });

  it("loadRequirementSettings returns a store with .active property", { skip: !testDatabaseUrl }, async () => {
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
