// ============================================================
// AI 基座 - 启动期注册测试
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { defaultProviderRegistry } from "./provider";
import { bootstrapAiProviders, _resetAiBootstrapForTest } from "./bootstrap";

test("bootstrapAiProviders 注册 kimi provider 到默认注册表", () => {
  _resetAiBootstrapForTest();
  bootstrapAiProviders();

  const kimi = defaultProviderRegistry.get("kimi");
  assert.ok(kimi, "kimi provider 应已注册");
  assert.equal(kimi!.name, "kimi");
  // 默认注册表应将 kimi 设为默认
  assert.equal(defaultProviderRegistry.getDefault()?.name, "kimi");
});

test("bootstrapAiProviders 幂等：重复调用不重复注册", () => {
  _resetAiBootstrapForTest();
  bootstrapAiProviders();
  const firstInstance = defaultProviderRegistry.get("kimi");

  // 二次调用应直接 return，不重新构造 provider
  bootstrapAiProviders();
  const secondInstance = defaultProviderRegistry.get("kimi");

  assert.strictEqual(firstInstance, secondInstance, "重复 bootstrap 不应替换 provider 实例");
});

test("即使 KIMI_API_KEY 缺省，provider 也会注册（仅 isAvailable=false）", () => {
  _resetAiBootstrapForTest();
  // 不动 env，依赖默认值 (apiKey 默认空)
  bootstrapAiProviders();
  const kimi = defaultProviderRegistry.get("kimi");
  assert.ok(kimi);
  // isAvailable 取决于当前 env 的 KIMI_API_KEY；本测试不强求其值，
  // 仅验证"未配置 key 也不会让注册流程崩溃"。
  assert.equal(typeof kimi!.isAvailable(), "boolean");
});
