import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createWorkflowsRouter } from './workflows.routes';
import { createSkillsRouter } from './skills.routes';
import { signAuthToken } from '../middleware/auth';
import { createTestUser, cleanupTestUsers } from '../test-helpers/test-users';
import type { WorkflowRepository } from '../modules/workflows/workflows.repository';
const prefix = 'wes-workflow-api';
after(async () => cleanupTestUsers(prefix));
const empty: WorkflowRepository = { list: async () => [], get: async () => null, create: async () => { throw new Error('unexpected'); }, mutate: async () => { throw new Error('unexpected'); }, influences: async () => [] };
function api(repo = empty) { const app = express(); app.use(express.json()); app.use('/workflows', createWorkflowsRouter({ repo, getTools: async () => [], getSkills: async () => [] })); return request(app); }
async function token(role: 'admin' | 'user') { return signAuthToken(await createTestUser(prefix, { role })); }
test('all Workflow management reads/writes reject anonymous/nonadmin including proof and dependency endpoints', async () => {
    const client = api();
    const user = await token('user');
    for (const path of ['', '/metadata', '/x', '/x/release', '/x/dependencies']) {
        assert.equal((await client.get(`/workflows${path}`)).status, 401);
        assert.equal((await client.get(`/workflows${path}`).set('Authorization', `Bearer ${user}`)).status, 403);
    }
    for (const action of ['', '/x/checkout', '/x/checkin', '/x/undo-checkout', '/x/promote', '/x/force-unlock', '/x/validate', '/x/review', '/x/publish', '/x/rollback']) {
        assert.equal((await client.post(`/workflows${action}`).send({ revision: 1 })).status, 401);
        assert.equal((await client.post(`/workflows${action}`).set('Authorization', `Bearer ${user}`).send({ revision: 1 })).status, 403);
    }
    for (const action of ['save-draft', 'status'])
        assert.equal((await client.patch(`/workflows/x/${action}`).set('Authorization', `Bearer ${user}`).send({ revision: 1 })).status, 403);
});
test('admin gets standard envelope and server-only static proof boundary; raw DB errors are hidden', async () => {
    const admin = await token('admin');
    const client = api();
    const list = await client.get('/workflows').set('Authorization', `Bearer ${admin}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.items, []);
    const metadata = await client.get('/workflows/metadata').set('Authorization', `Bearer ${admin}`);
    assert.equal(metadata.status, 200);
    assert.deepEqual(metadata.body.data.publishedSkills, []);
    assert.equal(metadata.body.data.features.execution, false);
    assert.equal((await client.get('/workflows/x').set('Authorization', `Bearer ${admin}`)).status, 404);
    for (const action of ['validate', 'review', 'publish', 'rollback', 'checkout']) {
        const forged = await client.post(`/workflows/x/${action}`).set('Authorization', `Bearer ${admin}`).send({ revision: 1, validation: { valid: true }, actor: { id: 'forged' } });
        assert.equal(forged.status, 400);
        assert.equal(forged.body.errorCode, 'WORKFLOW_INVALID_REQUEST');
    }
    const failed = await api({ ...empty, list: async () => { throw new Error('PRIVATE_DATABASE_URL'); } }).get('/workflows').set('Authorization', `Bearer ${admin}`);
    assert.equal(failed.status, 500);
    assert.equal(JSON.stringify(failed.body).includes('PRIVATE_DATABASE_URL'), false);
    assert.equal((await client.get('/workflows/x/dependencies?versionId=a&versionId=b').set('Authorization', `Bearer ${admin}`)).status, 400);
});
test('Skill influence endpoint is management-only and forwards exact historical version filter', async () => {
    const app = express();
    app.use(express.json());
    let seen: unknown[] = [];
    app.use('/skills', createSkillsRouter({ getTools: async () => [], getInfluences: async (...args) => { seen = args; return [{ workflowId: 'wf', history: true, archived: true, binding: 'fixed' }]; } }));
    const client = request(app);
    const user = await token('user');
    const admin = await token('admin');
    assert.equal((await client.get('/skills/s/influences')).status, 401);
    assert.equal((await client.get('/skills/s/influences').set('Authorization', `Bearer ${user}`)).status, 403);
    const response = await client.get('/skills/s/influences?skillVersionId=old-published').set('Authorization', `Bearer ${admin}`);
    assert.equal(response.status, 200);
    assert.deepEqual(seen, ['s', 'old-published']);
    assert.equal(response.body.data.items[0].binding, 'fixed');
});
