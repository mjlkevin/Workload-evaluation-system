// ============================================================
// AI Provider - 统一模型调用接口
// ============================================================
// 本接口作为 P0 AI 基座抽象层，所有具体厂商实现（KimiProvider、
// 未来可能接入的 OpenAI / 通义 / DeepSeek 等）都应实现它。
//
// 设计目标：
//  1. 让上层（抽取器、评估引擎、DSL 规则检查）只面向接口编程，
//     不再硬编码 Kimi 的 endpoint / payload。
//  2. 内置重试/超时/温度兼容等稳定性细节，调用方无需重复实现。
//  3. 通过 ProviderError 统一错误码，方便上层做降级与可观测性。

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ResponseFormat = "text" | "json_object";

export interface ChatCompletionRequest {
  /** 覆盖 Provider 默认模型；不传则使用 Provider 默认 */
  model?: string;
  messages: ChatMessage[];
  /** 期望温度；Provider 可能按模型兼容规则做二次修正（如 thinking=1） */
  temperature?: number;
  responseFormat?: ResponseFormat;
  /** 单次 HTTP 超时上限（毫秒），不传使用 Provider 默认 */
  timeoutMs?: number;
  /** 最大尝试次数（含首次），不传使用 Provider 默认（通常 3） */
  maxAttempts?: number;
  /** 每次请求级别的凭据覆盖，用于多租户 / 用户自管 Key 场景 */
  credentialsOverride?: ProviderCredentials;
}

export interface ProviderCredentials {
  apiKey?: string;
  apiBaseUrl?: string;
}

export interface ChatCompletionResponse {
  /** 模型输出文本内容（choices[0].message.content） */
  content: string;
  /** 原始文本（与 content 同，保留字段以便后续附加完整响应快照） */
  rawContent: string;
  /** 实际使用的模型 id（经过 Provider 归一化） */
  model: string;
  /** Provider 名称（如 "kimi"） */
  provider: string;
  /** 实际发起的 HTTP 尝试次数 */
  attempts: number;
  /** 结束原因（如 "stop"、"length"），部分厂商可能不提供 */
  finishReason?: string;
}

export interface ModelProvider {
  /** Provider 唯一标识，例如 "kimi" */
  readonly name: string;
  /** 默认模型 id */
  readonly defaultModel: string;
  /** 是否具备最低调用条件（如 API Key 就绪） */
  isAvailable(): boolean;
  /** 核心调用：对话补全 */
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}
