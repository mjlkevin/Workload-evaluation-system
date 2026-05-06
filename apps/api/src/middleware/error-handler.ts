// ============================================================
// 全局错误处理中间件
// ============================================================

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { ApiError } from "../utils/errors";
import { logger } from "../utils/logger";

function isPayloadTooLarge(err: Error): boolean {
  const anyErr = err as Error & { type?: string; status?: number };
  return anyErr.type === "entity.too.large" || anyErr.status === 413;
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // W5-E: 同一次错误处理共享 requestId，便于客户端 vs 服务端日志对账
  const requestId = randomUUID();
  const requestLogger = res.locals.requestLogger || logger;
  requestLogger.error({ err, requestId, event: "error_handler", route: req.route?.path || req.path }, "[error-handler]");

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      code: err.statusCode * 100,
      message: err.message,
      details: err.details ?? [{ field: "server", reason: err.message }],
      requestId,
    });
    return;
  }

  if (isPayloadTooLarge(err)) {
    res.status(413).json({
      code: 41301,
      message: "请求体过大，请缩小提交内容或联系管理员调大接口限制",
      details: [{ field: "body", reason: "payload_too_large" }],
      requestId,
    });
    return;
  }

  // W5-E: 500 响应不暴露 err.message（可能含内部细节），客户端只看到 "internal_error"
  // 真实错误已通过上面的 logger.error 记录到服务端日志
  res.status(500).json({
    code: 50000,
    message: "服务器内部错误",
    details: [{ field: "server", reason: "internal_error" }],
    requestId,
  });
}

/**
 * 404 处理中间件
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    code: 40400,
    message: "资源不存在",
    details: [{ field: "path", reason: "not_found" }],
    requestId: randomUUID()
  });
}
