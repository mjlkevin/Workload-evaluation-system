// ============================================================
// AI Provider - Kimi (Moonshot) 实现
// ============================================================
// 迁移自 apps/api/src/services/ai.service.ts 第 480-593 行
// requestKimiCompletion / fetchKimiCompletionOnce / buildKimiRequestError
// 等底层稳定性逻辑，统一封装成 ModelProvider 实现。
//
// 与旧实现的行为一致性：
//  1. 重试策略：最多 3 次，350ms * 2^(n-1) 指数退避，仅重试
//     engine_overloaded / rate_limited / service_unavailable。
//  2. 温度兼容：thinking 模型固定 1；HTTP 400 "only 1 is allowed"
//     时重试一次（不计入 maxAttempts）。
//  3. 超时：非流式 clamp 到 [3s, 300s]；流式 clamp 到 [3s, 120s]。
//  4. 超时重试：timeout 错误标记为 retryable，纳入指数退避。
//  5. Token 审计：parseSuccess / parseStream 提取 usage 字段。
//  6. 模型名归一化：空值回退默认模型，显式配置的模型名保持原样。

import { asString } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import {
  isKimiTemperatureMustBeOneError,
  resolveKimiCompletionTemperatureParam,
} from "../../utils/kimi-completion-params";
import { ProviderError, type ProviderErrorCode } from "./errors";
import { aiProviderRequestsTotal } from "../../metrics";
import type {
  ChatCompletionRequest,
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  JsonSchemaResponseFormat,
  ModelProvider,
  ProviderCredentials,
  ResponseFormat,
  ThinkingConfig,
  TokenUsage,
  ToolCall,
} from "./model-provider";

const PROVIDER_NAME = "kimi";
const DEFAULT_MODEL = "kimi-k2.5";
const DEFAULT_API_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 300_000;
const STREAM_MAX_TIMEOUT_MS = 120_000;
const BACKOFF_BASE_MS = 350;

export interface KimiProviderOptions {
  apiKey: string;
  apiBaseUrl?: string;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  /** 默认最大尝试次数（含首次），不传默认 3 */
  defaultMaxAttempts?: number;
}

interface ResolvedCredentials {
  apiKey: string;
  endpoint: string;
}

export class KimiProvider implements ModelProvider {
  readonly name = PROVIDER_NAME;
  readonly defaultModel: string;

  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxAttempts: number;

  constructor(options: KimiProviderOptions) {
    this.apiKey = asString(options.apiKey);
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl) || DEFAULT_API_BASE_URL;
    this.defaultModel = asString(options.defaultModel) || DEFAULT_MODEL;
    this.defaultTimeoutMs = clampTimeout(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    const attempts = Number(options.defaultMaxAttempts);
    this.defaultMaxAttempts =
      Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) : DEFAULT_MAX_ATTEMPTS;
  }

  isAvailable(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    try {
      return await this._chatCompletion(req);
    } catch (err) {
      aiProviderRequestsTotal.inc({ provider: PROVIDER_NAME, status: "error" });
      throw err;
    }
  }

  async *streamChatCompletion(req: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamChunk> {
    try {
      yield* this._streamChatCompletion(req);
      aiProviderRequestsTotal.inc({ provider: PROVIDER_NAME, status: "success" });
    } catch (err) {
      aiProviderRequestsTotal.inc({ provider: PROVIDER_NAME, status: "error" });
      throw err;
    }
  }

  private async _chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const credentials = this.resolveCredentials(req.credentialsOverride);
    if (!credentials.apiKey) {
      aiProviderRequestsTotal.inc({ provider: PROVIDER_NAME, status: "error" });
      throw new ProviderError("api_key_missing", "Kimi API Key 未配置", {
        providerName: PROVIDER_NAME,
        retryable: false,
        legacyReason: "api_key_missing",
      });
    }

    const model = normalizeKimiModelName(asString(req.model) || this.defaultModel);
    const preferredTemperature =
      typeof req.temperature === "number" && Number.isFinite(req.temperature) ? req.temperature : 0.3;
    const timeoutMs = clampTimeout(req.timeoutMs ?? this.defaultTimeoutMs);
    const maxAttempts = resolveMaxAttempts(req.maxAttempts, this.defaultMaxAttempts);

    let body: Record<string, unknown> = {
      model,
      messages: req.messages.map(toKimiMessage),
    };
    applyCommonKimiOptions(body, req, model, preferredTemperature);
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }

    let attempts = 0;
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const responseOrRetryableError = await fetchAttemptOrRetryableError(
        credentials.endpoint,
        credentials.apiKey,
        body,
        timeoutMs,
        attempt,
        maxAttempts,
        req.abortSignal,
      );
      if (responseOrRetryableError instanceof ProviderError) {
        lastError = responseOrRetryableError;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      const response = responseOrRetryableError;
      if (response.ok) {
        const result = await parseSuccess(response, model, attempts);
        aiProviderRequestsTotal.inc({ provider: PROVIDER_NAME, status: "success" });
        return result;
      }

      let errorText = await safeReadText(response);
      if (isKimiTemperatureMustBeOneError(response.status, errorText) && Number(body.temperature) !== 1) {
        body = { ...body, temperature: 1 };
        const retriedOrRetryableError = await fetchAttemptOrRetryableError(
          credentials.endpoint,
          credentials.apiKey,
          body,
          timeoutMs,
          attempt,
          maxAttempts,
          req.abortSignal,
        );
        if (retriedOrRetryableError instanceof ProviderError) {
          lastError = retriedOrRetryableError;
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        const retried = retriedOrRetryableError;
        if (retried.ok) {
          const result = await parseSuccess(retried, model, attempts);
          aiProviderRequestsTotal.inc({ provider: PROVIDER_NAME, status: "success" });
          return result;
        }
        errorText = await safeReadText(retried);
        const err2 = mapHttpError(retried.status, errorText);
        if (err2.retryable && attempt < maxAttempts) {
          lastError = err2;
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        throw err2;
      }

      const err = mapHttpError(response.status, errorText);
      if (err.retryable && attempt < maxAttempts) {
        lastError = err;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }

    throw (
      lastError ??
      new ProviderError("request_failed", "kimi_request_failed:unknown", {
        providerName: PROVIDER_NAME,
        legacyReason: "kimi_request_failed:unknown",
      })
    );
  }

  private async *_streamChatCompletion(req: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamChunk> {
    const credentials = this.resolveCredentials(req.credentialsOverride);
    if (!credentials.apiKey) {
      throw new ProviderError("api_key_missing", "Kimi API Key 未配置", {
        providerName: PROVIDER_NAME,
        retryable: false,
        legacyReason: "api_key_missing",
      });
    }

    const model = normalizeKimiModelName(asString(req.model) || this.defaultModel);
    const preferredTemperature =
      typeof req.temperature === "number" && Number.isFinite(req.temperature) ? req.temperature : 0.3;
    const timeoutMs = clampTimeout(req.timeoutMs ?? this.defaultTimeoutMs);
    const maxAttempts = resolveMaxAttempts(req.maxAttempts, this.defaultMaxAttempts);

    let body: Record<string, unknown> = {
      model,
      messages: req.messages.map(toKimiMessage),
      stream: true,
    };
    applyCommonKimiOptions(body, req, model, preferredTemperature);
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }

    // 流式调用使用更保守的超时上限（官方推荐 stream=true 保持连接活跃）
    const streamTimeoutMs = Math.min(STREAM_MAX_TIMEOUT_MS, timeoutMs);

    let lastError: ProviderError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const responseOrRetryableError = await fetchAttemptOrRetryableError(
        credentials.endpoint,
        credentials.apiKey,
        body,
        streamTimeoutMs,
        attempt,
        maxAttempts,
        req.abortSignal,
      );
      if (responseOrRetryableError instanceof ProviderError) {
        lastError = responseOrRetryableError;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      const response = responseOrRetryableError;
      if (response.ok) {
        yield* parseStream(response, model, attempt);
        return;
      }

      let errorText = await safeReadText(response);
      if (isKimiTemperatureMustBeOneError(response.status, errorText) && Number(body.temperature) !== 1) {
        body = { ...body, temperature: 1 };
        const retriedOrRetryableError = await fetchAttemptOrRetryableError(
          credentials.endpoint,
          credentials.apiKey,
          body,
          streamTimeoutMs,
          attempt,
          maxAttempts,
          req.abortSignal,
        );
        if (retriedOrRetryableError instanceof ProviderError) {
          lastError = retriedOrRetryableError;
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        const retried = retriedOrRetryableError;
        if (retried.ok) {
          yield* parseStream(retried, model, attempt);
          return;
        }
        errorText = await safeReadText(retried);
        const err2 = mapHttpError(retried.status, errorText);
        if (err2.retryable && attempt < maxAttempts) {
          lastError = err2;
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        throw err2;
      }

      const err = mapHttpError(response.status, errorText);
      if (err.retryable && attempt < maxAttempts) {
        lastError = err;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }

    throw (
      lastError ??
      new ProviderError("request_failed", "kimi_request_failed:unknown", {
        providerName: PROVIDER_NAME,
        legacyReason: "kimi_request_failed:unknown",
      })
    );
  }

  private resolveCredentials(override?: ProviderCredentials): ResolvedCredentials {
    const apiKey = asString(override?.apiKey) || this.apiKey;
    const baseUrl = normalizeBaseUrl(override?.apiBaseUrl) || this.apiBaseUrl;
    return {
      apiKey,
      endpoint: `${baseUrl}/chat/completions`,
    };
  }
}

// -------------------- 内部工具函数 --------------------

function normalizeBaseUrl(value: unknown): string {
  const text = asString(value).replace(/\/+$/, "");
  return text;
}

function clampTimeout(value: number): number {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(base)));
}

function resolveMaxAttempts(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback;
  const n = Number(requested);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function toKimiMessage(message: ChatMessage): Record<string, unknown> {
  const item: Record<string, unknown> = {
    role: message.role,
    content: asString(message.content),
  };
  if (message.partial === true) item.partial = true;
  return item;
}

function applyCommonKimiOptions(
  body: Record<string, unknown>,
  req: ChatCompletionRequest,
  model: string,
  preferredTemperature: number,
): void {
  const temperature = resolveKimiCompletionTemperatureParam(model, preferredTemperature);
  if (temperature !== undefined) body.temperature = temperature;

  const maxCompletionTokens = normalizePositiveInteger(req.maxCompletionTokens);
  if (maxCompletionTokens !== undefined) body.max_completion_tokens = maxCompletionTokens;

  const promptCacheKey = asString(req.promptCacheKey).trim();
  if (promptCacheKey) body.prompt_cache_key = promptCacheKey;

  const responseFormat = normalizeResponseFormat(req.responseFormat);
  if (responseFormat) body.response_format = responseFormat;

  const thinking = normalizeThinking(req.thinking);
  if (thinking !== undefined) body.thinking = thinking;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function normalizeResponseFormat(format: ResponseFormat | undefined): Record<string, unknown> | undefined {
  if (!format || format === "text") return undefined;
  if (format === "json_object") return { type: "json_object" };
  if (isJsonSchemaResponseFormat(format)) return { ...format };
  return undefined;
}

function isJsonSchemaResponseFormat(format: unknown): format is JsonSchemaResponseFormat {
  if (!format || typeof format !== "object") return false;
  const candidate = format as { type?: unknown; json_schema?: unknown };
  if (candidate.type !== "json_schema") return false;
  const schema = candidate.json_schema;
  if (!schema || typeof schema !== "object") return false;
  const typed = schema as { name?: unknown; schema?: unknown };
  return typeof typed.name === "string" && !!typed.schema && typeof typed.schema === "object";
}

function normalizeThinking(value: ThinkingConfig | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === true) return { type: "enabled" };
  if (value === false) return { type: "disabled" };
  if (value === "enabled" || value === "disabled") return { type: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<globalThis.Response> {
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = abortSignal
      ? AbortSignal.any([timeoutSignal, abortSignal])
      : timeoutSignal;
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (abortSignal?.aborted) {
      throw new ProviderError("request_failed", "client_aborted", {
        providerName: PROVIDER_NAME,
        retryable: false,
        legacyReason: "client_aborted",
        cause: e,
      });
    }
    if (isFetchAbortError(e)) {
      throw new ProviderError("timeout", "kimi_request_timeout", {
        providerName: PROVIDER_NAME,
        retryable: true,
        legacyReason: "kimi_request_timeout",
        cause: e,
      });
    }
    throw new ProviderError("request_failed", describeUnknownError(e), {
      providerName: PROVIDER_NAME,
      retryable: false,
      cause: e,
    });
  }
}

async function fetchAttemptOrRetryableError(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  attempt: number,
  maxAttempts: number,
  abortSignal?: AbortSignal,
): Promise<globalThis.Response | ProviderError> {
  try {
    return await fetchOnce(endpoint, apiKey, body, timeoutMs, abortSignal);
  } catch (e) {
    if (e instanceof ProviderError && e.retryable && attempt < maxAttempts) {
      return e;
    }
    throw e;
  }
}

function isFetchAbortError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  return /aborted|timeout/i.test(e.message);
}

function describeUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message || "kimi_request_failed:network";
  return "kimi_request_failed:network";
}

async function safeReadText(response: globalThis.Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function parseSuccess(
  response: globalThis.Response,
  model: string,
  attempts: number,
): Promise<ChatCompletionResponse> {
  const json = (await response.json()) as { choices?: RawChoice[]; usage?: RawUsage };
  const choice = json?.choices?.[0] ?? {};
  const { content, toolCalls, finishReason } = parseChoiceMessage(choice);
  if (!content && (!toolCalls || toolCalls.length === 0)) {
    throw new ProviderError("empty_response", "model_empty_response", {
      providerName: PROVIDER_NAME,
      retryable: false,
      legacyReason: "model_empty_response",
    });
  }
  return {
    content,
    rawContent: content,
    model,
    provider: PROVIDER_NAME,
    attempts,
    finishReason,
    toolCalls,
    usage: extractUsage(json?.usage),
  };
}

async function* parseStream(
  response: globalThis.Response,
  model: string,
  attempts: number,
): AsyncIterable<ChatCompletionStreamChunk> {
  if (!response.body) {
    throw new ProviderError("empty_response", "model_empty_stream", {
      providerName: PROVIDER_NAME,
      retryable: false,
      legacyReason: "model_empty_stream",
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // P1-1: 不再累积 content/reasoningContent 完整文本。原实现每次 yield 携带累积完整文本
  // 导致 O(N²) 传输（2000 token 回复 ~2MB）。消费方仅需 contentDelta，自行累积即可。
  let finishReason: string | undefined;
  let lastUsage: TokenUsage | undefined;

  // 流式 tool_calls 分片聚合：按 index 归并，id/name 取最早分片，arguments 逐段拼接。
  // 仅在 finish_reason === "tool_calls" 的 chunk 上输出拼装结果（与 usage 同为末 chunk 语义）。
  const toolCallParts = new Map<number, { id?: string; name?: string; arguments: string }>();
  let toolCallsEmitted = false;

  const assembleToolCalls = (): ToolCall[] | undefined => {
    if (toolCallParts.size === 0) return undefined;
    toolCallsEmitted = true;
    return Array.from(toolCallParts.entries())
      .sort(([a], [b]) => a - b)
      .map(([index, part]) => ({
        id: part.id || `call_${index}`,
        name: part.name ?? "",
        arguments: parseToolArguments(part.arguments),
      }));
  };

  // 兜底：厂商未按惯例补 finish_reason 分片时也要交出工具调用，否则会退化成"模型说了没人听"的空回答
  const pendingToolCallsChunk = (): ChatCompletionStreamChunk | undefined => {
    if (toolCallsEmitted || toolCallParts.size === 0) return undefined;
    return {
      contentDelta: "",
      model,
      provider: PROVIDER_NAME,
      attempts,
      finishReason: "tool_calls",
      toolCalls: assembleToolCalls(),
    };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";

      for (const part of parts) {
        const dataLines = part
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        for (const data of dataLines) {
          if (!data || data === "[DONE]") {
            // 流结束前如果未输出 usage，不额外补充（部分厂商不返回流式 usage）
            const flush = pendingToolCallsChunk();
            if (flush) yield flush;
            return;
          }
          let json: {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                reasoningContent?: string;
                tool_calls?: RawToolCallFragment[];
              };
              message?: { content?: string; reasoning_content?: string; reasoningContent?: string };
              finish_reason?: string | null;
            }>;
            usage?: RawUsage;
          };
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          const choice = json.choices?.[0];
          const delta = asString(choice?.delta?.content || choice?.message?.content);
          const reasoningDelta = asString(
            choice?.delta?.reasoning_content ||
              choice?.delta?.reasoningContent ||
              choice?.message?.reasoning_content ||
              choice?.message?.reasoningContent,
          );
          for (const [pos, frag] of (choice?.delta?.tool_calls ?? []).entries()) {
            const key = Number.isFinite(Number(frag?.index)) ? Number(frag?.index) : pos;
            const prev = toolCallParts.get(key) ?? { arguments: "" };
            toolCallParts.set(key, {
              id: prev.id || asString(frag?.id) || undefined,
              name: prev.name || asString(frag?.function?.name) || undefined,
              arguments: prev.arguments + asString(frag?.function?.arguments),
            });
          }
          finishReason = asString(choice?.finish_reason) || finishReason;
          const streamUsage = extractUsage(json?.usage);
          if (streamUsage) lastUsage = streamUsage;
          const streamToolCalls = finishReason === "tool_calls" ? assembleToolCalls() : undefined;
          if (!delta && !reasoningDelta && !finishReason && !streamUsage && !streamToolCalls) continue;
          // P1-1: 仅 yield delta，不再携带累积的 content/reasoningContent 字段
          yield {
            contentDelta: delta,
            reasoningContentDelta: reasoningDelta || undefined,
            model,
            provider: PROVIDER_NAME,
            attempts,
            finishReason,
            usage: streamUsage,
            ...(streamToolCalls ? { toolCalls: streamToolCalls } : {}),
          };
        }
      }
    }
    const tailFlush = pendingToolCallsChunk();
    if (tailFlush) yield tailFlush;
  } catch (e) {
    if (isFetchAbortError(e)) {
      throw new ProviderError("timeout", "kimi_request_timeout", {
        providerName: PROVIDER_NAME,
        retryable: true,
        legacyReason: "kimi_request_timeout",
        cause: e,
      });
    }
    throw e;
  } finally {
    reader.releaseLock();
  }
}

function mapHttpError(status: number, errorText: string): ProviderError {
  const raw = asString(errorText);
  let code: ProviderErrorCode;
  let legacyReason: string;

  if (/insufficient|balance|quota|credit|arrears|欠费|余额|额度|账户余额/i.test(raw)) {
    code = "quota_exceeded";
    legacyReason = "kimi_quota_exceeded";
  } else if (/engine_overloaded_error|overloaded|try again later/i.test(raw)) {
    code = "engine_overloaded";
    legacyReason = "kimi_engine_overloaded";
  } else if (status === 429) {
    code = "rate_limited";
    legacyReason = "kimi_rate_limited";
  } else if (status === 502 || status === 503) {
    code = "service_unavailable";
    legacyReason = "kimi_service_unavailable";
  } else if (status === 401 || status === 403) {
    code = "auth_failed";
    legacyReason = "kimi_auth_failed";
  } else if (status === 400) {
    code = "bad_request";
    legacyReason = `kimi_request_failed:${status}:${raw.slice(0, 240)}`;
  } else {
    code = "request_failed";
    legacyReason = `kimi_request_failed:${status}:${raw.slice(0, 240)}`;
  }

  return new ProviderError(code, legacyReason, {
    providerName: PROVIDER_NAME,
    status,
    legacyReason,
  });
}

/** 工具调用分片：非流式一次性给全；流式按 index 分片下发，arguments 逐段拼接 */
interface RawToolCallFragment {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface RawChoice {
  message?: {
    content?: string | null;
    tool_calls?: RawToolCallFragment[];
  };
  finish_reason?: string | null;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function extractUsage(raw: RawUsage | undefined): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const pt = Number(raw.prompt_tokens);
  const ct = Number(raw.completion_tokens);
  const tt = Number(raw.total_tokens);
  if (!Number.isFinite(pt) && !Number.isFinite(ct) && !Number.isFinite(tt)) return undefined;
  return {
    promptTokens: Number.isFinite(pt) ? pt : 0,
    completionTokens: Number.isFinite(ct) ? ct : 0,
    totalTokens: Number.isFinite(tt) ? tt : (Number.isFinite(pt) ? pt : 0) + (Number.isFinite(ct) ? ct : 0),
  };
}

/** 工具参数容错解析：缺失/非法 JSON/非对象一律回落 {}，由工具层按参数校验报错 */
function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(asString(raw) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // 回落空参数，不中断链路
  }
  return {};
}

/** 纯函数：把厂商 choice 解析为 { content, toolCalls, finishReason } */
export function parseChoiceMessage(choice: RawChoice): {
  content: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
} {
  const content = asString(choice?.message?.content);
  const finishReason = asString(choice?.finish_reason) || undefined;
  const rawCalls = choice?.message?.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return { content, finishReason };
  }
  const toolCalls: ToolCall[] = rawCalls.map((c, i) => ({
    id: asString(c?.id) || `call_${i}`,
    name: asString(c?.function?.name),
    arguments: parseToolArguments(c?.function?.arguments),
  }));
  return { content, toolCalls, finishReason };
}
