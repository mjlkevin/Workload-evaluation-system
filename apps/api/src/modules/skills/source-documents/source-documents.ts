import { db, type Database } from '../../../db/client';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { aiSessions, users } from '../../../db/schema';
import { readDbNow } from '../../../db/now';
import { isBusinessRole, resolveBusinessRole } from '../../../middleware/auth';
import type { AuthUser } from '../../../types';
import type { AiAttachment } from '../../ai-sessions/ai-sessions.types';
import { SkillError } from '../skills.types';
import { parseSourceDocument, type SourceFile } from './source-document';
import { publicSourceAttachment, storedSourceDocument } from './source-document.projection';

export type SourceAttachment = AiAttachment & { sourceAvailable: true; sourceDigest: string; sourceCharCount: number };
export type SourceDocumentService = { upload(user: AuthUser, sessionId: string, file: SourceFile): Promise<SourceAttachment> };
export function createSourceDocumentService(database: Database = db, parse = parseSourceDocument): SourceDocumentService {
  return { async upload(user, sessionId, file) {
    try {
      // Reject stale identities and foreign sessions before spending parser resources. No DB lock spans parsing.
      const authorize = async (executor: Pick<Database, 'select'>, lock = false) => {
        const userQuery = executor.select().from(users).where(eq(users.userId, user.id));
        const [current] = await (lock ? userQuery.for('share') : userQuery);
        if (!current || current.status !== 'active' || current.role !== user.role || user.status !== 'active'
          || resolveBusinessRole({ role: current.role, businessRole: isBusinessRole(current.businessRole) ? current.businessRole : undefined }) !== resolveBusinessRole(user))
          throw new SkillError('INVOCATION_FORBIDDEN', '当前权限已变化', 403);
        const sessionQuery = executor.select().from(aiSessions)
          .where(and(eq(aiSessions.sessionId, sessionId), eq(aiSessions.ownerUserId, user.id)));
        const [session] = await (lock ? sessionQuery.for('update') : sessionQuery);
        if (!session || session.status === 'archived') throw new SkillError('INVOCATION_NOT_FOUND', '资源不存在', 404);
        return session;
      };
      await authorize(database);
      const sourceDocument = await parse(file);
      return await database.transaction(async tx => {
        const session = await authorize(tx, true);
        const attachments = Array.isArray(session.attachments) ? session.attachments as Record<string, unknown>[] : [];
        const documents = attachments.map(storedSourceDocument).filter((item): item is NonNullable<typeof item> => !!item);
        if (documents.length >= 10 || documents.reduce((sum, document) => sum + document.canonicalText.length, 0) + sourceDocument.canonicalText.length > 500000)
          throw new SkillError('SOURCE_SESSION_LIMIT', '会话材料已达上限，请使用新会话', 409);
        const now = await readDbNow(tx), attachment = { attachmentId: randomUUID(), name: sourceDocument.name, size: sourceDocument.size,
          type: sourceDocument.mime, createdAt: now.toISOString(), sourceDocument };
        await tx.update(aiSessions).set({ attachments: [...attachments, attachment], updatedAt: now })
          .where(and(eq(aiSessions.sessionId, sessionId), eq(aiSessions.ownerUserId, user.id)));
        return publicSourceAttachment(attachment) as SourceAttachment;
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      throw new SkillError('SOURCE_DOCUMENT_INTERNAL', '材料上传暂不可用', 500);
    }
  } };
}
