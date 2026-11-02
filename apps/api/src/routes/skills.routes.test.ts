import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createSkillsRouter } from './skills.routes';
import { signAuthToken } from '../middleware/auth';
import { createTestUser, cleanupTestUsers } from '../test-helpers/test-users';
import type { SkillRepository } from '../modules/skills/skills.repository';

const prefix = 'wes-skills-a-route';
after(async () => cleanupTestUsers(prefix));
const empty: SkillRepository = { list: async () => [], get: async () => null, create: async () => { throw new Error('unexpected write'); }, mutate: async () => { throw new Error('unexpected mutation'); } };
function app(repo = empty) {
  const server = express(); server.use(express.json());
  server.use('/skills', createSkillsRouter({ repo, getTools: async () => [] }));
  return request(server);
}
async function token(role: 'admin' | 'user') { return signAuthToken(await createTestUser(prefix, { role })); }

test('all Skill management reads and writes require JWT and admin capability', async () => {
  const api = app();
  assert.equal((await api.get('/skills')).status, 401);
  assert.equal((await api.get('/skills/metadata')).status, 401);
  const user = await token('user');
  for (const path of ['/skills', '/skills/metadata', '/skills/not-found']) assert.equal((await api.get(path).set('Authorization', `Bearer ${user}`)).status, 403);
  assert.equal((await api.post('/skills').set('Authorization', `Bearer ${user}`).send({ definition: {} })).status, 403);
  assert.equal((await api.post('/skills/x/force-unlock').set('Authorization', `Bearer ${user}`).send({ revision: 1 })).status, 403);
});
test('admin receives envelope, missing record 404, invalid definition 400 and stable release gate', async () => {
  const api = app(); const admin = await token('admin');
  const list = await api.get('/skills').set('Authorization', `Bearer ${admin}`);
  assert.equal(list.status, 200); assert.equal(list.body.code, 0); assert.deepEqual(list.body.data.items, []);
  const meta = await api.get('/skills/metadata').set('Authorization', `Bearer ${admin}`);
  assert.equal(meta.status, 200); assert.equal(meta.body.data.publishAvailable, false); assert.deepEqual(meta.body.data.tools, []);
  assert.equal((await api.get('/skills/no-record').set('Authorization', `Bearer ${admin}`)).status, 404);
  const invalid = await api.post('/skills').set('Authorization', `Bearer ${admin}`).send({ definition: { name: '不完整' } });
  assert.equal(invalid.status, 400); assert.ok(invalid.body.details.length > 0);
});
test('raw persistence errors are hidden and clients cannot inject actor or publish proof', async () => {
  const admin = await token('admin'); const api = app({ ...empty, list: async () => { throw new Error('PRIVATE_DATABASE_DIAGNOSTIC'); } });
  const res = await api.get('/skills').set('Authorization', `Bearer ${admin}`);
  assert.equal(res.status, 500); assert.equal(res.body.errorCode, 'SKILL_STORE_INTERNAL');
  assert.equal(JSON.stringify(res.body).includes('PRIVATE_DATABASE_DIAGNOSTIC'), false);
  const inject = await app().post('/skills/x/checkout').set('Authorization', `Bearer ${admin}`).send({ revision: 1, actor: { id: 'forged' } });
  assert.equal(inject.status, 400); assert.equal(inject.body.errorCode, 'SKILL_INVALID_REQUEST');
});
