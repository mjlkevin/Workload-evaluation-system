// ============================================================
// SSE 公共工具模块
//
// 提供统一的 SSE 响应头设置、abort 感知写入、客户端断开桥接。
// 消除 chat.service.ts 与 extractor.service.ts 的 SSE 实现重复，
// 并将客户端断开信号统一封装为 AbortGuard，供后续 P0-2 透传至 Provider fetch。
//
// 关联缺陷（Streaming 架构审计）：
//   - C1（部分）：客户端断开后 abort 信号可被消费方读取
//   - C2：extractor 无断开检测 → 通过 writeSse 内置 isAborted 检查修复
//   - H8（总超时部分）：createAbortBridge 内置 totalTimeoutMs
// ============================================================

import { Request, Response } from "express";

/**
 * AbortGuard —— 客户端断开 / 超时的统一守卫。
 *
 * - `signal`：标准 AbortSignal，P0-2 将透传至 Provider fetch，实现上游取消。
 * - `isAborted()`：同步读取 abort 标志（含客户端断开与服务端超时）。
 * - `isClientDisconnected()`：仅当客户端真正断开（req.aborted / res.close）时为 true；
 *   服务端 totalTimeout / idleTimeout 触发的 abort 不会置位。writeSse 据此判断是否
 *   还能向客户端写入 error 事件——服务端超时仍允许写 error，只有客户端真正断开才跳过。
 * - `resetIdleTimer()`：每次成功写入后调用，重置 idle 超时计时器。
 * - `cleanup()`：在 handler finally 块调用，移除监听器与清除计时器，防止内存泄漏。
 */
export interface AbortGuard {
  signal: AbortSignal;
  isAborted: () => boolean;
  isClientDisconnected: () => boolean;
  cleanup: () => void;
  resetIdleTimer: () => void;
}

/**
 * 开启 SSE 响应：设置标准头、flushHeaders、发送初始 heartbeat。
 *
 * 默认头：
 *   - Content-Type: text/event-stream; charset=utf-8
 *   - Cache-Control: no-cache, no-transform
 *   - X-Accel-Buffering: no
 *   - Connection: keep-alive
 *
 * `options.headers` 可覆盖或追加自定义头（如 X-Request-Id）。
 */
export function openSse(res: Response, options?: { headers?: Record<string, string> }): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      res.setHeader(key, value);
    }
  }
  res.flushHeaders();
  // SSE 注释行作为初始心跳，保持连接活跃；客户端解析器应忽略以 ":" 开头的行
  res.write(": heartbeat\n\n");
}

/**
 * 写入一条 SSE 事件（async 背压感知版本，P1-2）。
 *
 * 写入前检查 `guard.isClientDisconnected()` 与 `res.writableEnded`：
 *   - 仅当客户端真正断开（req.aborted / res.close）或响应已结束时跳过写入；
 *   - 服务端 totalTimeout / idleTimeout 触发的 abort 不阻断写入，确保超时后仍能向客户端
 *     推送 error 事件（否则客户端会收到 N 秒沉默后流静默关闭，无 error 事件）。
 *
 * 背压处理：当 `res.write()` 返回 false 时，await drain 事件等待内核缓冲排空，
 * 防止慢客户端场景下数据无限累积在 Node.js 内部缓冲区导致 OOM。
 * drain 等待期间注册三重保护：drain 事件、abort signal、5s 超时，
 * 确保即使 drain 不触发（如客户端断开）也能 resolve，不会永久挂起。
 */
export async function writeSse(res: Response, event: string, data: unknown, guard: AbortGuard): Promise<void> {
  if (guard.isClientDisconnected() || res.writableEnded) return;
  const ok = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!ok && !guard.isClientDisconnected() && !res.writableEnded) {
    await new Promise<void>((resolve) => {
      const onDrain = (): void => { cleanup(); resolve(); };
      const onAbort = (): void => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, 5_000);
      function cleanup(): void {
        res.off("drain", onDrain);
        guard.signal.removeEventListener("abort", onAbort);
        clearTimeout(timer);
      }
      res.once("drain", onDrain);
      guard.signal.addEventListener("abort", onAbort);
    });
  }
}

/**
 * 创建客户端断开 / 超时桥接，返回 AbortGuard。
 *
 * 监听以下断开信号：
 *   - `req.on("aborted")`：客户端主动 abort 请求
 *   - `res.on("close")`：响应连接关闭（仅在未结束时视为异常断开）
 *
 * 超时机制：
 *   - `totalTimeoutMs`（默认 180000ms = 3 分钟）：流式总时长上限，超时触发 abort
 *   - `idleTimeoutMs`（默认 30000ms = 30 秒）：无数据传输上限，超时触发 abort；
 *     每次成功写入后应调用 `resetIdleTimer()` 重置
 *
 * 调用方必须在 handler finally 块调用 `cleanup()` 移除监听器与清除计时器。
 */
export function createAbortBridge(
  req: Request,
  res: Response,
  options?: { totalTimeoutMs?: number; idleTimeoutMs?: number },
): AbortGuard {
  const controller = new AbortController();
  let aborted = false;
  // clientDisconnected 仅在 req.aborted / res.close 触发时置位；
  // totalTimeout / idleTimeout 触发的 abort 不置位，确保服务端超时后 writeSse 仍能写 error 事件。
  let clientDisconnected = false;

  const triggerAbort = (): void => {
    if (aborted) return;
    aborted = true;
    try {
      controller.abort();
    } catch {
      // controller 可能已 abort，忽略重复触发
    }
  };

  // req.aborted / res.close 仅在响应未正常结束时视为客户端断开，
  // 避免正常 res.end() 后的 close 事件误触发 abort。
  // 同时标记 clientDisconnected，使 writeSse 跳过向已断开客户端的写入。
  const onReqAborted = (): void => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      triggerAbort();
    }
  };
  const onClose = (): void => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      triggerAbort();
    }
  };

  req.on("aborted", onReqAborted);
  res.on("close", onClose);

  const totalTimeoutMs = options?.totalTimeoutMs ?? 180_000;
  const idleTimeoutMs = options?.idleTimeoutMs ?? 30_000;

  let totalTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  if (totalTimeoutMs > 0) {
    totalTimer = setTimeout(triggerAbort, totalTimeoutMs);
  }
  if (idleTimeoutMs > 0) {
    idleTimer = setTimeout(triggerAbort, idleTimeoutMs);
  }

  const resetIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(triggerAbort, idleTimeoutMs);
    }
  };

  const cleanup = (): void => {
    req.off("aborted", onReqAborted);
    res.off("close", onClose);
    if (totalTimer) {
      clearTimeout(totalTimer);
      totalTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  return {
    signal: controller.signal,
    isAborted: () => aborted,
    isClientDisconnected: () => clientDisconnected,
    cleanup,
    resetIdleTimer,
  };
}
