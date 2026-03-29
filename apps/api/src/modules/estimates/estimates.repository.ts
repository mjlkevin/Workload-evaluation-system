import fs from "node:fs";
import path from "node:path";

import { ExportHistoryItem, IdempotencyRecord } from "../../types";
import { ensureExportDir } from "../../utils/file";
import { asString, sanitizeExportNamePart } from "../../utils/helpers";

const idempotencyStore = new Map<string, IdempotencyRecord>();

export function getIdempotencyRecord(idempotencyKey: string): IdempotencyRecord | undefined {
  return idempotencyStore.get(idempotencyKey);
}

export function setIdempotencyRecord(idempotencyKey: string, record: IdempotencyRecord): void {
  idempotencyStore.set(idempotencyKey, record);
}

export function deleteIdempotencyRecord(idempotencyKey: string): void {
  idempotencyStore.delete(idempotencyKey);
}

export function parseOwnedExportFileName(fileName: string): { ownerUserId: string; rawFileName: string } | null {
  const safeName = path.basename(fileName);
  const idx = safeName.indexOf("__");
  if (idx <= 0) return null;
  const ownerUserId = safeName.slice(0, idx);
  const rawFileName = safeName.slice(idx + 2);
  if (!ownerUserId || !rawFileName) return null;
  return { ownerUserId, rawFileName };
}

function resolveExportSerialNo(ownerUserId: string, projectName: string, assessmentVersionCode: string, extension: "xlsx" | "pdf"): string {
  const exportDir = ensureExportDir();
  const used = new Set<number>();
  const files = fs.readdirSync(exportDir).filter((name) => name.endsWith(`.${extension}`));

  for (const fileName of files) {
    const parsed = parseOwnedExportFileName(fileName);
    if (!parsed || parsed.ownerUserId !== ownerUserId) continue;
    const match = parsed.rawFileName.match(/^(.+)\+(.+)\+(\d+)\.(xlsx|pdf)$/i);
    if (!match) continue;
    const rawProject = asString(match[1]);
    const rawVersion = asString(match[2]);
    const no = Number(match[3]);
    if (!Number.isFinite(no) || no <= 0) continue;
    if (rawProject === projectName && rawVersion === assessmentVersionCode) {
      used.add(no);
    }
  }

  for (let i = 1; i <= 99; i += 1) {
    if (!used.has(i)) return String(i).padStart(2, "0");
  }
  const maxNo = used.size > 0 ? Math.max(...Array.from(used.values())) : 0;
  return String(maxNo + 1).padStart(2, "0");
}

export function buildOwnedExportFileName(
  ownerUserId: string,
  extension: "xlsx" | "pdf",
  projectName: string,
  assessmentVersionCode: string
): string {
  const safeProjectName = sanitizeExportNamePart(projectName, "未命名项目");
  const safeAssessmentVersionCode = sanitizeExportNamePart(assessmentVersionCode, "V00");
  const serialNo = resolveExportSerialNo(ownerUserId, safeProjectName, safeAssessmentVersionCode, extension);
  const rawFileName = `${safeProjectName}+${safeAssessmentVersionCode}+${serialNo}.${extension}`;
  return `${ownerUserId}__${rawFileName}`;
}

export function getExportHistoryList(ownerUserId: string, page: number, pageSize: number): { total: number; items: ExportHistoryItem[] } {
  const exportDir = ensureExportDir();
  const files = fs
    .readdirSync(exportDir)
    .filter((name) => name.endsWith(".xlsx") || name.endsWith(".pdf"))
    .filter((name) => {
      const parsed = parseOwnedExportFileName(name);
      return parsed?.ownerUserId === ownerUserId;
    })
    .map((fileName) => {
      const fullPath = path.resolve(exportDir, fileName);
      const stat = fs.statSync(fullPath);
      const parsed = parseOwnedExportFileName(fileName);
      return {
        fileName: parsed?.rawFileName || fileName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        downloadUrl: `/downloads/${fileName}`,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const total = files.length;
  const start = (page - 1) * pageSize;
  const items = files.slice(start, start + pageSize).map(({ mtimeMs, ...rest }) => rest);
  return { total, items };
}
