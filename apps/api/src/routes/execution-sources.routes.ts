import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { requireCapability } from '../rbac/middleware';
import { SkillError } from '../modules/skills/skills.types';
import { createSourceDocumentService, type SourceDocumentService } from '../modules/skills/source-documents/source-documents';
import { createSourceDocumentUploadHandler, sourceUploadError, sourceUploadFilename } from '../modules/skills/source-documents/source-documents.controller';

type Options = { service?: SourceDocumentService; uploadLimit?: number };
export function createExecutionSourcesRouter(options: Options = {}): Router {
  const router = Router();
  const limit = rateLimit({ windowMs: 60_000, limit: options.uploadLimit ?? 60,
    standardHeaders: true, legacyHeaders: false, keyGenerator: req => `user:${req.user!.id}`,
    message: { code: 'SOURCE_UPLOAD_RATE_LIMIT', message: '材料上传过于频繁，请稍后重试', data: null } });
  const upload = multer({ storage: multer.memoryStorage(), preservePath: true,
    limits: {
      // Busboy emits partsLimit at the terminating boundary too; 2 permits one part.
      // files=1 + fields=0 + single('file') still reject every additional part.
      parts: 2, files: 1, fields: 0, fieldNameSize: 32, fieldSize: 0, headerPairs: 16,
      // Multer marks the exact byte limit truncated; one sentinel byte permits <=2MiB.
      fileSize: 2 * 1024 * 1024 + 1,
    },
    fileFilter: (_req, file, done) => {
      const name = sourceUploadFilename(file.originalname);
      if (!name.length || name.length > 255 || /[\x00-\x1f/\\:]/.test(name) || !/\.(xlsx|txt|md)$/i.test(name)) {
        done(new SkillError('SOURCE_DOCUMENT_INVALID', '材料格式无效或包含不支持的内容', 400)); return;
      }
      file.originalname = name; done(null, true);
    },
  }).single('file');
  router.post('/:sessionId/execution-sources', requireCapability('estimates:read'), limit, (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      sourceUploadError(res, new SkillError('SOURCE_UPLOAD_INVALID', '请仅上传一个材料文件', 400)); return;
    }
    upload(req, res, error => {
      if (!error) { next(); return; }
      if (error instanceof SkillError) { sourceUploadError(res, error); return; }
      const multerError = error instanceof multer.MulterError;
      const malformed = error instanceof Error && /^(Multipart: Boundary not found|Unexpected end of form|Malformed part header|Unexpected end of file)$/.test(error.message);
      if (!multerError && !malformed) { sourceUploadError(res, error); return; }
      const large = multerError && error.code === 'LIMIT_FILE_SIZE';
      // Busboy caps each part's headers at 16KiB; malformed headers/body are invalid input.
      sourceUploadError(res, new SkillError(large ? 'SOURCE_DOCUMENT_TOO_LARGE' : 'SOURCE_UPLOAD_INVALID',
        large ? '材料超过处理上限，请拆分后上传' : '请仅上传一个有效的材料文件', large ? 413 : 400));
    });
  }, createSourceDocumentUploadHandler(options.service ?? createSourceDocumentService()));
  return router;
}

export default createExecutionSourcesRouter();
