// ============================================================
// AI Provider - 轻量断路器（Circuit Breaker）
// ============================================================
// 作为 ModelProvider 的代理层，包裹 KimiProvider 等具体实现。
// 当底层 Provider 连续返回特定错误（engine_overloaded /
// service_unavailable / timeout / rate_limited）达到阈值后，
// 断路器进入 OPEN 状态，后续请求快速失败（不发起 HTTP 调用），
// 避免 Kimi 宕机时高并发请求耗尽线程池/连接池。
//
// 状态机：
//   CLOSED  → 连续失败数 >= failureThreshold → OPEN
//   OPEN    → 经过 resetTimeoutMs → HALF_OPEN（仅放行 1 个试探请求）
//   HALF_OPEN → 试探成功 → CLOSED
//   HALF_OPEN → 试探失败（trippable）→ OPEN
//
// 设计要点：
//  1. 只有特定错误类型才触发断路器，避免业务错误（如 bad_request）
//     误触导致断路器打开。
//  2. circuit_open 错误 retryable=false，上层不应重试（快速失败）。
//  3. 流式调用中，只有流开始前（第一个 chunk 之前）的失败计入断路器；
//     一旦流已开始输出，后续中断不计入（可能已发送部分内容）。
//  4. HALF_OPEN 状态下仅允许 1 个请求通过（halfOpenInProgress 标记），
//     其余请求快速失败，直到试探请求完成。

import { ProviderError, type ProviderErrorCode } from "./errors";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  ModelProvider,
} from "./model-provider";

/** 断路器状态 */
type CircuitState = "closed" | "open" | "half_open";

/**
 * 触发断路器的错误类型集合。
 *
 * 注意：实际 ProviderError code 是 `rate_limited`（非 `rate_limit_exceeded`），
 * 与 errors.ts 中 ProviderErrorCode 联合类型保持一致。
 */
const TRIPPABLE_ERRORS: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
  "engine_overloaded",
  "service_unavailable",
  "timeout",
  "rate_limited",
]);

export interface CircuitBreakerOptions {
  /** 连续失败多少次后进入 OPEN 状态，默认 5 */
  failureThreshold?: number;
  /** OPEN 状态持续多少毫秒后进入 HALF_OPEN，默认 30_000（30s） */
  resetTimeoutMs?: number;
}

/**
 * 断路器代理 Provider：在 inner Provider 外层包裹断路器逻辑。
 *
 * - 透明代理 `name` / `defaultModel` / `isAvailable()` 到 inner Provider。
 * - `chatCompletion` / `streamChatCompletion` 在调用前检查断路器状态，
 *   调用后根据结果更新状态。
 */
export class CircuitBreakingProvider implements ModelProvider {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  /** HALF_OPEN 状态下是否有试探请求正在进行 */
  private halfOpenInProgress = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly inner: ModelProvider;

  constructor(inner: ModelProvider, options?: CircuitBreakerOptions) {
    this.inner = inner;
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
  }

  // -------------------- ModelProvider 接口代理 --------------------

  get name(): string {
    return this.inner.name;
  }

  get defaultModel(): string {
    return this.inner.defaultModel;
  }

  isAvailable(): boolean {
    return this.inner.isAvailable();
  }

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.checkState();
    try {
      const result = await this.inner.chatCompletion(req);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  async *streamChatCompletion(
    req: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionStreamChunk> {
    this.checkState();

    if (!this.inner.streamChatCompletion) {
      throw new ProviderError("request_failed", "Provider does not support streaming", {
        providerName: this.inner.name,
        retryable: false,
      });
    }

    // 对于流式调用，只有在流开始前（第一个 chunk 之前）的失败才计入断路器。
    // 一旦流已开始输出，后续中断不计入（可能已发送部分内容给客户端）。
    let hasStarted = false;
    try {
      const stream = this.inner.streamChatCompletion(req);
      for await (const chunk of stream) {
        hasStarted = true;
        yield chunk;
      }
      this.onSuccess();
    } catch (error) {
      if (!hasStarted) {
        this.onFailure(error);
      }
      throw error;
    }
  }

  // -------------------- 断路器内部逻辑 --------------------

  /**
   * 调用 inner Provider 前检查断路器状态。
   *
   * - CLOSED：直接放行。
   * - OPEN：若已过冷却期则转为 HALF_OPEN 并放行 1 个试探请求；否则快速失败。
   * - HALF_OPEN：若已有试探请求在进行则快速失败；否则放行作为试探请求。
   *
   * 抛出异常时在 try-catch 之外，不会被自身的 onFailure 捕获。
   */
  private checkState(): void {
    if (this.state === "open") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        // 冷却期已过：进入 HALF_OPEN，放行 1 个试探请求
        this.state = "half_open";
        this.halfOpenInProgress = true;
      } else {
        throw this.createCircuitOpenError();
      }
      return;
    }

    if (this.state === "half_open") {
      if (this.halfOpenInProgress) {
        // 已有试探请求在进行，其余请求快速失败
        throw this.createCircuitOpenError();
      }
      // 正常情况下不会走到这里（onSuccess/onFailure 会转换状态），
      // 但作为防御性处理，允许此请求作为新的试探请求
      this.halfOpenInProgress = true;
    }
  }

  /**
   * 调用成功后更新状态。
   * HALF_OPEN 状态下成功 → 关闭断路器，恢复正常流量。
   */
  private onSuccess(): void {
    if (this.state === "half_open") {
      this.state = "closed";
      this.failureCount = 0;
      this.halfOpenInProgress = false;
    }
  }

  /**
   * 调用失败后更新状态。
   * 只有 TRIPPABLE_ERRORS 中的错误类型才触发断路器逻辑。
   *
   * - HALF_OPEN 失败 → 重新打开断路器。
   * - CLOSED 失败 → 累加 failureCount，达到阈值则打开断路器。
   */
  private onFailure(error: unknown): void {
    const isTrippable = error instanceof ProviderError && TRIPPABLE_ERRORS.has(error.code);
    if (!isTrippable) return;

    if (this.state === "half_open") {
      // 试探请求失败：重新打开断路器
      this.state = "open";
      this.lastFailureTime = Date.now();
      this.halfOpenInProgress = false;
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  /** 创建 circuit_open 快速失败错误（retryable: false，上层不应重试） */
  private createCircuitOpenError(): ProviderError {
    return new ProviderError("circuit_open", "Circuit breaker is open: provider temporarily unavailable", {
      providerName: this.inner.name,
      retryable: false,
      legacyReason: "circuit_open",
    });
  }
}
