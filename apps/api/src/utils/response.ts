// ============================================================
// 响应工具 - 从 main.ts 提取
// ============================================================

import { Response } from "express";
import { randomUUID } from "node:crypto";

/**
 * 成功响应
 */
export function ok(data: unknown, requestId?: string) {
  return requestId ? { code: 0, message: "ok", data, requestId } : { code: 0, message: "ok", data };
}

/**
 * 失败响应
 */
export function fail(
  res: Response,
  code: number,
  message: string,
  details?: Array<{ field: string; reason: string }>
) {
  const status =
    code >= 40400 && code < 40500
      ? 404
      : code >= 40900 && code < 41000
        ? 409
        : code >= 40300 && code < 40400
          ? 403
          : code >= 40100 && code < 40200
            ? 401
            : 400;
  return res.status(status).json({
    code,
    message,
    details: details || [],
    requestId: randomUUID()
  });
}

/**
 * 未授权响应
 */
export function unauthorized(
  res: Response,
  code: number,
  message: string,
  details?: Array<{ field: string; reason: string }>
) {
  return res.status(401).json({
    code,
    message,
    details: details || [],
    requestId: randomUUID()
  });
}
