import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users, executionEmergencyAudits } from '../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../test-helpers/execution-database-guard';
import { createTestUser, cleanupTestUsers } from '../test-helpers/test-users';
import { signAuthToken } from '../middleware/auth';
import { createSkillsRouter } from './skills.routes';
import { createWorkflowsRouter } from './workflows.routes';
import { createSkillsPgRepository } from '../modules/skills/skills-pg.repository';
import { createWorkflowsPgRepository } from '../modules/workflows/workflows-pg.repository';
import type { AuthUser } from '../types';
resolveExecutionTestDatabaseUrl(process.env);
const prefix = 'wes-emergency-route'; let admin: AuthUser; let ordinary: AuthUser;
const api = express(); api.use(express.json()); api.use('/skills', createSkillsRouter()); api.use('/workflows', createWorkflowsRouter());
const http = request(api); const payload = { type: 'object' };
before(async () => { admin = await createTestUser(prefix, { role: 'admin' }); ordinary = await createTestUser(prefix); });
after(async () => cleanupTestUsers(prefix));
async function root(kind: 'skills' | 'workflows') {
  const actor = { id: admin.id, username: admin.username };
  const common = { name: 'Emergency fixture', description: '', category: 'test', roles: ['pre_sales'] as any, inputSchema: payload, outputSchema: payload };
  if (kind === 'skills') {
    const record = await createSkillsPgRepository().create({ ...common, instructions: 'fixture', tools: [], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } }, actor);
    return record.skillId;
  }
  return (await createWorkflowsPgRepository().create({ ...common, steps: [], outputMapping: [] }, actor)).workflowId;
}
test('admin stop and release have independent revisions and a safe envelope for both root kinds', async () => {
  for (const kind of ['skills', 'workflows'] as const) {
    const id = await root(kind); const path = `/${kind}/${id}`; const token = signAuthToken(admin);
    const stop = await http.post(`${path}/emergency-stop`).set('Authorization', `Bearer ${token}`).send({ revision: 0, reason: 'Investigate unsafe execution' });
    assert.equal(stop.status, 200); assert.equal(stop.body.code, 0);
    assert.deepEqual(stop.body.data.control, { stopped: true, epoch: 1, revision: 1 });
    const read = await http.get(`${path}/emergency-control`).set('Authorization', `Bearer ${token}`);
    assert.equal(read.status, 200); assert.equal(read.body.data.audit.length, 1);
    assert.equal(read.body.data.audit[0].actorId, admin.id); assert.equal(read.body.data.audit[0].reason, 'Investigate unsafe execution');
    assert.ok(Number.isFinite(Date.parse(read.body.data.audit[0].createdAt)));
    assert.equal((await http.post(`${path}/emergency-release`).set('Authorization', `Bearer ${token}`).send({ revision: 0, reason: 'Stale' })).status, 409);
    const release = await http.post(`${path}/emergency-release`).set('Authorization', `Bearer ${token}`).send({ revision: 1, reason: 'Reviewed; manual retry permitted' });
    assert.equal(release.status, 200); assert.deepEqual(release.body.data.control, { stopped: false, epoch: 1, revision: 2 });
  }
});
test('every emergency endpoint requires real JWT, management capability and explicit admin', async () => {
  for (const kind of ['skills', 'workflows']) {
    const id = await root(kind as 'skills' | 'workflows');
    for (const action of ['emergency-control', 'emergency-stop', 'emergency-release']) {
      const call = () => action === 'emergency-control' ? http.get(`/${kind}/${id}/${action}`) : http.post(`/${kind}/${id}/${action}`).send({ revision: 0, reason: 'test' });
      assert.equal((await call()).status, 401);
      assert.equal((await call().set('Authorization', `Bearer ${signAuthToken(ordinary)}`)).status, 403);
    }
  }
});
test('clients cannot forge audit identity, timestamp or malformed reason/revision', async () => {
  const id = await root('skills'); const auth = `Bearer ${signAuthToken(admin)}`;
  for (const body of [{ revision: 0, reason: '' }, { revision: -1, reason: 'x' }, { revision: 0.5, reason: 'x' },
    { revision: 0, reason: 'x', actorId: ordinary.id }, { revision: 0, reason: 'x', createdAt: new Date().toISOString() }]) {
    assert.equal((await http.post(`/skills/${id}/emergency-stop`).set('Authorization', auth).send(body)).status, 400);
  }
  assert.equal((await http.post('/skills/not-found/emergency-stop').set('Authorization', auth).send({ revision: 0, reason: 'x' })).status, 404);
  await db.update(users).set({ role: 'user' }).where(eq(users.userId, admin.id));
  try { assert.equal((await http.post(`/skills/${id}/emergency-stop`).set('Authorization', auth).send({ revision: 0, reason: 'x' })).status, 403); }
  finally { await db.update(users).set({ role: 'admin' }).where(eq(users.userId, admin.id)); }
});
test('audit reads return at most the latest 100 events, ordered by ascending revision with an older-history flag', async () => {
  const id = await root('skills');
  await db.insert(executionEmergencyAudits).values(Array.from({ length: 103 }, (_, i) => ({ id: randomUUID(), skillId: id, actorId: admin.id,
    action: i % 2 ? 'release' as const : 'stop' as const, reason: 'Bounded history fixture', epoch: Math.ceil((i + 1) / 2), revision: i + 1, createdAt: new Date() })));
  const read = await http.get(`/skills/${id}/emergency-control`).set('Authorization', `Bearer ${signAuthToken(admin)}`);
  assert.equal(read.status, 200); assert.equal(read.body.data.hasMore, true); assert.equal(read.body.data.audit.length, 100);
  assert.equal(read.body.data.audit[0].revision, 4); assert.equal(read.body.data.audit[99].revision, 103);
});
