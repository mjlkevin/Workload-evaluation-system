// ============================================================
// AI Provider - 统一错误模型
// ============================================================
// 所有 Provider 实现抛出的异常都应统一封装为 ProviderError，
// 由上层业务（ai.service / extractor / dsl 引擎）根据 code 做降级、
// 重试或告警处理，避免把底层 HTTP 细节泄露到业务层。
//
// 与旧 ai.service.ts 中 buildKimiRequestError 的映射关系：
//   kimi_engine_overloaded    -> engine_overloaded   (retryable)
//   kimi_rate_limited         -> rate_limited        (retryable)
//   kimi_service_unavailable  -> service_unavailable (retryable)
//   kimi_auth_failed          -> auth_failed
//   kimi_request_timeout      -> timeout
//   kimi_request_failed:*     -> request_failed
// 上层 toFriendlyFallbackReason 兼容旧字符串，故 ProviderError
// 需要同时保留原 reasonKey 以便友好文案层做进一步翻译。

export type ProviderErrorCode =
  | "api_key_missing"
  | "auth_failed"
  | "rate_limited"
  | "engine_overloaded"
  | "service_unavailable"
  | "timeout"
  | "bad_request"
  | "empty_response"
  | "request_failed";

export interface ProviderErrorOptions {
  status?: number;
  providerName?: string;
  retryable?: boolean;
  /** 兼容旧字符串 reason（如 "kimi_engine_overloaded"），供降级文案层翻译 */
  legacyReason?: string;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly providerName?: string;
  readonly retryable: boolean;
  readonly legacyReason?: string;

  constructor(code: ProviderErrorCode, message: string, options: ProviderErrorOptions = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status;
    this.providerName = options.providerName;
    this.retryable = options.retryable ?? isRetryableByCode(code);
    this.legacyReason = options.legacyReason;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isRetryableByCode(code: ProviderErrorCode): boolean {
  return code === "rate_limited" || code === "engine_overloaded" || code === "service_unavailable";
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}
