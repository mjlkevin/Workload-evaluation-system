import fs from "node:fs";
import path from "node:path";
import { ensureExportDir } from "../../utils/file";

/**
 * 解析下载文件 - 鉴权 + 存在性检查
 *
 * 文件名约定: `<userId>__<rawFileName>`
 *   - 路径前缀检验确保只有归属用户能下载
 *   - 文件存在性检查
 *
 * @returns
 *   - ok: true → { rawFileName, filePath }
 *   - 40301 → 该文件不归属当前 userId
 *   - 40401 → 文件不存在
 */
export function resolveDownloadFile(fileName: string, userId: string):
  | { ok: true; data: { rawFileName: string; filePath: string } }
  | { ok: false; code: number; message?: string } {
  // 1. 鉴权：文件名必须以 <userId>__ 开头
  const sep = "__";
  const sepIdx = fileName.indexOf(sep);
  if (sepIdx <= 0) {
    return { ok: false, code: 40301, message: "invalid file ownership" };
  }
  const ownerId = fileName.slice(0, sepIdx);
  const rawFileName = fileName.slice(sepIdx + sep.length);

  if (ownerId !== userId) {
    return { ok: false, code: 40301, message: "forbidden" };
  }

  // 2. 存在性
  const exportDir = ensureExportDir();
  const filePath = path.resolve(exportDir, fileName);
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: 40401, message: "file not found" };
  }

  return { ok: true, data: { rawFileName, filePath } };
}
