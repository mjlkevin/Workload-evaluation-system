// ============================================================
// 请求日志中间件
// ============================================================
// 每个请求记录 method / url / status / duration / requestId
// 同时在 res.locals 上挂载 requestId 与 logger，供后续 handler 使用

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { logger, childLogger } from "../utils/logger";
import { httpRequestsTotal, httpRequestDurationSeconds } from "../metrics";

// 扩展 Express Request 类型（供内部使用）
declare global {
  namespace Express {
    interface Locals {
      requestId?: string;
      requestLogger?: import("pino").Logger;
    }
  }
}

/**
 * 请求日志与 metrics 中间件
 * - 生成 requestId
 * - 记录每个请求的开始、完成、错误
 * - 上报 Prometheus 指标
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  const startAt = process.hrtime.bigint();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const route = `${req.method} ${req.path}`;
  const requestLogger = childLogger({
    requestId,
    route,
    method: req.method,
    url: req.url,
  });
  res.locals.requestLogger = requestLogger;

  requestLogger.info({ event: "request_start" }, "→ request start");

  // 请求结束时记录
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1e6;
    const durationSec = durationMs / 1000;
    const status = res.statusCode;

    // Prometheus 指标
    httpRequestsTotal.inc({
      method: req.method,
      route: req.route?.path || req.path,
      status: String(status),
    });
    httpRequestDurationSeconds.observe(
      {
        method: req.method,
        route: req.route?.path || req.path,
      },
      durationSec
    );

    const logEntry = {
      event: "request_end" as const,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      durationSec: Math.round(durationSec * 1000) / 1000,
    };
    const msg = `${status} ← ${route} (${Math.round(durationMs)}ms)`;
    if (status >= 500) {
      requestLogger.error(logEntry, msg);
    } else if (status >= 400) {
      requestLogger.warn(logEntry, msg);
    } else {
      requestLogger.info(logEntry, msg);
    }
  });

  // 异常时记录
  res.on("error", (err: Error) => {
    requestLogger.error({ err, event: "request_error" }, "request error");
  });

  next();
}
