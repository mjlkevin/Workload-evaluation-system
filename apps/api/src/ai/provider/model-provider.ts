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
  /**
   * Kimi Partial Mode assistant prefill. 仅 Kimi 等支持 partial 的
   * provider 会透传；其他 provider 可忽略。
   */
  partial?: boolean;
}

export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
    description?: string;
  };
}

export type ResponseFormat = "text" | "json_object" | JsonSchemaResponseFormat;

export type ThinkingMode = "enabled" | "disabled";
export type ThinkingConfig = ThinkingMode | boolean | { type: ThinkingMode | string; [key: string]: unknown };

/** 工具定义（OpenAI 兼容 function-calling 协议） */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema 参数对象 */
    parameters: Record<string, unknown>;
  };
}

/** 模型决定发起的一次工具调用 */
export interface ToolCall {
  /** 厂商返回的调用 id，回填结果时用 */
  id: string;
  /** 工具名 */
  name: string;
  /** 模型给出的参数（已解析为对象；解析失败为 {}） */
  arguments: Record<string, unknown>;
}

export type ToolChoice = "auto" | "none";

export interface ChatCompletionRequest {
  /** 覆盖 Provider 默认模型；不传则使用 Provider 默认 */
  model?: string;
  messages: ChatMessage[];
  /** 期望温度；Provider 可能按模型兼容规则做二次修正（如 thinking=1） */
  temperature?: number;
  /** 最大输出 token；Kimi 使用 max_completion_tokens。 */
  maxCompletionTokens?: number;
  /** Kimi prompt cache key，用于同类系统 prompt / 模板复用缓存。 */
  promptCacheKey?: string;
  /** Kimi thinking 开关；不传则由模型默认策略决定。 */
  thinking?: ThinkingConfig;
  responseFormat?: ResponseFormat;
  /** 单次 HTTP 超时上限（毫秒），不传使用 Provider 默认 */
  timeoutMs?: number;
  /** 调用方取消信号；用于客户端断开时终止上游模型请求。 */
  abortSignal?: AbortSignal;
  /** 最大尝试次数（含首次），不传使用 Provider 默认（通常 3） */
  maxAttempts?: number;
  /** 每次请求级别的凭据覆盖，用于多租户 / 用户自管 Key 场景 */
  credentialsOverride?: ProviderCredentials;
  /** 可用工具清单；不传则普通对话 */
  tools?: ToolDefinition[];
  /** 工具选择策略；默认 auto */
  toolChoice?: ToolChoice;
}

export interface ProviderCredentials {
  apiKey?: string;
  apiBaseUrl?: string;
}

/** Token 消耗统计（Kimi / OpenAI 兼容） */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
  /** 模型发起的工具调用；无则 undefined 或空数组 */
  toolCalls?: ToolCall[];
  /** Token 消耗统计；部分厂商或场景可能不返回 */
  usage?: TokenUsage;
}

export interface ChatCompletionStreamChunk {
  /** 本次 SSE chunk 的增量文本 */
  contentDelta: string;
  /**
   * 截止当前已累积的完整文本。
   *
   * @deprecated P1-1: 已废弃，Provider 不再累积完整文本。原实现每次 yield 携带累积完整文本
   * 导致 O(N²) 传输量（2000 token 回复 ~2MB）。消费方应使用 contentDelta 自行累积。
   * 保留为 optional 字段以确保向后兼容，但值通常为 undefined。
   */
  content?: string;
  /** 本次 SSE chunk 的思考增量文本（Kimi reasoning_content） */
  reasoningContentDelta?: string;
  /**
   * 截止当前已累积的完整思考文本。
   *
   * @deprecated P1-1: 已废弃，Provider 不再累积完整思考文本。消费方应使用 reasoningContentDelta 自行累积。
   * 保留为 optional 字段以确保向后兼容，但值通常为 undefined。
   */
  reasoningContent?: string;
  /** 实际使用的模型 id（经过 Provider 归一化） */
  model: string;
  /** Provider 名称（如 "kimi"） */
  provider: string;
  /** 实际发起的 HTTP 尝试次数 */
  attempts: number;
  /** 结束原因（如 "stop"、"length"），部分厂商可能不提供 */
  finishReason?: string;
  /** Token 消耗统计；流式场景通常在最后一个 chunk 中出现 */
  usage?: TokenUsage;
  /**
   * 模型发起的工具调用。
   *
   * 流式协议下 tool_calls 以分片下发（arguments 逐段拼接），因此本字段只在
   * 聚合完成后出现——即携带 `finishReason === "tool_calls"` 的那个 chunk 上，
   * 值为按 index 拼装完毕的完整调用列表。普通回答与不支持流式工具调用的
   * Provider 均为 undefined。
   */
  toolCalls?: ToolCall[];
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
  /** 流式调用：逐段返回模型输出文本；Provider 不支持时可不实现 */
  streamChatCompletion?(req: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamChunk>;
}
