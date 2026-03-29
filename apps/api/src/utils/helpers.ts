// ============================================================
// 加密与通用工具 - 从 main.ts 提取
// ============================================================

import { randomUUID } from "node:crypto";

/**
 * 字符串转换（安全）
 */
export function asString(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * 四舍五入到小数点后一位
 */
export function round1(input: number): number {
  return Math.round(input * 10) / 10;
}

/**
 * 应用取整模式
 */
export function applyRounding(value: number, mode: "none" | "ceil_int" = "none"): number {
  if (mode === "ceil_int") {
    return Math.ceil(value);
  }
  return round1(value);
}

/**
 * 规范化单元格文本（去除空白）
 */
export function normalizeCellText(value: unknown): string {
  return asString(value).replace(/\s+/g, "");
}

/**
 * 解析默认包含状态
 */
export function parseDefaultIncluded(value: unknown): boolean {
  const raw = asString(value).toLowerCase();
  return raw === "√" || raw === "v" || raw === "true" || raw === "1" || raw === "y" || raw === "yes";
}

/**
 * 解析单元格数字
 */
export function parseCellNumber(value: unknown): number {
  const text = asString(value).replace(/[^\d.-]/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 生成邀请码
 */
export function generateInviteCode(existingCodes: Set<string>): string {
  const date = new Date();
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  for (let i = 0; i < 50; i += 1) {
    const tail = Math.random().toString(36).slice(2, 8).toUpperCase();
    const code = `KD-${y}${m}${d}-${tail}`;
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  return `KD-${y}${m}${d}-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * 清理导出文件名部分
 */
export function sanitizeExportNamePart(value: string, fallback: string): string {
  const cleaned = asString(value)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}
