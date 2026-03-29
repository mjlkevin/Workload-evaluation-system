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
  return res.status(400).json({
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
