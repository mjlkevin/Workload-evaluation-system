// ============================================================
// 文件工具 - 从 main.ts 提取
// ============================================================

import fs from "node:fs";
import path from "node:path";

/**
 * 解析项目根目录
 */
export function resolveRootDir(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "..", "..")];
  for (const baseDir of candidates) {
    if (fs.existsSync(path.resolve(baseDir, "config"))) {
      return baseDir;
    }
  }
  return process.cwd();
}

/**
 * 加载 JSON 文件
 */
export function loadJsonFile<T>(relativePath: string): T {
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "..", "..", relativePath)
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  }
  throw new Error(`Config file not found: ${relativePath}`);
}

/**
 * 保存 JSON 文件
 */
export function saveJsonFile(relativePath: string, data: unknown): void {
  const filePath = path.resolve(resolveRootDir(), relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 确保导出目录存在
 */
export function ensureExportDir(): string {
  const exportDir = path.resolve(resolveRootDir(), "exports");
  fs.mkdirSync(exportDir, { recursive: true });
  return exportDir;
}

/**
 * 用户存储路径
 */
export function usersStorePath(): string {
  return path.resolve(resolveRootDir(), "config/auth/users.json");
}

/**
 * 邀请码存储路径
 */
export function inviteCodesStorePath(): string {
  return path.resolve(resolveRootDir(), "config/auth/invite-codes.json");
}

/**
 * 版本存储路径
 */
export function versionsStorePath(): string {
  return path.resolve(resolveRootDir(), "config/versions/records.json");
}

/**
 * 版本号编码规则存储路径
 */
export function versionCodeRulesStorePath(): string {
  return path.resolve(resolveRootDir(), "config/versions/version-code-rules.json");
}

/**
 * 原型导出源文件路径
 */
export const PROTOTYPE_EXPORT_SOURCE_XLSX_RELATIVE_PATH =
  "01_需求管理/原始需求/实施评估RR/金蝶AI星空-实施人天估算-R202602-V1.0（0303版本）.xlsx";
