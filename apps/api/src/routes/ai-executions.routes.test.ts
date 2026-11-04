import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import express from 'express';
import request from 'supertest';
import * as schema from '../db/schema';
import { closeDb } from '../db/client';
import { resolveExecutionTestDatabaseUrl } from '../test-helpers/execution-database-guard';
import { signAuthToken } from '../middleware/auth';
import { createAiSessionsRouter } from './ai-sessions.routes';
import { createAiRunsRouter } from './ai-runs.routes';
import { createAiExecutionsRouter } from './ai-executions.routes';
import { createBusinessSkillsWorkbenchService } from '../modules/skills/skills.workbench-actions';
import { createExecutionCatalogService } from '../modules/skills/skills.workbench';
import { createSkillsPgRepository } from '../modules/skills/skills-pg.repository';
import { createWorkflowsPgRepository } from '../modules/workflows/workflows-pg.repository';
import { createWorkflowService } from '../modules/workflows/workflows.usecase';
import { createExecutionManifestService } from '../modules/skills/execution-manifest';
import { createSkillInvocationService } from '../modules/skills/skills.invocation';
import { createInvocationPgRepository } from '../modules/skills/skills.invocation-pg.repository';
import { createExecutionEmergencyRepository } from '../modules/skills/execution-emergency';
import { createHarnessRuntimeRepository } from '../modules/harness/harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry } from '../modules/harness/harness-runtime.worker';
import { createBusinessSkillsWorkflow } from '../modules/harness/business-skills.workflow';
import { createBusinessSkillsWaitService, createBusinessWorkflowWaitExecutor } from '../modules/harness/business-skills.wait';
import { createSkillRetryService } from '../modules/skills/skills.retry';
import { createExecutionAuthority } from '../modules/skills/execution-authority';
import { skillDefinitionHash as hash } from '../modules/skills/skills.hash';
import type { AuthUser } from '../types';
import type { SkillDefinition } from '../modules/skills/skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `http-c3-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const other = { ...user, id: randomUUID(), username: `http-c3-other-${randomUUID()}` };
const token = signAuthToken(user), otherToken = signAuthToken(other), actor = { id: user.id, username: user.username };
const inventory = async () => ({ tools: [], registry: { get: () => undefined }, policy: { schemaVersion: 1, policies: {} } }) as any;
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const definition: SkillDefinition = { name: 'HTTP skill', description: '', category: 'fixture', instructions: 'PRIVATE', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
 references: [], tools: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: [], snapshot: { schemaVersion: 1, references: [], tools: [], roles: ['ADMIN'], model: {
 providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'PRIVATE', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), authority: createExecutionEmergencyRepository(database), prepareExecution: manifests.prepareExecution });
const retryService = createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { assert.fail('Retry preparation cannot dispatch'); } }) });
const business = createBusinessSkillsWorkbenchService({ database, repo: queue, inventory, invocation, retryService });
const catalog = createExecutionCatalogService({ database, inventory, loadSkillContext: async () => ({ tools: [] }) as any });
function app(enabled = true) {
 const a = express(); a.use(express.json()); a.use('/ai-sessions', createAiSessionsRouter({ repo: queue, enabled, business } as any));
 a.use('/ai-runs', createAiRunsRouter({ repo: queue, enabled, business } as any)); a.use('/ai-executions', createAiExecutionsRouter({ enabled, business, catalog })); return a;
}
const api = app();
async function session() { const id = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId: id, ownerUserId: user.id, ownerUsername: user.username, title: 'HTTP C3', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() }); return id; }
async function skill(published = true) { const roots = createSkillsPgRepository(database); let root = await roots.create(definition, actor); if (published) root = await roots.mutate(root.skillId, root.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; }); return root; }
const start = (id: string, execution?: unknown) => request(api).post(`/ai-sessions/${id}/runs`).set('Authorization', `Bearer ${token}`).send({ submissionKey: randomUUID(), content: 'Start task', ...(execution === undefined ? {} : { execution }) });
const snapshot = (id: string, auth = token) => request(api).get(`/ai-runs/${id}`).set('Authorization', `Bearer ${auth}`);
async function workflow() {
 const repository = createWorkflowsPgRepository(database), service = createWorkflowService(repository, async () => ({ context: { skills: [], tools: [] }, snapshot: { schemaVersion: 1, skills: [], tools: [] }, hash: hash('empty') }), user);
 let root = await service.create({ name: 'HTTP wait', description: '', category: 'fixture', roles: ['pre_sales'], inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { text: { type: 'string' }, approved: { type: 'boolean' } }, required: ['text', 'approved'], additionalProperties: false },
 steps: [{ id: 'question', name: 'Question', type: 'userInput', prompt: 'Provide text', inputSchema: { type: 'object' }, outputSchema: payload, inputMapping: [], onFailure: 'fail' },
 { id: 'confirm', name: 'Confirm', type: 'confirmation', prompt: 'Confirm task', inputSchema: { type: 'object' }, inputMapping: [], onFailure: 'fail' }],
 outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.question.output.text' } }, { target: 'approved', source: { kind: 'path', path: '$.steps.confirm.output.approved' } }] });
 root = await service.validate(root.workflowId, root.revision); root = await service.review(root.workflowId, root.revision, 'HTTP fixture'); return service.publish(root.workflowId, root.revision);
}
async function tick() {
 const executor = createBusinessWorkflowWaitExecutor(createBusinessSkillsWaitService(database));
 const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor, createAuthority: () => createExecutionAuthority(database, inventory) })]);
 await createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID() }).runNextAttempt();
}
before(async () => { for (const u of [user, other]) await database.insert(schema.users).values({ userId: u.id, username: u.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { for (const u of [user, other]) { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, u.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, u.id)); await database.delete(schema.users).where(eq(schema.users.userId, u.id));
 assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, u.id))).length, 0); } await pool.end(); await closeDb(); });
test('JWT protects catalog and session business discovery; X-Role cannot grant access', async () => {
 assert.equal((await request(api).get('/ai-executions/catalog').set('X-Role', 'admin')).status, 401);
 const root = await skill(), response = await request(api).get('/ai-executions/catalog').set('Authorization', `Bearer ${token}`);
 assert.equal(response.status, 200); assert.equal(response.body.data.items.some((i: any) => i.id === root.skillId), true);
 assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false);
});
test('business submission uses strict parser, owner boundary and immutable version; ordinary chat is unchanged', async () => {
 const root = await skill(), id = await session(), execution = { kind: 'skill', skillId: root.skillId, input: { text: 'Owned' } };
 const response = await start(id, execution); assert.equal(response.status, 202); const runId = response.body.data.runId;
 const first = await snapshot(runId); assert.equal(first.status, 200); assert.equal(first.body.data.businessExecution.target.versionId, root.currentVersionId);
 assert.equal('executionConfig' in first.body.data.run, false); assert.equal('metadata' in first.body.data.run, false); assert.equal(JSON.stringify(first.body).includes('PRIVATE'), false);
 assert.equal((await snapshot(runId, otherToken)).status, 404);
 const list = await request(api).get(`/ai-executions/runs?sessionId=${id}`).set('Authorization', `Bearer ${token}`);
 assert.equal(list.status, 200); assert.equal(list.body.data.items[0].runId, runId); assert.equal(list.body.data.items[0].hasBusinessExecution, true);
 assert.equal((await request(api).get(`/ai-executions/runs?sessionId=${id}`).set('Authorization', `Bearer ${otherToken}`)).status, 404);
 const chat = await start(await session()); assert.equal(chat.status, 202); const chatView = await snapshot(chat.body.data.runId);
 assert.equal('businessExecution' in chatView.body.data, false); assert.equal('executionConfig' in chatView.body.data.run, true);
 await database.update(schema.harnessRuns).set({ status: 'cancelled' }).where(eq(schema.harnessRuns.harnessRunId, chat.body.data.runId));
 await database.update(schema.harnessRuns).set({ status: 'cancelled' }).where(eq(schema.harnessRuns.harnessRunId, runId));
});
test('draft, forged id and extra authority fields are rejected atomically; disabled flag remains 503', async () => {
 const root = await skill(false), id = await session();
 for (const execution of [{ kind: 'skill', skillId: root.skillId, input: { text: 'x' } }, { kind: 'skill', skillId: randomUUID(), input: { text: 'x' } },
 { kind: 'skill', skillId: root.skillId, input: {}, ownerUserId: user.id }, { kind: 'skill', skillId: root.skillId, input: {}, versionId: root.currentVersionId }, null]) {
  const response = await start(id, execution); assert.ok([400, 404, 409].includes(response.status));
 }
 assert.equal((await queue.listActiveRunsForOwner(user.id)).length, 0);
 const response = await request(app(false)).post(`/ai-sessions/${id}/runs`).set('Authorization', `Bearer ${token}`).send({ submissionKey: randomUUID(), content: 'Start', execution: { kind: 'skill', skillId: root.skillId, input: {} } });
 assert.equal(response.status, 503);
});
test('waiting workflow accepts only canonical schema/action/hash and explicitly records confirm or reject', async () => {
 const root = await workflow();
 for (const approved of [true, false]) {
  const id = await session(), started = await start(id, { kind: 'workflow', workflowId: root.workflowId, input: {} }); assert.equal(started.status, 202);
  const runId = started.body.data.runId; await tick();
  const view = await snapshot(runId), wait = view.body.data.businessExecution.pendingInput; assert.equal(wait.kind, 'userInput');
  const answer = { actionId: wait.actionId, kind: wait.kind, stepId: wait.stepId, contentHash: wait.contentHash, input: { text: 'Answer' } };
  for (const patch of [{ input: { wrong: true } }, { actionId: '0'.repeat(64) }, { contentHash: '0'.repeat(64) }, { stepId: 'other' }, { cursor: {} }]) {
   const invalid = await request(api).post(`/ai-runs/${runId}/inputs`).set('Authorization', `Bearer ${token}`).send({ ...answer, ...patch });
   assert.ok([400, 409].includes(invalid.status), JSON.stringify({ patch: Object.keys(patch), status: invalid.status, code: invalid.body.code }));
  }
  assert.equal((await request(api).post(`/ai-runs/${runId}/inputs`).set('Authorization', `Bearer ${token}`).send(answer)).status, 202);
  await tick(); const confirmation = (await snapshot(runId)).body.data.businessExecution.pendingInput; assert.equal(confirmation.kind, 'confirmation');
  const decision = await request(api).post(`/ai-runs/${runId}/actions/${confirmation.actionId}/${approved ? 'confirm' : 'reject'}`).set('Authorization', `Bearer ${token}`).send({ stepId: confirmation.stepId, contentHash: confirmation.contentHash });
  assert.equal(decision.status, 202); await tick(); const result = await snapshot(runId);
  assert.equal(result.body.data.run.status, 'completed'); assert.deepEqual(result.body.data.businessExecution.results.output, { text: 'Answer', approved });
  assert.equal('pendingInput' in result.body.data.businessExecution, false);
 }
});

test('current DB business-role revocation rejects new invocation and business retry keeps an explicit new Run', async () => {
 const root = await skill(), id = await session();
 await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
 try { assert.equal((await start(id, { kind: 'skill', skillId: root.skillId, input: { text: 'Owned' } })).status, 403); }
 finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
 const started = await start(id, { kind: 'skill', skillId: root.skillId, input: { text: 'Owned' } }); assert.equal(started.status, 202);
 const sourceRunId = started.body.data.runId;
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, sourceRunId));
 const response = await request(api).post(`/ai-runs/${sourceRunId}/retry`).set('Authorization', `Bearer ${token}`).send({ submissionKey: randomUUID(), reason: 'Explicit retry' });
 assert.equal(response.status, 202); assert.equal(response.body.data.retryOfRunId, sourceRunId); assert.notEqual(response.body.data.runId, sourceRunId);
 assert.equal((await snapshot(response.body.data.runId)).body.data.businessExecution.target.versionId, root.currentVersionId);
 await database.update(schema.harnessRuns).set({ status: 'cancelled' }).where(eq(schema.harnessRuns.harnessRunId, response.body.data.runId));
 assert.equal((await snapshot(randomUUID())).status, 404);
});

for (const kind of ['userInput', 'confirmation'] as const) test(`public ${kind} cannot persist an answer after system-role revocation following its authority check`, { timeout: 15000 }, async () => {
 const root = await workflow(), id = await session();
 const started = await start(id, { kind: 'workflow', workflowId: root.workflowId, input: {} }); assert.equal(started.status, 202);
 const runId = started.body.data.runId; await tick();
 let wait = (await snapshot(runId)).body.data.businessExecution.pendingInput;
 if (kind === 'confirmation') {
  assert.equal((await request(api).post(`/ai-runs/${runId}/inputs`).set('Authorization', `Bearer ${token}`)
   .send({ actionId: wait.actionId, kind: wait.kind, stepId: wait.stepId, contentHash: wait.contentHash, input: { text: 'Earlier answer' } })).status, 202);
  await tick(); wait = (await snapshot(runId)).body.data.businessExecution.pendingInput;
 }
 assert.equal(wait.kind, kind);
 let checked!: () => void, release!: () => void;
 const checkedPromise = new Promise<void>(resolve => { checked = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
 const wrapped = Object.create(database); let admissions = 0;
 wrapped.transaction = async (callback: any, config: any) => {
  const value: any = await database.transaction(callback, config);
  // Gate after both real authority DB reads committed, before the answer's independent write transaction.
  if (value?.runId === runId && value?.identity && value?.manifest && ++admissions === 2) { checked(); await released; }
  return value;
 };
 const gatedApi = express(); gatedApi.use(express.json());
 gatedApi.use('/ai-runs', createAiRunsRouter({ repo: queue, enabled: true, business: createBusinessSkillsWorkbenchService({ database: wrapped, repo: queue, inventory }) }));
 const path = kind === 'userInput' ? `/ai-runs/${runId}/inputs` : `/ai-runs/${runId}/actions/${wait.actionId}/confirm`;
 const value = kind === 'userInput' ? { text: 'Late answer' } : { approved: true };
 const body = kind === 'userInput' ? { actionId: wait.actionId, kind, stepId: wait.stepId, contentHash: wait.contentHash, input: value }
  : { stepId: wait.stepId, contentHash: wait.contentHash };
 const before = { cps: await queue.listCheckpointsForRun({ runId }), events: await queue.listRunEventsAfter({ runId, afterSequence: 0, limit: 100 }) };
 const pending = request(gatedApi).post(path).set('Authorization', `Bearer ${token}`).send(body).then(response => response);
 try {
  try {
   await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('authority check gate was not reached')), 5000);
    checkedPromise.then(() => { clearTimeout(timer); resolve(); }); });
   await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
  } finally { release(); }
  const response = await pending; assert.ok([403, 409].includes(response.status), JSON.stringify({ status: response.status, code: response.body.code }));
  assert.equal((await queue.findRunForOwner(runId, user.id))!.status, 'waiting');
  assert.deepEqual(await queue.listCheckpointsForRun({ runId }), before.cps);
  assert.deepEqual(await queue.listRunEventsAfter({ runId, afterSequence: 0, limit: 100 }), before.events);
  await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id));
  assert.equal((await request(api).post(path).set('Authorization', `Bearer ${token}`).send(body)).status, 202);
  await queue.requestRunCancel({ runId, requestedBy: user.id });
  const settled = { cps: await queue.listCheckpointsForRun({ runId }), events: await queue.listRunEventsAfter({ runId, afterSequence: 0, limit: 100 }) };
  await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
  const replay = await createBusinessSkillsWaitService(database).answer({ runId, sessionId: id, requestedBy: user.id,
   actionId: wait.actionId, kind, stepId: wait.stepId, contentHash: wait.contentHash, value }, user.role);
  assert.equal(replay.created, false); assert.equal(replay.run.status, 'cancelled');
  assert.deepEqual(await queue.listCheckpointsForRun({ runId }), settled.cps);
  assert.deepEqual(await queue.listRunEventsAfter({ runId, afterSequence: 0, limit: 100 }), settled.events);
 } finally {
  release(); await pending;
  await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id));
  await queue.requestRunCancel({ runId, requestedBy: user.id });
 }
});
