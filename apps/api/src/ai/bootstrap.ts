// ============================================================
// AI 基座 - 启动期注册
// ============================================================
// 在 createApp() 入口被调用一次，把可用的 ModelProvider 注册到
// defaultProviderRegistry。业务层（ai.service / extractor / dsl 等）
// 都从注册表取 provider，不应直接构造 KimiProvider。
//
// 凭据策略：构造时使用 env 默认值；每次调用时各路由从
// resolveActiveRequirementKimiApiKey() 取实时 apiKey 并通过
// chatCompletion(req).credentialsOverride 透传。

import { config } from "../config/env";
import { KimiProvider, defaultProviderRegistry } from "./provider";

let bootstrapped = false;

export function bootstrapAiProviders(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const kimi = new KimiProvider({
    apiKey: config.kimi.apiKey ?? "",
    apiBaseUrl: config.kimi.apiBaseUrl,
    defaultModel: config.kimi.model,
  });
  defaultProviderRegistry.register(kimi, { asDefault: true });
}

/** 测试场景下重置注册状态（生产路径不调用） */
export function _resetAiBootstrapForTest(): void {
  bootstrapped = false;
  defaultProviderRegistry.clear();
}
