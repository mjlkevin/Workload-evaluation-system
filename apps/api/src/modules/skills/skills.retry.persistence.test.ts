import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry } from '../harness/harness-runtime.worker';
import { createBusinessSkillsWorkflow } from '../harness/business-skills.workflow';
import { createBusinessSkillsWaitService, createBusinessWorkflowWaitExecutor } from '../harness/business-skills.wait';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createAiRunsUsecase } from '../harness/harness-runtime.usecase';
import { createAiSessionsPgRepository } from '../ai-sessions/ai-sessions-pg.repository';
import { createSkillRetryService } from './skills.retry';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { createExecutionAuthority } from './execution-authority';
import { prepareFrozenSkillModel } from './skills.execution-model';
import { HARNESS_RUN_ACTIVE_STATUSES } from '../harness/harness-runtime.types';
import { deleteAiSession } from '../ai-sessions/ai-sessions.usecase';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { skillDefinitionHash as hash } from './skills.hash';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
import express from 'express';
import http from 'supertest';
import { signAuthToken } from '../../middleware/auth';
import { createAiRunsRouter } from '../../routes/ai-runs.routes';
import { createAiSessionsRouter } from '../../routes/ai-sessions.routes';
import { manifest as workflowManifest } from '../harness/workflows.runtime.fixture';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
const url = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: url, max: 1, application_name: 'wes-retry-main', connectionTimeoutMillis: 1000 });
const control = new Pool({ connectionString: url, max: 2, application_name: 'wes-retry-control' });
const database = drizzle(pool, { schema }); const queue = createHarnessRuntimeRepository(database);
const sessions = createAiSessionsPgRepository(drizzle(control, { schema }), null);
const user = { id: randomUUID(), username: `retry-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const definition: SkillDefinition = { name: 'Retry fixture', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'],
  inputSchema: payload, outputSchema: payload, tools: [], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const native = { name: 'retry_read', description: 'Read fixture', parameters: payload, mutates: false, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
let material = { title: 'Frozen reference', content: 'Original knowledge body' };
const manifests = createExecutionManifestService({ database, loadReference: async () => ({ ...material, status: 'active', updatedAt: 'v1' }) as any, loadSkillContext: async d => ({ tools: d.tools.length ? [native] : [], snapshot: { schemaVersion: 1, references: d.references.map(r => ({ uri: r.uri, version: r.version, digest: hash(material) })), tools: d.tools.length ? [{ native, policy: DEFAULT_TOOL_POLICY_ENTRY }] : [], roles: ['ADMIN'],
  model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'provider:fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
function invocation(q = queue) { return createSkillInvocationService({ queue: q, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution }); }
async function fixture(patch: Partial<SkillDefinition> = {}) {
  const roots = createSkillsPgRepository(database); let root = await roots.create({ ...structuredClone(definition), ...patch }, { id: user.id, username: user.username });
  root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
  const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Retry',
    domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
  const body = { submissionKey: randomUUID(), content: 'Frozen user content', execution: { kind: 'skill', skillId: root.skillId, input: { text: 'original' } } };
  return { root, sessionId, body };
}
async function failed(patch: Partial<SkillDefinition> = {}) { const f = await fixture(patch); const accepted = await invocation().submitInvocation(user, f.sessionId, f.body);
  await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, accepted.data.runId));
  return { ...f, run: (await queue.findRunForOwner(accepted.data.runId, user.id))! }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function waitLock() { for (let n = 0; n < 500; n++) { const r = await control.query("SELECT 1 FROM pg_stat_activity WHERE application_name = 'wes-retry-control' AND wait_event_type = 'Lock'"); if (r.rowCount) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('expected actual PG lock wait'); }
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id)); await pool.end(); await control.end(); });
test('public retry refuses business Skills rather than copying the old authority', async () => {
  const f = await failed(); const uc = createAiRunsUsecase({ enabled: true, repo: queue, findSession: async () => null });
  await assert.rejects(uc.retryRun(user, f.run.harnessRunId), (e: any) => e.code === 'BUSINESS_SKILLS_RETRY_CHANNEL_REQUIRED');
});
test('DELETE waiting behind business submission rechecks active Runs after lock acquisition', async () => {
  const f = await fixture(); const entered = deferred(), release = deferred();
  const submit = invocation({ ...queue, async createQueuedRun(input) { return queue.createQueuedRun({ ...input, validateSubmission: async tx => {
    await input.validateSubmission!(tx); entered.resolve(); await release.promise;
  } }); } }).submitInvocation(user, f.sessionId, f.body);
  await entered.promise;
  const deletion = sessions.deleteSession({ ownerUserId: user.id, sessionId: f.sessionId });
  const outcome = deletion.then(value => ({ value }), error => ({ error }));
  try { await waitLock(); } finally { release.resolve(); }
  await submit; const result = await outcome;
  assert.equal((result as any).error?.code, 'SESSION_HAS_ACTIVE_RUN');
  assert.ok(await sessions.findSession({ ownerUserId: user.id, sessionId: f.sessionId }));
});

const inventory = async () => ({ registry: { get: (name: string) => name === native.name ? native : undefined }, tools: [], policy: { schemaVersion: 1, policies: {} } }) as any;
const emergency = createExecutionEmergencyRepository(database);
const retry = (extra: Parameters<typeof createSkillRetryService>[0] = {}) => createSkillRetryService({ database, inventory,
  prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { throw new Error('NO MODEL DISPATCH'); } }), ...extra });
const request = () => ({ submissionKey: randomUUID(), reason: '  Manual business retry  ' });
async function countRuns() { return Number((await pool.query('SELECT count(*) n FROM harness_runs WHERE owner_user_id=$1', [user.id])).rows[0].n); }
async function persisted(id: string) { return (await queue.findRunForOwner(id, user.id))!; }
test('manual retry keeps frozen version/input/content, remints message and records actor/reason/lineage atomically', async () => {
  const f = await failed(); const old = structuredClone(f.run); const body = request();
  await database.insert(schema.harnessRunCheckpoints).values({ harnessRunCheckpointId: randomUUID(), harnessRunId: f.run.harnessRunId, sequence: 1, checkpointKey: 'old', checkpointKind: 'structural',
    workflowId: f.run.workflowId!, workflowVersion: f.run.workflowVersion!, stepKey: 'old', resumePolicy: 'resume_next', state: { confirmed: true }, stateHash: hash('old'), runtimeValidation: {} });
  await database.insert(schema.harnessRunOutputs).values({ harnessRunOutputId: randomUUID(), harnessRunId: f.run.harnessRunId, status: 'final', content: { old: true }, contentHash: hash('old') });
  // New startup uses the old published version, even when the root points elsewhere.
  await database.update(schema.skillDefinitions).set({ activeVersionId: randomUUID() }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
  const r = await retry().retryInvocation(user, f.run.harnessRunId, body); const run = await persisted(r.data.runId);
  assert.equal(run.retryOfRunId, f.run.harnessRunId); assert.equal((run.metadata as any).retryActorId, user.id);
  assert.equal((run.metadata as any).retryReason, body.reason.trim());
  assert.deepEqual((run.executionConfig as any).executionManifest, (old.executionConfig as any).executionManifest);
  assert.equal((run.metadata as any).invocationFingerprint, (old.metadata as any).invocationFingerprint);
  assert.equal((run.executionConfig as any).content, (old.executionConfig as any).content);
  assert.notEqual((run.executionConfig as any).conversationFact.userMessage.messageId, (old.executionConfig as any).conversationFact.userMessage.messageId);
  assert.deepEqual(await persisted(f.run.harnessRunId), old);
  const snap = await queue.getRunSnapshot(run.harnessRunId); assert.equal(snap!.checkpoint, null); assert.equal(snap!.output, null);
  const events = await queue.listRunEventsAfter({ runId: run.harnessRunId, afterSequence: 0, limit: 100 });
  assert.deepEqual(events.map(e => e.eventType), ['run_queued', 'user/message']);
  const replay = await retry({ prepareModel: async () => { throw new Error('REPLAY MUST NOT PREPARE'); } }).retryInvocation(user, f.run.harnessRunId, body);
  assert.equal(replay.data.runId, run.harnessRunId); assert.equal((await queue.listRunEventsAfter({ runId: run.harnessRunId, afterSequence: 0, limit: 100 })).length, 2);
  for (const change of [{ reason: 'different' }, { submissionKey: f.body.submissionKey }])
    await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, { ...body, ...change }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
  const other = await failed(); await assert.rejects(retry().retryInvocation(user, other.run.harnessRunId, body), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
});
test('retry only accepts failed owned business Runs and strict command fields', async () => {
  const f = await failed(); const before = await countRuns();
  for (const body of [{}, { ...request(), reason: ' ' }, { ...request(), reason: 'x'.repeat(1001) }, { ...request(), submissionKey: 'x'.repeat(161) }, { ...request(), epoch: 9 }, { ...request(), executionConfig: {} }])
    await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, body), (e: any) => e.code === 'INVOCATION_INVALID_REQUEST');
  await assert.rejects(retry().retryInvocation({ ...user, id: randomUUID() }, f.run.harnessRunId, request()), (e: any) => e.status === 404);
  for (const status of ['queued', 'waiting', 'completed', 'cancelled'] as const) {
    await database.update(schema.harnessRuns).set({ status }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
    await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()), (e: any) => e.code === 'EXECUTION_RUN_NOT_FAILED');
  }
  assert.equal(await countRuns(), before);
});
test('retry rejects corrupted old grant, fingerprint and manifest without washing old bindings', async () => {
  const f = await failed(); const config: any = f.run.executionConfig; const before = await countRuns();
  for (const executionAuthority of [[], [...config.executionAuthority, ...config.executionAuthority], [{ ...config.executionAuthority[0], epoch: -1 }], [{ ...config.executionAuthority[0], id: randomUUID() }], [{ ...config.executionAuthority[0], grant: true }]]) {
    await database.update(schema.harnessRuns).set({ executionConfig: { ...config, executionAuthority } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
    await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()), (e: any) => e.code === 'EXECUTION_RUN_BINDING_INVALID');
  }
  await database.update(schema.harnessRuns).set({ executionConfig: { ...config, executionManifest: { ...config.executionManifest, manifestHash: hash('wrong') } } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()));
  await database.update(schema.harnessRuns).set({ executionConfig: config, metadata: { invocationFingerprint: hash('other input') } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()), (e: any) => e.code === 'EXECUTION_RUN_BINDING_INVALID');
  assert.equal(await countRuns(), before);
});
test('retry rejects disabled/archived roots and changed current owner authority', async () => {
  const f = await failed(); const before = await countRuns();
  for (const patch of [{ enabled: false }, { archived: true }]) {
    await database.update(schema.skillDefinitions).set(patch).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
    await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()));
    await database.update(schema.skillDefinitions).set({ enabled: true, archived: false }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
  }
  for (const patch of [{ status: 'disabled' as const }, { businessRole: 'delivery' }, { role: 'user' as const }]) {
    await database.update(schema.users).set(patch).where(eq(schema.users.userId, user.id));
    try { await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request())); }
    finally { await database.update(schema.users).set({ status: 'active', role: 'admin', businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
  }
  assert.equal(await countRuns(), before);
});
test('explicit retry after stop+release captures new epoch; old dispatch and old-key replay never revive', async () => {
  const f = await failed(); await emergency.change('skill', f.root.skillId, user, 0, 'Stop', 'stop');
  await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED');
  await emergency.change('skill', f.root.skillId, user, 1, 'Release', 'release');
  const body = request(); const accepted = await retry().retryInvocation(user, f.run.harnessRunId, body); const fresh = await persisted(accepted.data.runId);
  assert.equal((fresh.executionConfig as any).executionAuthority[0].epoch, 1); assert.equal((f.run.executionConfig as any).executionAuthority[0].epoch, 0);
  const action = (run: typeof fresh) => ({ runId: run.harnessRunId, ownerUserId: user.id, manifestHash: (run.executionConfig as any).executionManifest.manifestHash, phase: 'resume' as const });
  await createExecutionAuthority(database, inventory).check(action(fresh));
  await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, fresh.harnessRunId));
  await emergency.change('skill', f.root.skillId, user, 2, 'Stop again', 'stop'); await emergency.change('skill', f.root.skillId, user, 3, 'Release again', 'release');
  await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, body), (e: any) => e.code === 'EXECUTION_MANUAL_RETRY_REQUIRED');
  await database.update(schema.harnessRuns).set({ status: 'queued' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  await assert.rejects(createExecutionAuthority(database, inventory).check(action(f.run)));
});
test('prepare-time stop+release or role downgrade aborts the entire retry with max-one pool and no held I/O connection', async () => {
  for (const cause of ['stopRelease', 'role']) {
    const f = await failed(); const before = await countRuns();
    const service = retry({ prepareModel: async () => {
      await pool.query('SELECT 1');
      if (cause === 'role') await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
      else { await emergency.change('skill', f.root.skillId, user, 0, 'Prepare stop', 'stop'); await emergency.change('skill', f.root.skillId, user, 1, 'Prepare release', 'release'); }
      return { transportProvider: 'fixture', complete: async () => { throw new Error('NO DISPATCH'); } };
    } });
    try { await assert.rejects(service.retryInvocation(user, f.run.harnessRunId, request())); assert.equal(await countRuns(), before); }
    finally { await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id)); }
  }
});
test('model metadata preflight rejects unavailable provider/model/endpoint/scope, never calling completion', async () => {
  const f = await failed(); const before = await countRuns(); let completions = 0;
  for (const cause of ['disabled', 'model', 'endpoint', 'credential']) {
    const service = retry({ prepareModel: (skill, signal) => prepareFrozenSkillModel(skill, signal, {
      loadProviders: async () => [{ id: 'fixture', name: 'Fixture', protocol: 'openai-compatible', enabled: cause !== 'disabled', baseUrl: cause === 'endpoint' ? 'changed' : 'endpoint', models: [{ id: cause === 'model' ? 'other' : 'fixed' }] }],
      loadCredential: async () => cause === 'credential' ? '' : 'fixture-non-secret', provider: { chatCompletion: async () => { completions++; throw new Error('NO DISPATCH'); } },
    }) });
    await assert.rejects(service.retryInvocation(user, f.run.harnessRunId, request()));
  }
  assert.equal(completions, 0); assert.equal(await countRuns(), before);
});
test('same-key double-click is one new Run, differing intent conflicts, different keys allow at most one active Run', async () => {
  const f = await failed(); const body = request(); const before = await countRuns();
  const results = await Promise.all([retry().retryInvocation(user, f.run.harnessRunId, body), retry().retryInvocation(user, f.run.harnessRunId, body)]);
  assert.equal(results[0].data.runId, results[1].data.runId); assert.equal(await countRuns(), before + 1);
  const other = await failed(); const second = await Promise.allSettled([retry().retryInvocation(user, other.run.harnessRunId, request()), retry().retryInvocation(user, other.run.harnessRunId, request())]);
  assert.equal(second.filter(r => r.status === 'fulfilled').length, 1); assert.equal(second.filter(r => r.status === 'rejected').length, 1);
});
test('late event failure rolls back Run/config/metadata and all events', async () => {
  const f = await failed(); const before = await countRuns();
  const broken = { ...queue, createQueuedRun: (input: Parameters<typeof queue.createQueuedRun>[0]) => queue.createQueuedRun({ ...input, userMessageFact: () => { throw new Error('fixture rollback'); } }) };
  await assert.rejects(retry({ queue: broken }).retryInvocation(user, f.run.harnessRunId, request())); assert.equal(await countRuns(), before);
});
test('all five active statuses protect DELETE, including missing/false optional checker and flag-off path', async () => {
  const f = await failed();
  for (const status of HARNESS_RUN_ACTIVE_STATUSES) {
    await database.update(schema.harnessRuns).set({ status }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
    assert.equal(await sessions.deleteSession({ ownerUserId: randomUUID(), sessionId: f.sessionId }), false);
    for (const deps of [undefined, { activeRunChecker: async () => false }])
      await assert.rejects(deleteAiSession(user, f.sessionId, deps as any), (e: any) => e.status === 409 && e.code === 'SESSION_HAS_ACTIVE_RUN');
  }
  await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  assert.equal(await sessions.deleteSession({ ownerUserId: user.id, sessionId: f.sessionId }), true);
  assert.equal(await sessions.deleteSession({ ownerUserId: user.id, sessionId: f.sessionId }), false);
});

test('real registered routers enforce JWT retry-channel and DELETE 409/404 with flag on and off', async () => {
  const f = await failed(); const token = signAuthToken(user); const app = express(); app.use(express.json());
  app.use('/ai-runs', createAiRunsRouter({ enabled: true, repo: queue }));
  assert.equal((await http(app).post(`/ai-runs/${f.run.harnessRunId}/retry`)).status, 401);
  const response = await http(app).post(`/ai-runs/${f.run.harnessRunId}/retry`).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 409); assert.equal(response.body.code, 'BUSINESS_SKILLS_RETRY_CHANNEL_REQUIRED');
  await database.update(schema.harnessRuns).set({ status: 'recovering' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  for (const enabled of [true, false]) {
    const app = express(); app.use(express.json()); app.use('/ai-sessions', createAiSessionsRouter({ enabled, repo: { ...queue, hasActiveRunForSession: async () => false } }));
    const active = await http(app).delete(`/ai-sessions/${f.sessionId}`).set('Authorization', `Bearer ${token}`);
    assert.equal(active.status, 409); assert.equal(active.body.code, 'SESSION_HAS_ACTIVE_RUN');
    assert.equal((await http(app).delete('/ai-sessions/nonexistent').set('Authorization', `Bearer ${token}`)).status, 404);
  }
});
test('retry keeps frozen source input and knowledge body while verifying the old source IDs remain accessible', async () => {
  const f = await fixture({ references: [{ uri: 'wes://knowledge/retry_reference', version: 'v1', label: 'Reference' }] });
  const messageId = randomUUID(), createdAt = new Date().toISOString();
  await database.update(schema.aiSessions).set({ messages: [{ messageId, role: 'user', content: 'original source message', createdAt }] }).where(eq(schema.aiSessions.sessionId, f.sessionId));
  const body = { ...f.body, execution: { ...f.body.execution, sources: [{ kind: 'conversation', id: messageId }] } };
  const accepted = await invocation().submitInvocation(user, f.sessionId, body); const original = await persisted(accepted.data.runId);
  await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, original.harnessRunId));
  const savedMaterial = material; material = { title: 'Latest title', content: 'Latest content must not replace frozen content' };
  try {
    await database.update(schema.aiSessions).set({ messages: [{ messageId, role: 'user', content: 'current source message', createdAt }] }).where(eq(schema.aiSessions.sessionId, f.sessionId));
    const r = await retry().retryInvocation(user, original.harnessRunId, request()); const next = await persisted(r.data.runId);
    assert.deepEqual((next.executionConfig as any).executionManifest, (original.executionConfig as any).executionManifest);
    await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, next.harnessRunId));
    assert.equal((next.executionConfig as any).executionManifest.sourceMaterials[0].text, 'original source message');
    await database.update(schema.aiSessions).set({ messages: [] }).where(eq(schema.aiSessions.sessionId, f.sessionId));
    await assert.rejects(retry().retryInvocation(user, original.harnessRunId, request()), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
  } finally { material = savedMaterial; }
});

test('ordinary disabled or archived roots block new retry keys while saved retry replay retains its epoch', async () => {
  const f = await failed(); const body = request(); const result = await retry().retryInvocation(user, f.run.harnessRunId, body);
  for (const patch of [{ enabled: false }, { archived: true }]) {
    await database.update(schema.skillDefinitions).set(patch).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
    assert.equal((await retry().retryInvocation(user, f.run.harnessRunId, body)).data.runId, result.data.runId);
    await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()));
    await database.update(schema.skillDefinitions).set({ enabled: true, archived: false }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
  }
});
function generic(q = queue) { return createAiRunsUsecase({ enabled: true, repo: q, findSession: (u, id) => sessions.findSession({ ownerUserId: u.id, sessionId: id }) }); }
async function raceFixture(kind: string) {
  const f = kind === 'businessRetry' ? await failed() : { ...await fixture(), run: undefined as any };
  if (kind === 'chatRetry') {
    const result = await generic().submitRun(user, f.sessionId, { submissionKey: randomUUID(), content: 'ordinary chat' });
    await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, result.data.runId)); f.run = await persisted(result.data.runId);
  }
  const start = (q: typeof queue) => kind === 'ordinary' ? generic(q).submitRun(user, f.sessionId, { submissionKey: randomUUID(), content: 'ordinary' })
    : kind === 'business' ? invocation(q).submitInvocation(user, f.sessionId, f.body)
    : kind === 'chatRetry' ? generic(q).retryRun(user, f.run.harnessRunId) : retry({ queue: q }).retryInvocation(user, f.run.harnessRunId, request());
  return { ...f, start };
}
test('DELETE vs ordinary/business submit and both retry paths: enqueue commits first, DELETE returns 409', async () => {
  for (const kind of ['ordinary', 'business', 'chatRetry', 'businessRetry']) {
    const f = await raceFixture(kind); const entered = deferred(), release = deferred();
    const submit = f.start({ ...queue, createQueuedRun: input => queue.createQueuedRun({ ...input, validateSubmission: async tx => {
      assert.equal(typeof input.validateSubmission, 'function'); await input.validateSubmission!(tx); entered.resolve(); await release.promise;
    } }) });
    const submitted = submit.then(value => ({ value }), error => ({ error })); await entered.promise;
    const deletion = sessions.deleteSession({ ownerUserId: user.id, sessionId: f.sessionId }).then(value => ({ value }), error => ({ error }));
    try { await waitLock(); } finally { release.resolve(); }
    assert.ok('value' in await submitted, kind); assert.equal((await deletion as any).error?.code, 'SESSION_HAS_ACTIVE_RUN', kind);
  }
});
test('DELETE vs all four startup paths: DELETE commits first, submission denies without creating an orphan', async () => {
  for (const kind of ['ordinary', 'business', 'chatRetry', 'businessRetry']) {
    const f = await raceFixture(kind); const before = await countRuns(); const entered = deferred(), release = deferred();
    const base = drizzle(control, { schema }); const gated = Object.create(base);
    gated.transaction = (callback: any) => base.transaction(tx => {
      const executor = Object.create(tx);
      executor.delete = (table: any) => {
        const statement = tx.delete(table); const query = Object.create(statement);
        query.where = async (condition: any) => { const rows = await statement.where(condition); entered.resolve(); await release.promise; return rows; };
        return query;
      };
      return callback(executor);
    });
    // Gate the real repository after its actual DELETE, before its transaction commits.
    const deletion = createAiSessionsPgRepository(gated, null).deleteSession({ ownerUserId: user.id, sessionId: f.sessionId });
    await entered.promise; const submission = f.start(queue).then(value => ({ value }), error => ({ error }));
    try {
      for (let n = 0; ; n++) {
        const waiting = await control.query("SELECT 1 FROM pg_stat_activity WHERE application_name='wes-retry-main' AND wait_event_type='Lock'");
        if (waiting.rowCount) break; if (n > 500) throw new Error(`missing actual Session SHARE wait: ${kind}`); await new Promise(r => setTimeout(r, 10));
      }
    } finally { release.resolve(); }
    assert.equal(await deletion, true); const result = await submission;
    assert.ok('error' in result, kind); assert.equal((result as any).error.status, 404, kind); assert.equal(await countRuns(), before, kind);
  }
});
test('failed source referring to an unpublished fixed version is rejected without changing immutable published history', async () => {
  const f = await failed(); const draft = await createSkillsPgRepository(database).create(structuredClone(definition), { id: user.id, username: user.username });
  const config = structuredClone(f.run.executionConfig) as any, m = config.executionManifest;
  m.target.id = draft.skillId; m.target.versionId = draft.currentVersionId; m.skills[0].skillId = draft.skillId; m.skills[0].versionId = draft.currentVersionId;
  const { manifestHash: _, ...body } = m; m.manifestHash = hash(body); config.executionAuthority = [{ kind: 'skill', id: draft.skillId, epoch: 0 }];
  await database.update(schema.harnessRuns).set({ executionConfig: config, metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: config.content,
    execution: { kind: 'skill', skillId: draft.skillId, input: m.initialInput, sources: m.sources } }) } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()), (e: any) => e.code === 'EXECUTION_REFERENCE_UNAVAILABLE');
});

test('retry intersects original tools/roles/policy with current registry; new startup grants no write/confirm/MCP execution', async () => {
  const f = await failed({ tools: [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: true }] });
  const before = await countRuns();
  for (const cause of ['missing', 'capability', 'schema', 'source', 'disabled', 'roles']) {
    const current: any = { ...native }; const policy: any = { schemaVersion: 1, policies: {} };
    if (cause === 'capability') current.capability = 'user:manage'; if (cause === 'schema') current.parameters = {};
    if (cause === 'source') current.source = 'mcp';
    if (cause === 'disabled' || cause === 'roles') policy.policies[native.name] = { ...DEFAULT_TOOL_POLICY_ENTRY, ...(cause === 'disabled' ? { enabled: false } : { visibleRoles: ['DEV'] }) };
    await assert.rejects(retry({ inventory: async () => ({ registry: { get: () => cause === 'missing' ? undefined : current }, tools: [], policy }) as any }).retryInvocation(user, f.run.harnessRunId, request()),
      (e: any) => e.code === 'EXECUTION_AUTHORITY_DENIED');
  }
  assert.equal(await countRuns(), before);
  const r = await retry().retryInvocation(user, f.run.harnessRunId, request()); const run = await persisted(r.data.runId);
  await assert.rejects(createExecutionAuthority(database, inventory).check({ runId: run.harnessRunId, ownerUserId: user.id,
    manifestHash: (run.executionConfig as any).executionManifest.manifestHash, stepId: '$skill', phase: 'tool', toolName: native.name }));
});
test('model preparation success only checks availability and never calls upstream completion', async () => {
  const f = await failed(); let completions = 0;
  const r = await retry({ prepareModel: (skill, signal) => prepareFrozenSkillModel(skill, signal, {
    loadProviders: async () => [{ id: 'fixture', name: 'Fixture', protocol: 'openai-compatible', enabled: true, baseUrl: 'endpoint', models: [{ id: 'fixed' }] }],
    loadCredential: async () => 'fixture-non-secret', provider: { chatCompletion: async () => { completions++; throw new Error('NO DISPATCH'); } },
  }) }).retryInvocation(user, f.run.harnessRunId, request());
  assert.equal(r.status, 202); assert.equal(completions, 0);
});
test('concurrent same-key different reason conflicts; ordinary submission cannot borrow a retry key', async () => {
  const f = await failed(); const body = request();
  const result = await Promise.allSettled([retry().retryInvocation(user, f.run.harnessRunId, body), retry().retryInvocation(user, f.run.harnessRunId, { ...body, reason: 'different intent' })]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((result.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'SUBMISSION_KEY_CONFLICT');
  await assert.rejects(invocation().submitInvocation(user, f.sessionId, { ...f.body, submissionKey: body.submissionKey }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
});

test('Workflow retry freezes old Skill dependencies and refuses direct tools without original V2 role evidence', async () => {
  for (const direct of [false, true]) {
    const f = await failed(); const m: any = workflowManifest(d => {
      d.steps = d.steps.filter(s => s.type === (direct ? 'tool' : 'skill'));
      d.steps[0].inputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }];
      d.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }];
    });
    m.target.id = randomUUID(); m.target.versionId = randomUUID(); m.caller = { id: user.id, businessRole: 'pre_sales' }; m.initialInput = { text: 'original' };
    if (!direct) {
      const frozen = structuredClone((f.run.executionConfig as any).executionManifest.skills[0]); frozen.stepId = 's'; m.skills = [frozen];
      Object.assign(m.target.definition.steps[0], { skillId: f.root.skillId, skillVersionId: f.root.activeVersionId });
    }
    m.publishedDependencies = { schemaVersion: 1, skills: m.skills.map((s: any) => ({ stepId: s.stepId, skillId: s.skillId, skillVersionId: s.versionId, hash: s.hash, context: s.context })), tools: m.tools };
    m.target.hash = hash(m.target.definition); const { manifestHash: _, ...body } = m; m.manifestHash = hash(body);
    await database.insert(schema.workflowDefinitions).values({ workflowId: m.target.id, name: 'Retry workflow', description: '', category: 'test', enabled: true, archived: false,
      currentVersionId: m.target.versionId, activeVersionId: m.target.versionId, revision: 0, createdAt: new Date(), updatedAt: new Date() });
    await database.insert(schema.workflowVersions).values({ workflowVersionId: m.target.versionId, workflowId: m.target.id, position: 0, versionCode: `RETRY-${randomUUID()}`, majorLetter: 'A', minorNumber: 1,
      status: 'published', checkoutStatus: 'checked_in', definition: m.target.definition, lastCheckinDefinition: m.target.definition, hash: m.target.hash, dependencySnapshot: m.publishedDependencies, createdAt: new Date(), updatedAt: new Date() });
    const config = { ...f.run.executionConfig as any, executionManifest: m, executionAuthority: [{ kind: 'workflow', id: m.target.id, epoch: 0 }, ...(!direct ? [{ kind: 'skill', id: f.root.skillId, epoch: 0 }] : [])] };
    await database.update(schema.harnessRuns).set({ executionConfig: config, metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: config.content,
      execution: { kind: 'workflow', workflowId: m.target.id, input: m.initialInput, sources: m.sources } }) } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
    if (direct) await assert.rejects(retry().retryInvocation(user, f.run.harnessRunId, request()), (e: any) => e.code === 'EXECUTION_AUTHORITY_DENIED');
    else {
      await database.update(schema.skillDefinitions).set({ activeVersionId: randomUUID() }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
      const r = await retry().retryInvocation(user, f.run.harnessRunId, request()); assert.deepEqual(((await persisted(r.data.runId)).executionConfig as any).executionManifest, m);
    }
  }
});

function freshWaitWorker() {
  const executor = createBusinessWorkflowWaitExecutor(createBusinessSkillsWaitService(database));
  const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor })]);
  return createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID() }).runNextAttempt();
}
async function actualWait() {
  const f = await failed(); const m = workflowManifest(d => {
    d.steps = d.steps.filter(s => s.type === 'userInput');
    d.steps[0].inputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }];
    d.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.steps.u.output.text' } }];
  });
  m.target.id = randomUUID(); m.target.versionId = randomUUID(); m.caller.id = user.id;
  const { manifestHash: _, ...body } = m; m.manifestHash = hash(body);
  await database.insert(schema.workflowDefinitions).values({ workflowId: m.target.id, name: 'Waiting deletion fixture', description: '', category: 'test',
    enabled: true, archived: false, currentVersionId: m.target.versionId, activeVersionId: m.target.versionId, revision: 0, createdAt: new Date(), updatedAt: new Date() });
  const config = { ...f.run.executionConfig as any, executionManifest: m, executionAuthority: [{ kind: 'workflow', id: m.target.id, epoch: 0 }] };
  await database.update(schema.harnessRuns).set({ status: 'queued', availableAt: new Date(0), executionConfig: config,
    metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: config.content,
      execution: { kind: 'workflow', workflowId: m.target.id, input: m.initialInput, sources: m.sources } }) } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  assert.equal(await freshWaitWorker(), true); assert.equal((await persisted(f.run.harnessRunId)).status, 'waiting');
  const events = await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 });
  const wait = events.find(e => e.eventType === 'workflow.awaiting_input')!.payload as any;
  return { ...f, answer: { runId: f.run.harnessRunId, sessionId: f.sessionId, requestedBy: user.id,
    actionId: wait.actionId, kind: wait.kind, stepId: wait.stepId, contentHash: wait.contentHash, value: { text: 'Saved original answer' } } };
}
/** Pause only after the real first SELECT FOR UPDATE has acquired its row lock. */
function gateFirstUpdateLock(base: typeof database, rawRun = false) {
  const entered = deferred(), release = deferred(); const state = { pid: 0, gated: false }; const gated = Object.create(base);
  gated.transaction = (callback: any) => base.transaction(async tx => {
    const pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid); const executor = Object.create(tx);
    const pause = async () => { state.gated = true; state.pid = pid; entered.resolve(); await release.promise; };
    executor.execute = async (query: any) => {
      const rows = await tx.execute(query);
      if (rawRun && !state.gated && /FROM harness_runs[\s\S]*FOR UPDATE/i.test(new PgDialect().sqlToQuery(query).sql)) await pause();
      return rows;
    };
    executor.select = (...args: any[]) => {
      const select = (tx.select as any)(...args), from = select.from.bind(select);
      select.from = (...args: any[]) => {
        const query = from(...args), lock = query.for.bind(query);
        query.for = async (...args: any[]) => {
          const rows = await lock(...args);
          if (!rawRun && args[0] === 'update' && !state.gated) await pause();
          return rows;
        };
        return query;
      };
      return select;
    };
    return callback(executor);
  });
  return { database: gated as typeof database, entered, release, state };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('deterministic lock gate timed out')), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function blockedBy(pid: number) {
  for (let n = 0; n < 500; n++) {
    const result = await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))", [pid]);
    if (result.rowCount) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`expected actual PG lock blocked by ${pid}`);
}
test('DELETE rejects while a real wait answer owns the Run UPDATE lock, without waiting for that Run lock', async () => {
  const f = await actualWait(); const gate = gateFirstUpdateLock(database, true);
  const answering = createBusinessSkillsWaitService(gate.database).answer(f.answer); void answering.catch(() => {});
  let probe: Promise<unknown> | undefined;
  try {
    await bounded(gate.entered.promise);
    probe = control.query('SELECT harness_run_id FROM harness_runs WHERE harness_run_id=$1 FOR SHARE', [f.run.harnessRunId]);
    await blockedBy(gate.state.pid);
    // The probe is blocked on answer's real Run lock. DELETE must only read that Run via MVCC.
    await bounded(assert.rejects(sessions.deleteSession({ ownerUserId: user.id, sessionId: f.sessionId }), (e: any) => e.code === 'SESSION_HAS_ACTIVE_RUN'));
  } finally { gate.release.resolve(); await Promise.allSettled([answering, ...(probe ? [probe] : [])]); }
  assert.equal((await answering).created, true); assert.equal((await persisted(f.run.harnessRunId)).status, 'queued');
  assert.ok(await sessions.findSession({ ownerUserId: user.id, sessionId: f.sessionId }));
  const events = await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 });
  assert.equal(events.filter(e => e.eventType === 'workflow.answer_recorded').length, 1);
  assert.equal((await queue.getRunSnapshot(f.run.harnessRunId))!.output, null);
});
test('fresh Worker resume waits behind real DELETE Session lock; DELETE rejects and original saved answer completes', async () => {
  const f = await actualWait(); await createBusinessSkillsWaitService(database).answer(f.answer);
  await database.update(schema.harnessRuns).set({ availableAt: new Date(0) }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  const gate = gateFirstUpdateLock(drizzle(control, { schema }));
  const deleting = createAiSessionsPgRepository(gate.database, null).deleteSession({ ownerUserId: user.id, sessionId: f.sessionId });
  const deleted = deleting.then(value => ({ value }), error => ({ error })); let working: Promise<boolean> | undefined;
  try {
    await bounded(gate.entered.promise); working = freshWaitWorker(); void working.catch(() => {});
    await blockedBy(gate.state.pid);
  } finally { gate.release.resolve(); await Promise.allSettled([deleted, ...(working ? [working] : [])]); }
  assert.equal((await deleted as any).error?.code, 'SESSION_HAS_ACTIVE_RUN'); assert.equal(await working, true);
  assert.ok(await sessions.findSession({ ownerUserId: user.id, sessionId: f.sessionId }));
  assert.equal((await persisted(f.run.harnessRunId)).status, 'completed');
  assert.deepEqual((await queue.getRunSnapshot(f.run.harnessRunId))!.output!.content, f.answer.value);
  const events = await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 });
  assert.equal(events.filter(e => e.eventType === 'workflow.answer_recorded').length, 1);
  assert.equal((await createBusinessSkillsWaitService(database).answer(f.answer)).created, false);
});
test('uppercase and lowercase source UUIDs replay one retry intent, including after ordinary disable', async () => {
  let source = await failed();
  for (let attempt = 1; attempt < 8 && source.run.harnessRunId === source.run.harnessRunId.toUpperCase(); attempt++) source = await failed();
  const sourceId = source.run.harnessRunId, uppercase = sourceId.toUpperCase(), body = request(), before = await countRuns();
  assert.notEqual(uppercase, sourceId, 'fixture must contain a letter within eight attempts');
  const first = await retry().retryInvocation(user, uppercase, body);
  const saved = await persisted(first.data.runId);
  assert.equal(saved.retryOfRunId, source.run.harnessRunId);
  assert.equal((await retry().retryInvocation(user, uppercase, body)).data.runId, saved.harnessRunId);
  assert.equal((await retry().retryInvocation(user, source.run.harnessRunId, body)).data.runId, saved.harnessRunId);
  await database.update(schema.skillDefinitions).set({ enabled: false }).where(eq(schema.skillDefinitions.skillId, source.root.skillId));
  for (const id of [uppercase, source.run.harnessRunId]) {
    const replay = await retry().retryInvocation(user, id, body);
    assert.equal(replay.data.runId, saved.harnessRunId);
    assert.equal(replay.data.retryOfRunId, source.run.harnessRunId);
  }
  assert.equal(await countRuns(), before + 1);
  const events = await queue.listRunEventsAfter({ runId: saved.harnessRunId, afterSequence: 0, limit: 100 });
  assert.deepEqual(events.map(event => event.eventType), ['run_queued', 'user/message']);
});
