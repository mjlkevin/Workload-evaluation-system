import { and, eq } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { aiSessions, users } from '../../db/schema';
import type { AuthUser } from '../../types';
import { isBusinessRole, resolveBusinessRole } from '../../middleware/auth';
import { resolveSessionHistory, type AiSessionRecord } from '../ai-sessions/ai-sessions.module';
import { createConversationEventHistorySource, type QueueDbExecutor } from '../harness/harness.module';
import type { SourceReference } from './execution-manifest.types';
import type { InvocationRepository } from './skills.invocation';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';

function missing(): never { throw new SkillError('INVOCATION_NOT_FOUND', '资源不存在', 404); }
async function read(tx: QueueDbExecutor, user: AuthUser, sessionId: string, sources: SourceReference[]): Promise<string> {
  const [current] = await tx.select().from(users).where(eq(users.userId, user.id)).for('share');
  if (!current || current.status !== 'active' || current.role !== user.role || user.status !== 'active'
    || resolveBusinessRole({ role: current.role, businessRole: isBusinessRole(current.businessRole) ? current.businessRole : undefined }) !== resolveBusinessRole(user))
    throw new SkillError('INVOCATION_FORBIDDEN', '当前权限已变化', 403);
  const [session] = await tx.select().from(aiSessions).where(and(eq(aiSessions.sessionId, sessionId), eq(aiSessions.ownerUserId, user.id))).for('share');
  if (!session || session.status === 'archived') return missing();
  const attachments = Array.isArray(session.attachments) ? session.attachments as Record<string, unknown>[] : [];
  let messages: AiSessionRecord['messages'] = [];
  if (sources.some(source => source.kind === 'conversation')) {
    const facts = await createConversationEventHistorySource(tx, user.id, true).loadConversationFacts([sessionId]);
    messages = resolveSessionHistory(session as unknown as AiSessionRecord, facts.get(sessionId)).messages;
  }
  const values = sources.map(source => {
    const matches = source.kind === 'file' ? attachments.filter(a => a.attachmentId === source.id) : messages.filter(m => m.messageId === source.id);
    if (matches.length !== 1) return missing();
    const item = matches[0] as Record<string, unknown>;
    const content = source.kind === 'file' ? item.parsedSummary : item.content;
    if (typeof content !== 'string' || !content.trim()
      || (source.kind === 'conversation' && !['user', 'assistant'].includes(String(item.role)))) return missing();
    return { source, item };
  });
  return hash(values);
}
/** Session/source ownership stays in this PG port. Both phases use their supplied connection. */
export function createInvocationPgRepository(database: Database = db): InvocationRepository {
  return { async prepare(initialUser, sessionId, initialSources) {
    try {
      const user = structuredClone(initialUser); const sources = structuredClone(initialSources);
      const before = await database.transaction(tx => read(tx, user, sessionId, sources));
      return { async verify(tx) {
        try {
          const current = await read(tx, user, sessionId, sources);
          if (before !== current) throw new SkillError('INVOCATION_SOURCE_CHANGED', '来源材料已变化', 409);
        } catch (error) {
          if (error instanceof SkillError) throw error;
          throw new SkillError('INVOCATION_INTERNAL', '调用暂时不可用', 500);
        }
      } };
    } catch (error) {
      if (error instanceof SkillError) throw error;
      throw new SkillError('INVOCATION_INTERNAL', '调用暂时不可用', 500);
    }
  } };
}
