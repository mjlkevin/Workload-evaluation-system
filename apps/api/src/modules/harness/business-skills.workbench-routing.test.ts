import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createAiRunsHandlers } from './harness-runtime.controller';
import { createTestUser, cleanupTestUsers } from '../../test-helpers/test-users';
import { signAuthToken } from '../../middleware/auth';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
resolveExecutionTestDatabaseUrl(process.env);
let token = '';
before(async () => { token = signAuthToken(await createTestUser('wes-c3-routing', { role: 'admin' })); });
after(async () => { await cleanupTestUsers('wes-c3-routing'); await closeDb(); });

function fixture() {
 const calls: string[] = [];
 const result = { status: 202, data: { runId: 'owned' } };
 const handlers = createAiRunsHandlers({ usecase: {
  submitRun: async () => { calls.push('chat'); return result; },
  confirmAction: async () => { calls.push('legacy-confirm'); return result; },
  rejectAction: async () => { calls.push('legacy-reject'); return result; },
 }, business: {
  submitInvocation: async (_user: unknown, sessionId: string, body: any) => { calls.push(`business:${sessionId}:${body.execution.kind}`); return result; },
  isBusinessRun: async (_user: unknown, runId: string) => runId === 'business',
  decision: async (_user: unknown, runId: string, actionId: string, decision: string, body: any) => { calls.push(`${runId}:${actionId}:${decision}:${body.confirmationHash}`); return result; },
 } } as any);
 const app = express(); app.use(express.json());
 app.post('/:sessionId/runs', handlers.submitRunHandler);
 app.post('/runs/:runId/actions/:actionId/confirm', handlers.confirmActionHandler);
 app.post('/runs/:runId/actions/:actionId/reject', handlers.rejectActionHandler);
 return { app, calls };
}
test('explicit execution selects the business invocation entrypoint and preserves original request', async () => {
 const { app, calls } = fixture();
 const response = await request(app).post('/session/runs').set('Authorization', `Bearer ${token}`).send({ submissionKey: 's', content: 'Start', execution: { kind: 'skill', skillId: 's1', input: {} } });
 assert.equal(response.status, 202); assert.deepEqual(calls, ['business:session:skill']);
});
test('ordinary chat submission keeps the original path', async () => {
 const { app, calls } = fixture();
 const response = await request(app).post('/session/runs').set('Authorization', `Bearer ${token}`).send({ submissionKey: 's', content: 'Hello' });
 assert.equal(response.status, 202); assert.deepEqual(calls, ['chat']);
});

test('business confirmation and rejection carry the live hash on separate explicit decisions; legacy actions keep their channel', async () => {
 const { app, calls } = fixture();
 for (const decision of ['confirm', 'reject']) {
  const response = await request(app).post(`/runs/business/actions/action/${decision}`).set('Authorization', `Bearer ${token}`).send({ confirmationHash: 'bound-hash' });
  assert.equal(response.status, 202);
 }
 const legacy = await request(app).post('/runs/chat/actions/action/confirm').set('Authorization', `Bearer ${token}`).send({ confirmationHash: 'ignored-by-legacy' });
 assert.equal(legacy.status, 202);
 assert.deepEqual(calls, ['business:action:approve:bound-hash', 'business:action:reject:bound-hash', 'legacy-confirm']);
});
