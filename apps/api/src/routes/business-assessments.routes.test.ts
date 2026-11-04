import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../test-helpers/execution-database-guard';
import type { AuthUser } from '../types';
const url = resolveExecutionTestDatabaseUrl(process.env);
process.env.DATABASE_URL = url; process.env.TEST_DATABASE_URL = url; process.env.CREDENTIAL_KEK = '';
const pool = new Pool({ connectionString: url, max: 1 }), database = drizzle(pool, { schema });
const owner = { id: randomUUID(), username: `basis-http-${randomUUID()}`, role: 'admin', status: 'active', businessRole: 'pre_sales' } as AuthUser;
const foreign = { ...owner, id: randomUUID(), username: `basis-http-other-${randomUUID()}` };
let api: express.Express, token: string, foreignToken: string, recordId: string, closeDb: () => Promise<void>;
before(async () => {
 for (const user of [owner, foreign]) await database.insert(schema.users).values({ userId: user.id, username: user.username, passwordHash: randomUUID(), role: user.role, status: 'active', createdAt: new Date() });
 recordId = randomUUID(); await database.insert(schema.versionRecords).values({ recordId, type: 'assessment', ownerUserId: owner.id, versionCode: 'TEST-A0', baseCode: 'TEST-A0', templateId: 'basis-http-test', status: 'draft', payload: {}, createdAt: new Date(), updatedAt: new Date(), createdByUserId: owner.id, updatedByUserId: owner.id, createdByUsername: owner.username, updatedByUsername: owner.username });
 const auth = await import('../middleware/auth'); token = auth.signAuthToken(owner); foreignToken = auth.signAuthToken(foreign);
 closeDb = (await import('../db/client')).closeDb;
 api = express(); api.use(express.json({ limit: '2mb' })); api.use('/api/v1', (await import('./index')).default);
});
after(async () => { try {
 await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, owner.id));
 await database.delete(schema.users).where(inArray(schema.users.userId, [owner.id, foreign.id]));
 } finally { await pool.end(); if (closeDb) await closeDb(); } });
const path = (id: string, action = 'basis') => `/api/v1/business-assessments/${id}/${action}`;
test('aggregate mounted basis route uses JWT, real owner and explicit legacy response', async () => {
 assert.equal((await request(api).get(path(recordId)).set('X-Role', 'admin')).status, 401);
 const result = await request(api).get(path(recordId)).set('Authorization', `Bearer ${token}`);
 assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.code, 0); assert.deepEqual(result.body.data, { kind: 'legacy' });
 assert.equal((await request(api).get(path(recordId)).set('Authorization', `Bearer ${foreignToken}`)).status, 404);
 assert.equal((await request(api).get(path('invalid')).set('Authorization', `Bearer ${token}`)).status, 400);
 const calculated = await request(api).post(path(recordId, 'calculate')).set('Authorization', `Bearer ${token}`).send({});
 assert.equal(calculated.status, 409); assert.equal(calculated.body.data, null); assert.equal(calculated.body.errorCode, 'BUSINESS_ASSESSMENT_LEGACY');
 await database.update(schema.versionRecords).set({ payload: { creationBasis: { operationId: randomUUID() } } }).where(eq(schema.versionRecords.recordId, recordId));
 const spoofed = await request(api).get(path(recordId)).set('Authorization', `Bearer ${token}`);
 assert.equal(spoofed.status, 409); assert.equal(spoofed.body.data, null); assert.equal(spoofed.body.errorCode, 'BUSINESS_ASSESSMENT_BASIS_INVALID');
});
test('route factory keeps unknown internal errors private', async () => {
 const { createBusinessAssessmentsRouter } = await import('./business-assessments.routes');
 const broken = express(); broken.use('/api/v1/business-assessments', createBusinessAssessmentsRouter({ service: {
 read: async () => { throw Error('PRIVATE_SQL_SECRET'); }, calculate: async () => { throw Error('PRIVATE_SQL_SECRET'); }
 } as any }));
 for (const action of ['basis', 'calculate']) {
  const result = await (action === 'basis' ? request(broken).get(path(recordId)) : request(broken).post(path(recordId, action)).send({})).set('Authorization', `Bearer ${token}`);
  assert.equal(result.status, 503); assert.equal(result.body.data, null); assert.equal(JSON.stringify(result.body).includes('PRIVATE_SQL_SECRET'), false);
 }
});

test('controller own unauthenticated fallback preserves the required data envelope', async () => {
 const { createBusinessAssessmentBasisHandlers } = await import('../modules/project-evaluations/business-assessment-basis.controller');
 const direct = express(); direct.get('/direct', createBusinessAssessmentBasisHandlers().read);
 const response = await request(direct).get('/direct'); assert.equal(response.status, 401); assert.equal(response.body.data, null);
});
