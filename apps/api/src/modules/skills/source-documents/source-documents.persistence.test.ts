import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../../test-helpers/execution-database-guard';
import { createAiSessionsPgRepository } from '../../ai-sessions/ai-sessions-pg.repository';
import { appendAiSessionEvent } from '../../ai-sessions/ai-sessions.usecase';
import { closeDb } from '../../../db/client';
import { createInvocationPgRepository } from '../skills.invocation-pg.repository';
import { skillDefinitionHash as hash } from '../skills.hash';
import { createSourceDocumentService } from './source-documents';
import { parseSourceDocument } from './source-document';
import type { AuthUser } from '../../../types';

const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 3 });
const database = drizzle(pool, { schema });
const owner = { id: randomUUID(), username: `source-upload-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const foreign = { ...owner, id: randomUUID(), username: `source-upload-${randomUUID()}` };
const sessions: string[] = [], service = createSourceDocumentService(database), invocations = createInvocationPgRepository(database);
const ready = database.insert(schema.users).values([owner, foreign].map(u => ({ userId: u.id, username: u.username, role: u.role,
  businessRole: 'pre_sales', status: 'active' as const, passwordHash: randomUUID(), createdAt: new Date() }))).then(() => undefined);
after(async () => {
  try {
    if (sessions.length) await database.delete(schema.aiSessions).where(inArray(schema.aiSessions.sessionId, sessions));
    await database.delete(schema.users).where(inArray(schema.users.userId, [owner.id, foreign.id]));
    assert.equal(Number((await pool.query('SELECT count(*) n FROM ai_sessions WHERE owner_user_id=ANY($1)', [[owner.id, foreign.id]])).rows[0].n), 0);
  } finally { await pool.end(); await closeDb(); }
});
async function session() {
  await ready; const sessionId = randomUUID(); sessions.push(sessionId);
  await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: owner.id, ownerUsername: owner.username, title: 'Source upload fixture',
    domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', messages: [],
    attachments: [], artifacts: [], pendingActions: [], createdAt: new Date(), updatedAt: new Date() });
  return sessionId;
}
const file = (text = '  真实材料\n完整保留  ') => ({ bytes: Buffer.from(text), name: 'requirements.md', mime: 'text/markdown' });
const rejected = (code: string) => (error: any) => error.code === code;
async function stored(id: string): Promise<any> {
  return (await database.select().from(schema.aiSessions).where(eq(schema.aiSessions.sessionId, id)))[0];
}

test('upload stores actual source in owned PG row; public projections never expose full text or cell data', async () => {
  const id = await session(); const uploaded = await service.upload(owner, id, file());
  assert.match(uploaded.attachmentId, /^[a-f0-9-]{36}$/);
  assert.equal(uploaded.sourceAvailable, true);
  const row = await stored(id), attachment = row.attachments[0];
  assert.equal(attachment.sourceDocument.canonicalText, file().bytes.toString());
  assert.equal(attachment.sourceDocument.schemaVersion, 1);
  const repo = createAiSessionsPgRepository(database);
  const publicRecord = await repo.findSession({ ownerUserId: owner.id, sessionId: id });
  const publicAttachment = publicRecord!.attachments[0] as any;
  assert.equal(publicAttachment.sourceAvailable, true);
  for (const value of [uploaded, publicAttachment]) {
    assert.equal('sourceDocument' in value, false);
    assert.equal('canonicalText' in value, false);
    assert.equal('cells' in value, false);
    assert.equal(JSON.stringify(value).includes('真实材料'), false);
  }
  const prepared = await invocations.prepare(owner, id, [{ kind: 'file', id: uploaded.attachmentId }]);
  const body = { id: uploaded.attachmentId, kind: 'file', text: file().bytes.toString(), location: 'requirements.md' };
  assert.deepEqual(prepared.sourceMaterials, [{ ...body, digest: hash(body) }]);
  await database.transaction(tx => prepared.verify(tx));
  attachment.sourceDocument.canonicalText += 'changed';
  await database.update(schema.aiSessions).set({ attachments: [attachment] }).where(eq(schema.aiSessions.sessionId, id));
  await assert.rejects(database.transaction(tx => prepared.verify(tx)), rejected('INVOCATION_SOURCE_CHANGED'));
});

test('foreign owner, inactive DB user and archived session cannot write even with valid old caller metadata', async () => {
  const id = await session();
  await assert.rejects(service.upload(foreign, id, file()), rejected('INVOCATION_NOT_FOUND'));
  await database.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, owner.id));
  try { await assert.rejects(service.upload(owner, id, file()), rejected('INVOCATION_FORBIDDEN')); }
  finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, owner.id)); }
  await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, id));
  await assert.rejects(service.upload(owner, id, file()), rejected('INVOCATION_NOT_FOUND'));
  assert.deepEqual((await stored(id)).attachments, []);
});

test('ownership and live identity are checked before malformed input reaches the parser', async () => {
  const id = await session(), malformed = { bytes: Buffer.from('not a workbook'), name: 'bad.xlsx', mime: '' };
  await assert.rejects(service.upload(foreign, id, malformed), rejected('INVOCATION_NOT_FOUND'));
  await database.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, owner.id));
  try { await assert.rejects(service.upload(owner, id, malformed), rejected('INVOCATION_FORBIDDEN')); }
  finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, owner.id)); }
  assert.deepEqual((await stored(id)).attachments, []);
});

test('identity and session changes during parsing reject at final transaction without holding DB locks', async () => {
  for (const mutation of ['identity', 'session'] as const) {
    const id = await session();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const parsing = new Promise<void>(resolve => { started = resolve; });
    const paused = createSourceDocumentService(database, async file => {
      started(); await gate; return parseSourceDocument(file);
    });
    const upload = paused.upload(owner, id, file());
    const rejection = assert.rejects(upload, rejected(mutation === 'identity' ? 'INVOCATION_FORBIDDEN' : 'INVOCATION_NOT_FOUND'));
    await parsing;
    try {
      // A lock held across parsing would make this transaction hit lock_timeout.
      await database.transaction(async tx => {
        await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`);
        if (mutation === 'identity') await tx.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, owner.id));
        else await tx.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, id));
      });
    } finally { release(); }
    try { await rejection; assert.deepEqual((await stored(id)).attachments, []); }
    finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, owner.id)); }
  }
});

test('concurrent uploads and ordinary message append preserve all fields and session source limits', async () => {
  const id = await session(); const repo = createAiSessionsPgRepository(database);
  const message = { messageId: randomUUID(), role: 'user' as const, content: 'same-session concurrent message', createdAt: new Date().toISOString() };
  await Promise.all([service.upload(owner, id, file('A')), service.upload(owner, id, file('B')),
    repo.appendSessionEvent({ ownerUserId: owner.id, sessionId: id, messages: [message] })]);
  const row = await stored(id); assert.equal(row.attachments.length, 2); assert.deepEqual(row.messages, [message]);
  for (let i = 0; i < 8; i++) await service.upload(owner, id, file(`${i}`));
  await assert.rejects(service.upload(owner, id, file('overflow')), rejected('SOURCE_SESSION_LIMIT'));
  const large = await session();
  await service.upload(owner, large, file('a'.repeat(200000)));
  await service.upload(owner, large, file('b'.repeat(200000)));
  await assert.rejects(service.upload(owner, large, file('c'.repeat(100001))), rejected('SOURCE_SESSION_LIMIT'));
});

test('legacy HTTP append cannot forge or overwrite server sourceDocument; duplicate spoofed IDs fail closed', async () => {
  const id = await session(); const real = await service.upload(owner, id, file());
  await appendAiSessionEvent(owner, id, { attachments: [{ name: 'forged.md', attachmentId: 'forged',
    parsedSummary: 'untrusted summary', sourceDocument: { schemaVersion: 1, canonicalText: 'forged' } } as any] });
  const forged = (await stored(id)).attachments.find((a: any) => a.attachmentId === 'forged');
  assert.equal(forged.sourceDocument, undefined);
  const legacy = await invocations.prepare(owner, id, [{ kind: 'file', id: 'forged' }]);
  assert.deepEqual(legacy.sourceMaterials, []);
  await appendAiSessionEvent(owner, id, { attachments: [{ name: 'spoof.md', attachmentId: real.attachmentId, parsedSummary: 'spoof' }] });
  const row = await stored(id);
  assert.equal(row.attachments.find((a: any) => a.name === 'requirements.md').sourceDocument.canonicalText, file().bytes.toString());
  await assert.rejects(invocations.prepare(owner, id, [{ kind: 'file', id: real.attachmentId }]), rejected('INVOCATION_NOT_FOUND'));
});
