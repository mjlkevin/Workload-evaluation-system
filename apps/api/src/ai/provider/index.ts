// ============================================================
// AI Provider - 对外入口（barrel export）
// ============================================================
// 业务层只需 `import { ... } from "../ai/provider"`，不直接依赖具体文件。

export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatRole,
  ModelProvider,
  ProviderCredentials,
  ResponseFormat,
} from "./model-provider";

export { ProviderError, isProviderError, isRetryableByCode } from "./errors";
export type { ProviderErrorCode, ProviderErrorOptions } from "./errors";

export { KimiProvider } from "./kimi-provider";
export type { KimiProviderOptions } from "./kimi-provider";

export { ProviderRegistry, defaultProviderRegistry } from "./registry";
