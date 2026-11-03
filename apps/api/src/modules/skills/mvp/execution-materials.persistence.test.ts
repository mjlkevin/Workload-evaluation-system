import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../../test-helpers/execution-database-guard';
import { createInvocationPgRepository } from '../skills.invocation-pg.repository';
import { skillDefinitionHash as hash } from '../skills.hash';
import type { AuthUser } from '../../../types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 2 });
const database = drizzle(pool, { schema });
const owner = { id: randomUUID(), username: `source-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const foreign = { ...owner, id: randomUUID(), username: `source-${randomUUID()}` };
const sessions: string[] = [];
const repository = createInvocationPgRepository(database);
const ready = database.insert(schema.users).values([owner, foreign].map(user => ({ userId: user.id, username: user.username, role: user.role,
  businessRole: 'pre_sales', status: 'active' as const, passwordHash: randomUUID(), createdAt: new Date() }))).then(() => undefined);
after(async () => {
  try {
  if (sessions.length) await database.delete(schema.aiSessions).where(inArray(schema.aiSessions.sessionId, sessions));
  await database.delete(schema.users).where(inArray(schema.users.userId, [owner.id, foreign.id]));
  assert.equal(Number((await pool.query('SELECT count(*) n FROM users WHERE user_id=ANY($1)', [[owner.id, foreign.id]])).rows[0].n), 0);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM ai_sessions WHERE owner_user_id=ANY($1)', [[owner.id, foreign.id]])).rows[0].n), 0);
  } finally { await pool.end(); }
});
async function session(userId = owner.id) {
  await ready; const sessionId = randomUUID(); sessions.push(sessionId);
  const message = { messageId: randomUUID(), role: 'user', content: '  真实需求原文\n精确保留空格  ', createdAt: new Date().toISOString() };
  await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: userId, ownerUsername: userId === owner.id ? owner.username : foreign.username, title: 'Material fixture', status: 'temporary_chat',
    domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', messages: [message], attachments: [{ attachmentId: 'legacy-summary', name: 'requirements.xlsx', parsedSummary: 'Client supplied summary', createdAt: message.createdAt }],
    artifacts: [], pendingActions: [], createdAt: new Date(), updatedAt: new Date() });
  return { sessionId, message };
}
test('actual owned conversation freezes exact text and detects changed owner/content before commit', async () => {
  const { sessionId, message } = await session(); const reference = { kind: 'conversation' as const, id: message.messageId };
  const prepared = await repository.prepare(owner, sessionId, [reference]);
  const body = { id: message.messageId, kind: 'conversation', text: message.content, location: `message:${message.messageId}` };
  assert.deepEqual(prepared.sourceMaterials, [{ ...body, digest: hash(body) }]);
  await database.transaction(tx => prepared.verify(tx));
  await database.update(schema.aiSessions).set({ messages: [{ ...message, content: 'changed after prepare' }] }).where(eq(schema.aiSessions.sessionId, sessionId));
  await assert.rejects(database.transaction(tx => prepared.verify(tx)), (e: any) => e.code === 'INVOCATION_SOURCE_CHANGED');
  await database.update(schema.aiSessions).set({ ownerUserId: foreign.id }).where(eq(schema.aiSessions.sessionId, sessionId));
  await assert.rejects(database.transaction(tx => prepared.verify(tx)), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
});
test('foreign session/message references fail and legacy parsedSummary never becomes frozen original text', async () => {
  const own = await session(); const other = await session(foreign.id);
  await assert.rejects(repository.prepare(owner, other.sessionId, [{ kind: 'conversation', id: other.message.messageId }]), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
  await assert.rejects(repository.prepare(owner, own.sessionId, [{ kind: 'conversation', id: other.message.messageId }]), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
  const prepared = await repository.prepare(owner, own.sessionId, [{ kind: 'file', id: 'legacy-summary' }]);
  assert.deepEqual(prepared.sourceMaterials, []); // Legacy replay metadata is verifiable; no original bytes exist to freeze.
});
