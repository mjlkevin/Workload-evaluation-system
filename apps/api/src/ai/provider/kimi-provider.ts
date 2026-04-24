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
//  3. 超时：单次 HTTP clamp 到 [3s, 120s]，与系统管理面板一致。
//  4. 模型名归一化：继承 normalizeKimiModelName（moonshot-* -> kimi-k2.5）。

import { asString } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import {
  isKimiTemperatureMustBeOneError,
  resolveKimiCompletionTemperature,
} from "../../utils/kimi-completion-params";
import { ProviderError, type ProviderErrorCode } from "./errors";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelProvider,
  ProviderCredentials,
} from "./model-provider";

const PROVIDER_NAME = "kimi";
const DEFAULT_MODEL = "kimi-k2.5";
const DEFAULT_API_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;
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
      temperature: resolveKimiCompletionTemperature(model, preferredTemperature),
      messages: req.messages.map((m) => ({ role: m.role, content: asString(m.content) })),
    };
    if (req.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    let attempts = 0;
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const response = await fetchOnce(credentials.endpoint, credentials.apiKey, body, timeoutMs);
      if (response.ok) {
        return await parseSuccess(response, model, attempts);
      }

      let errorText = await safeReadText(response);
      if (isKimiTemperatureMustBeOneError(response.status, errorText) && Number(body.temperature) !== 1) {
        body = { ...body, temperature: 1 };
        const retried = await fetchOnce(credentials.endpoint, credentials.apiKey, body, timeoutMs);
        if (retried.ok) {
          return await parseSuccess(retried, model, attempts);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<globalThis.Response> {
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (isFetchAbortError(e)) {
      throw new ProviderError("timeout", "kimi_request_timeout", {
        providerName: PROVIDER_NAME,
        retryable: false,
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
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const content = asString(json?.choices?.[0]?.message?.content);
  const finishReason = asString(json?.choices?.[0]?.finish_reason) || undefined;
  if (!content) {
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
  };
}

function mapHttpError(status: number, errorText: string): ProviderError {
  const raw = asString(errorText);
  let code: ProviderErrorCode;
  let legacyReason: string;

  if (/engine_overloaded_error|overloaded|try again later/i.test(raw)) {
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
