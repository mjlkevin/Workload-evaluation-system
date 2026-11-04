import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import * as XLSX from 'xlsx';
import * as schema from '../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../test-helpers/execution-database-guard';
import type { AuthUser } from '../types';

// Resolve the guard before dynamic application imports can load dotenv/default DB.
const url = resolveExecutionTestDatabaseUrl(process.env);
process.env.DATABASE_URL = url;
process.env.TEST_DATABASE_URL = url;
process.env.CREDENTIAL_KEK = '';
const pool = new Pool({ connectionString: url, max: 2 });
const database = drizzle(pool, { schema });
const owner = { id: randomUUID(), username: `source-http-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const foreign = { ...owner, id: randomUUID(), username: `source-http-${randomUUID()}` };
const sessions: string[] = [];
let api: express.Express, token: string, foreignToken: string;
let closeDb: () => Promise<void>;
before(async () => {
  await database.insert(schema.users).values([owner, foreign].map(user => ({ userId: user.id, username: user.username,
    passwordHash: randomUUID(), role: user.role, businessRole: 'pre_sales', status: 'active' as const, createdAt: new Date() })));
  const auth = await import('../middleware/auth');
  token = auth.signAuthToken(owner); foreignToken = auth.signAuthToken(foreign);
  closeDb = (await import('../db/client')).closeDb;
  const routes = (await import('./index')).default;
  api = express(); api.use(express.json()); api.use('/api/v1', routes);
});
after(async () => {
  try {
    if (sessions.length) await database.delete(schema.aiSessions).where(inArray(schema.aiSessions.sessionId, sessions));
    await database.delete(schema.users).where(inArray(schema.users.userId, [owner.id, foreign.id]));
    assert.equal((await database.select().from(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, owner.id))).length, 0);
  } finally { await pool.end(); if (closeDb) await closeDb(); }
});
async function session() {
  const sessionId = randomUUID(); sessions.push(sessionId);
  await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: owner.id, ownerUsername: owner.username,
    title: 'HTTP source fixture', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales',
    status: 'temporary_chat', attachments: [], messages: [], artifacts: [], pendingActions: [], createdAt: new Date(), updatedAt: new Date() });
  return sessionId;
}
const path = (id: string) => `/api/v1/ai-sessions/${id}/execution-sources`;
const upload = (id: string, auth = token) => request(api).post(path(id)).set('Authorization', `Bearer ${auth}`);
async function stored(id: string): Promise<any[]> {
  return (await database.select().from(schema.aiSessions).where(eq(schema.aiSessions.sessionId, id)))[0].attachments as any[];
}
function multipart(id: string, name: string, bytes = Buffer.from('source'), extraHeaders = '', auth = token) {
  const boundary = 'wes-source-http-boundary';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n${extraHeaders}\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return upload(id, auth).set('Content-Type', `multipart/form-data; boundary=${boundary}`).send(body);
}
function publicOnly(value: any) {
  assert.equal(value.sourceAvailable, true); assert.match(value.sourceDigest, /^[a-f0-9]{64}$/);
  for (const key of ['sourceDocument', 'canonicalText', 'cells', 'bytes']) assert.equal(key in value, false);
  assert.equal(JSON.stringify(value).includes('PRIVATE_SOURCE'), false);
}

test('production aggregate route authenticates before parsing; X-Role and invalid JWT cannot upload', async () => {
  const id = await session();
  for (const auth of ['', 'Bearer invalid']) {
    const response = await request(api).post(path(id)).set('X-Role', 'admin').set('Authorization', auth)
      .set('Content-Type', 'multipart/form-data; boundary=broken').send('malformed');
    assert.equal(response.status, 401);
  }
  assert.deepEqual(await stored(id), []);
});

test('real UTF-8 txt/md and xlsx uploads persist source and expose metadata on refresh only', async () => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['PRIVATE_SOURCE', 12]]), '需求');
  const cases = [ { name: '真实需求.txt', bytes: Buffer.from('PRIVATE_SOURCE\n中文需求'), mime: 'text/plain' },
    { name: '说明.md', bytes: Buffer.from('# PRIVATE_SOURCE\n材料'), mime: 'text/markdown' },
    { name: '范围.xlsx', bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } ];
  for (const file of cases) {
    const id = await session(); const response = await upload(id).attach('file', file.bytes, { filename: file.name, contentType: 'application/octet-stream' });
    assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.body.code, 0);
    const attachment = response.body.data; publicOnly(attachment);
    assert.equal(attachment.name, file.name); assert.equal(attachment.type, file.mime); assert.equal(attachment.size, file.bytes.length);
    assert.ok(attachment.sourceCharCount > 0);
    const persisted = (await stored(id))[0]; assert.equal(persisted.attachmentId, attachment.attachmentId);
    assert.equal(persisted.sourceDocument.name, file.name); assert.match(persisted.sourceDocument.canonicalText, /PRIVATE_SOURCE/);
    if (/xlsx$/.test(file.name)) assert.equal(persisted.sourceDocument.cells[0].sheet, '需求');
    else assert.equal(persisted.sourceDocument.canonicalText, file.bytes.toString());
    const refreshed = await request(api).get(`/api/v1/ai-sessions/${id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(refreshed.status, 200); publicOnly(refreshed.body.data.session.attachments[0]);
    assert.equal(refreshed.body.data.session.attachments[0].attachmentId, attachment.attachmentId);
  }
  // RFC5987 UTF-8 filename is already Unicode; Latin-1 names must survive failed UTF-8 decoding.
  for (const [header, expected] of [["filename=\"ignored.txt\"; filename*=UTF-8''%E9%9C%80%E6%B1%82.txt", '需求.txt'], ['filename="caf\xe9.txt"', 'café.txt']]) {
    const id = await session();
    const boundary = 'unicode-source';
    const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; ${header}\r\n\r\n`, 'latin1'), Buffer.from('valid'), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const result = await upload(id).set('Content-Type', `multipart/form-data; boundary=${boundary}`).send(raw);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.data.name, expected);
  }
});

test('foreign or archived sessions and live DB identity revocation cannot persist sources', async () => {
  const id = await session();
  assert.equal((await upload(randomUUID()).attach('file', Buffer.from('x'), 'x.txt')).status, 404);
  assert.equal((await upload(id, foreignToken).attach('file', Buffer.from('bad zip'), 'bad.xlsx')).status, 404);
  for (const patch of [{ status: 'disabled' as const }, { businessRole: 'delivery' }, { role: 'user' as const }]) {
    await database.update(schema.users).set(patch).where(eq(schema.users.userId, owner.id));
    try { assert.equal((await upload(id).attach('file', Buffer.from('bad zip'), 'bad.xlsx')).status, 403); }
    finally { await database.update(schema.users).set({ role: 'admin', status: 'active', businessRole: 'pre_sales' }).where(eq(schema.users.userId, owner.id)); }
  }
  await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, id));
  assert.equal((await upload(id).attach('file', Buffer.from('x'), 'x.txt')).status, 404);
  assert.deepEqual(await stored(id), []);
});

test('only one file part is accepted; JSON, base64, extra fields, files and missing file fail atomically', async () => {
  const id = await session();
  const spoof = { file: Buffer.from('forged').toString('base64'), sourceDocument: { canonicalText: 'forged' } };
  const requests = [ () => upload(id).send(spoof), () => upload(id).field('sourceDocument', JSON.stringify(spoof.sourceDocument)),
    () => upload(id).attach('file', Buffer.from('x'), 'x.txt').field('sourceDocument', '{}'),
    () => upload(id).attach('file', Buffer.from('x'), 'x.txt').attach('file', Buffer.from('y'), 'y.txt'),
    () => upload(id).attach('other', Buffer.from('x'), 'x.txt'), () => upload(id).field('base64', 'eA==') ];
  for (const pending of requests) { const response = await pending(); assert.equal(response.status, 400, JSON.stringify(response.body)); }
  assert.deepEqual(await stored(id), []);
});

test('oversize files return 413; malformed archive, unsupported extension, invalid bytes and filenames return 400', async () => {
  const id = await session();
  assert.equal((await upload(id).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 97), 'big.txt')).status, 413);
  for (const [name, bytes] of [['bad.xlsx', Buffer.from('PK invalid archive')], ['file.json', Buffer.from('{}')],
    ['binary.txt', Buffer.from([0xff, 0xfe, 0x00])]] as Array<[string, Buffer]>) {
    assert.equal((await upload(id).attach('file', bytes, name)).status, 400);
  }
  for (const name of ['../secret.txt', 'dir/secret.txt', 'C:\\\\secret.txt', 'a:b.txt', `${'a'.repeat(256)}.txt`]) {
    assert.equal((await multipart(id, name)).status, 400, name);
  }
  assert.equal((await multipart(id, 'x.txt', Buffer.from('x'), `X-Oversize: ${'a'.repeat(17000)}\r\n`)).status, 400);
  assert.deepEqual(await stored(id), []);
});

test('upload limiter keys authenticated users independently and unknown service errors stay generic', async () => {
  const { createExecutionSourcesRouter } = await import('./execution-sources.routes');
  const limited = express(); let calls = 0;
  limited.use('/api/v1/ai-sessions', createExecutionSourcesRouter({ uploadLimit: 1, service: { upload: async () => {
    calls++; return { attachmentId: randomUUID(), name: 'x.txt', createdAt: new Date().toISOString(), sourceAvailable: true, sourceDigest: 'a'.repeat(64), sourceCharCount: 1 };
  } } }));
  const id = randomUUID();
  const post = (auth: string) => request(limited).post(path(id)).set('Authorization', `Bearer ${auth}`).attach('file', Buffer.from('x'), 'x.txt');
  assert.equal((await post(token)).status, 200); assert.equal((await post(token)).status, 429);
  assert.equal((await post(foreignToken)).status, 200); assert.equal(calls, 2);
  const unavailable = express(); unavailable.use('/api/v1/ai-sessions', createExecutionSourcesRouter({ service: { upload: async () => { throw Error('PRIVATE_SECRET_SQL'); } } }));
  const response = await request(unavailable).post(path(id)).set('Authorization', `Bearer ${token}`).attach('file', Buffer.from('x'), 'x.txt');
  assert.equal(response.status, 503); assert.equal(JSON.stringify(response.body).includes('PRIVATE_SECRET_SQL'), false);
  assert.equal('stack' in response.body, false);
});

test('installed multipart parser counts the closing boundary: parts=1 rejects one file, parts=2 permits it', async () => {
  const multer = (await import('multer')).default;
  for (const [parts, expected] of [[1, 400], [2, 200]]) {
    const app = express(), parse = multer({ storage: multer.memoryStorage(), limits: { parts, files: 1, fields: 0 } }).single('file');
    app.post('/', (req, res) => parse(req, res, error => {
      res.status(error ? 400 : 200).json({ code: error?.code ?? 0 });
    }));
    const response = await request(app).post('/').attach('file', Buffer.from('x'), 'x.txt');
    assert.equal(response.status, expected);
    if (parts === 1) assert.equal(response.body.code, 'LIMIT_PART_COUNT');
  }
});


test('malformed session IDs return stable 400 without invoking the service or exposing DB errors', async () => {
  const { createExecutionSourcesRouter } = await import('./execution-sources.routes');
  const app = express(); let calls = 0;
  app.use('/api/v1/ai-sessions', createExecutionSourcesRouter({ service: { upload: async () => { calls++; throw Error('PRIVATE_DB'); } } }));
  for (const id of ['not-a-uuid', '0'.repeat(36), '1234']) {
    const response = await request(app).post(path(id)).set('Authorization', `Bearer ${token}`).attach('file', Buffer.from('x'), 'x.txt');
    assert.equal(response.status, 400); assert.equal(response.body.code, 'SOURCE_REQUEST_INVALID');
    assert.equal(response.body.data, null); assert.equal(JSON.stringify(response.body).includes('PRIVATE_DB'), false);
  }
  assert.equal(calls, 0);
});
