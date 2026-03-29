// ============================================================
// 全局错误处理中间件
// ============================================================

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

/**
 * 全局错误处理中间件
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[error-handler]", err);
  
  res.status(500).json({
    code: 50000,
    message: "服务器内部错误",
    details: [{ field: "server", reason: err.message || "unknown_error" }],
    requestId: randomUUID()
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
