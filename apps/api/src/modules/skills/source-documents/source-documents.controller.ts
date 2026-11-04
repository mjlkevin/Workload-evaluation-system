import type { RequestHandler, Response } from 'express';
import { SkillError } from '../skills.types';
import { ok } from '../../../utils/response';
import type { SourceDocumentService } from './source-documents';

export function sourceUploadError(res: Response, error: unknown): void {
  const known = error instanceof SkillError;
  res.status(known ? error.status : 503).json({ code: known ? error.code : 'SOURCE_DOCUMENT_UNAVAILABLE',
    message: known ? error.message : '材料上传暂不可用', data: null });
}

/** Busboy's default Latin-1 decoding needs repair only when all bytes form valid UTF-8. */
export function sourceUploadFilename(original: string): string {
  if ([...original].some(char => char.charCodeAt(0) > 255)) return original;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(original, 'latin1')); }
  catch { return original; }
}

export function createSourceDocumentUploadHandler(service: SourceDocumentService): RequestHandler {
  return async (req, res) => {
    try {
      if (typeof req.params.sessionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.sessionId))
        throw new SkillError('SOURCE_REQUEST_INVALID', '会话标识无效', 400);
      if (!req.file || Object.keys(req.body ?? {}).length)
        throw new SkillError('SOURCE_UPLOAD_INVALID', '请仅上传一个材料文件', 400);
      const attachment = await service.upload(req.user!, req.params.sessionId, {
        bytes: req.file.buffer, name: req.file.originalname, mime: req.file.mimetype,
      });
      res.json(ok(attachment));
    } catch (error) { sourceUploadError(res, error); }
  };
}
