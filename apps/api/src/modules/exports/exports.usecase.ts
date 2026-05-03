export function resolveDownloadFile(fileName: string, userId: string):
  | { ok: true; data: { rawFileName: string; filePath: string } }
  | { ok: false; code: number; message?: string } {
  return { ok: false, code: 40401, message: "not implemented" };
}
