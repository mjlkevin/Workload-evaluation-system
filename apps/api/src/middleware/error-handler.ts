// ============================================================
// 全局错误处理中间件
// ============================================================

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { ApiError } from "../utils/errors";

function isPayloadTooLarge(err: Error): boolean {
  const anyErr = err as Error & { type?: string; status?: number };
  return anyErr.type === "entity.too.large" || anyErr.status === 413;
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[error-handler]", err);

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      code: err.statusCode * 100,
      message: err.message,
      details: err.details ?? [{ field: "server", reason: err.message }],
      requestId: randomUUID(),
    });
    return;
  }

  if (isPayloadTooLarge(err)) {
    res.status(413).json({
      code: 41301,
      message: "请求体过大，请缩小提交内容或联系管理员调大接口限制",
      details: [{ field: "body", reason: "payload_too_large" }],
      requestId: randomUUID(),
    });
    return;
  }

  res.status(500).json({
    code: 50000,
    message: "服务器内部错误",
    details: [{ field: "server", reason: err.message || "unknown_error" }],
    requestId: randomUUID(),
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
