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

// 阶段 2 S1（2026-08-25）：usersStorePath 已随 users 域 JSON 读写路径删除
// （users 恒 PG，config/auth/users.json 已移出 git 跟踪并归档）。
// 阶段 2 批 1 第 4 步：inviteCodesStorePath / passwordResetTokensStorePath
// 已随 JSON 读写路径删除（邀请码与重置令牌切 PG）。
// S2b-2（2026-08-28）：aiSessionsStorePath 已随 ai-sessions 域 JSON 读写
// 路径删除（ai-sessions 恒 PG）。与 users 域不同，data/ai-sessions.json
// 从未被 git 跟踪（.gitignore 第 59 行整目录忽略 data/），故无需 git rm --cached；
// 开工实取该文件为 {"sessions": []}（0 条会话），删读写路径不丢数据。
// 阶段 2 S3（2026-08-30）：versionCodeRulesStorePath / requirementSystemConfigStorePath /
// implementationDependencyRulesStorePath / knowledgeBaseConfigStorePath 已随 system 域
// JSON 读写路径删除（四配置恒 PG）。与 users 域不同，这四个 seed 源文件仍在版本库
// 内——它们是 db/seed.ts 的入播来源（D17「零数据迁移」口径），保留文件仅停读写；
// modelVerifyStatusPath 不属本批删除面（S3 开工盘点 C1：读写方 system-effective.ts
// 恒 JSON、PG 侧仅 seed 占位行，列入待裁）。versionsStorePath 已随 S4（2026-08-30）
// 的 versions 域 JSON 读写路径删除一并下线。

/**
 * 系统管理-模型场景最近验证状态存储路径
 */
export function modelVerifyStatusPath(): string {
  return path.resolve(resolveRootDir(), "config/system/model-verify-status.json");
}

/**
 * 原型导出源文件路径
 */
export const PROTOTYPE_EXPORT_SOURCE_XLSX_RELATIVE_PATH =
  "01_需求管理/原始需求/实施评估RR/金蝶AI星空-实施人天估算-R202602-V1.0（0303版本）.xlsx";
