import fs from "node:fs";
import path from "node:path";
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ensureExportDir } from "../../utils/file";
import { requireAuth } from "../../middleware/auth";
import { ok, fail } from "../../utils/response";

/**
 * 解析下载文件 - 鉴权 + 存在性检查
 *
 * 文件名约定: `<userId>__<rawFileName>`
 */
export function resolveDownloadFile(fileName: string, userId: string):
  | { ok: true; data: { rawFileName: string; filePath: string } }
  | { ok: false; code: number; message?: string } {
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

  const exportDir = ensureExportDir();
  const filePath = path.resolve(exportDir, fileName);
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: 40401, message: "file not found" };
  }

  return { ok: true, data: { rawFileName, filePath } };
}

export function downloadFile(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const fileName = String(req.params.fileName || req.params.file || "");
  if (!fileName) {
    return fail(res, 40001, "参数错误", [{ field: "fileName", reason: "required" }]);
  }

  const result = resolveDownloadFile(fileName, auth.user.id);
  if (!result.ok) {
    if (result.code === 40401) {
      return fail(res, 40401, "文件不存在或已过期", [{ field: "fileName", reason: "not_found" }]);
    }
    return fail(res, result.code, result.message || "权限不足");
  }

  const { rawFileName, filePath } = result.data;
  const ext = path.extname(rawFileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pdf": "application/pdf",
    ".json": "application/json",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(rawFileName)}`);
  res.setHeader("Cache-Control", "private, max-age=3600");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ code: 50001, message: "文件读取失败", requestId: randomUUID() });
    }
  });
}

export function history(_req: Request, res: Response) {
  // 导出历史暂未实现持久化存储，返回空列表
  res.json(ok({ total: 0, items: [] }, randomUUID()));
}
