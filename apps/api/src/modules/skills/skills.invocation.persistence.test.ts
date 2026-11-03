import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository, buildWorkbenchUserMessageFact, attachWorkbenchConversationFact } from '../harness/harness.module';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createExecutionManifestService, readPersistedExecutionManifest } from './execution-manifest';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillUsecase } from './skills.usecase';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createSkillReleaseRepository } from './skills-release.repository';
import { skillDefinitionHash as hash } from './skills.hash';
import type { SkillResolvedContext } from './skills.context';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
import { createExecutionEmergencyRepository } from './execution-emergency';
const target = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: target, max: 4 }); const database = drizzle(pool, { schema });
const user = { id: randomUUID(), username: `invoke-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username }; const queue = createHarnessRuntimeRepository(database);
const roots = createSkillsPgRepository(database); const changes = createSkillUsecase(roots, async () => []);
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const definition: SkillDefinition = { name: 'Invocation fixture', description: '', category: 'test', instructions: 'Frozen fixture', roles: ['pre_sales'],
  inputSchema: payload, outputSchema: payload, tools: [], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const loadContext = async (d: SkillDefinition): Promise<SkillResolvedContext> => ({ tools: [], snapshot: { schemaVersion: 1, references: [], tools: [], roles: ['ADMIN'],
  model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'ai', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } } as unknown as SkillResolvedContext);
const manifest = createExecutionManifestService({ database, loadSkillContext: loadContext, loadWorkflowTools: async () => [] });
const repository = createInvocationPgRepository(database);
function service(prepareExecution = manifest.prepareExecution) { return createSkillInvocationService({ queue, repository, prepareExecution }); }
async function skill() {
  const s = await roots.create(definition, actor);
  return roots.mutate(s.skillId, s.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
}
const attachment = () => ({ attachmentId: randomUUID(), name: 'material.txt', parsedSummary: 'original attachment', createdAt: new Date().toISOString() });
const message = () => ({ messageId: randomUUID(), role: 'user', content: 'original message', createdAt: new Date().toISOString() });
async function session(fields: Record<string, unknown> = {}) {
  const id = randomUUID();
  await database.insert(schema.aiSessions).values({ sessionId: id, ownerUserId: user.id, ownerUsername: user.username, title: 'Invocation',
    domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat',
    createdAt: new Date(), updatedAt: new Date(), ...fields });
  return id;
}
const request = (id: string, sources: unknown[] = []) => ({ submissionKey: randomUUID(), content: 'Start this task', execution: { kind: 'skill', skillId: id, input: { text: 'original' }, sources } });
async function runRows(key: string) { return database.select().from(schema.harnessRuns).where(and(eq(schema.harnessRuns.ownerUserId, user.id), eq(schema.harnessRuns.submissionKey, key))); }
async function persisted(runId: string) { return (await queue.findRunForOwner(runId, user.id))!; }
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => {
  await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
  await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
  await database.delete(schema.users).where(eq(schema.users.userId, user.id)); await pool.end();
});
test('real PG concurrent same-key calls commit one manifest, one Run and exactly two first events', async () => {
  const s = await skill(); const id = await session(); const b = request(s.skillId);
  const [a, replay] = await Promise.all([service().submitInvocation(user, id, b), service().submitInvocation(user, id, b)]);
  assert.deepEqual(a, replay); assert.equal((await runRows(b.submissionKey)).length, 1);
  const row = await persisted(a.data.runId); const frozen = readPersistedExecutionManifest((row.executionConfig as Record<string, unknown>).executionManifest);
  assert.equal(frozen.target.versionId, s.currentVersionId); assert.equal(row.runKind, 'workbench_chat');
  const events = await queue.listRunEventsAfter({ runId: row.harnessRunId, afterSequence: 0, limit: 100 });
  assert.deepEqual(events.map(e => e.eventType), ['run_queued', 'user/message']);
  assert.equal((events[1].payload as Record<string, unknown>).content, b.content); assert.equal(Object.keys(a.data).length, 4);
});
test('committed replay keeps its old version after publication change and ordinary disable', async () => {
  const s = await skill(); const id = await session(); const b = request(s.skillId); const first = await service().submitInvocation(user, id, b);
  const original = (await persisted(first.data.runId)).executionConfig;
  let next = await changes.action(s.skillId, s.revision, actor, 'promote');
  next = await roots.mutate(next.skillId, next.revision, actor, 'publish', r => { r.versions[1].status = 'published'; r.activeVersionId = r.currentVersionId; });
  await changes.setStatus(next.skillId, next.revision, actor, { enabled: false });
  const replay = await service(async () => { throw new Error('must not prepare latest'); }).submitInvocation(user, id, b);
  assert.deepEqual(replay, first); assert.deepEqual((await persisted(first.data.runId)).executionConfig, original);
});
test('real PG replays a Run committed after the initial miss even when ordinary disable makes prepare fail', async () => {
  const s = await skill(); const id = await session(); const b = request(s.skillId);
  let winner: Awaited<ReturnType<ReturnType<typeof service>['submitInvocation']>> | undefined;
  let lookups = 0; let queueCalls = 0;
  const racingQueue = {
    async findRunForSubmissionKey(owner: string, key: string) {
      const found = await queue.findRunForSubmissionKey(owner, key);
      if (lookups++ === 0) {
        assert.equal(found, null);
        winner = await service().submitInvocation(user, id, b);
        await changes.setStatus(s.skillId, s.revision, actor, { enabled: false });
      }
      return found;
    },
    async createQueuedRun(input: Parameters<typeof queue.createQueuedRun>[0]) { queueCalls++; return queue.createQueuedRun(input); },
  };
  const loser = await createSkillInvocationService({ queue: racingQueue, repository, prepareExecution: manifest.prepareExecution }).submitInvocation(user, id, b);
  assert.deepEqual(loser, winner); assert.equal(lookups, 2); assert.equal(queueCalls, 1);
  const rows = await runRows(b.submissionKey); assert.equal(rows.length, 1);
  const original = readPersistedExecutionManifest((rows[0].executionConfig as Record<string, unknown>).executionManifest);
  assert.equal(original.target.versionId, s.currentVersionId);
  const events = await queue.listRunEventsAfter({ runId: loser.data.runId, afterSequence: 0, limit: 100 }); assert.equal(events.length, 2);
});
test('same key rejects changes to session, content, target, input and sources; legacy collisions fail both directions', async () => {
  const s = await skill(); const id = await session(); const other = await session(); const a = attachment();
  await database.update(schema.aiSessions).set({ attachments: [a] }).where(eq(schema.aiSessions.sessionId, id));
  const b = request(s.skillId); await service().submitInvocation(user, id, b);
  for (const [sessionId, body] of [[other, b], [id, { ...b, content: 'changed' }],
    [id, { ...b, execution: { ...b.execution, skillId: randomUUID() } }],
    [id, { ...b, execution: { ...b.execution, input: { text: 'changed' } } }],
    [id, { ...b, execution: { ...b.execution, sources: [{ kind: 'file', id: a.attachmentId }] } }],
    [id, { ...b, execution: { kind: 'workflow', workflowId: randomUUID(), input: { text: 'original' } } }],
  ] as Array<[string, unknown]>) await assert.rejects(service().submitInvocation(user, sessionId, body), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT' && e.status === 409);
  await assert.rejects(queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: id, submissionKey: b.submissionKey,
    title: 'ordinary', workflowId: 'workbench_chat_v1', workflowVersion: '1.0.0' }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
  const legacySession = await session(); const legacyKey = randomUUID();
  await queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: legacySession, submissionKey: legacyKey,
    title: 'ordinary', workflowId: 'workbench_chat_v1', workflowVersion: '1.0.0' });
  await assert.rejects(service().submitInvocation(user, legacySession, { ...request(s.skillId), submissionKey: legacyKey }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
});
test('two business keys and ordinary chat continue to share one active-session constraint', async () => {
  const s = await skill(); const id = await session();
  const results = await Promise.allSettled([service().submitInvocation(user, id, request(s.skillId)), service().submitInvocation(user, id, request(s.skillId)),
    queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: id, submissionKey: randomUUID(), title: 'chat', workflowId: 'workbench_chat_v1', workflowVersion: '1.0.0' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'ACTIVE_WORKBENCH_RUN_EXISTS');
});
test('session not found/non-owner, deleted session and cross-session source identifiers all return safe 404', async () => {
  const s = await skill(); const a = attachment(); const m = message();
  const owned = await session(); const foreign = await session({ ownerUserId: randomUUID(), attachments: [a], messages: [m] });
  const deleted = await session(); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.sessionId, deleted));
  try {
    for (const [id, sources] of [[randomUUID(), []], [foreign, []], [deleted, []], [owned, [{ kind: 'file', id: a.attachmentId }]], [owned, [{ kind: 'conversation', id: m.messageId }]]] as Array<[string, unknown[]]>) {
      const b = request(s.skillId, sources); await assert.rejects(service().submitInvocation(user, id, b), (e: any) => e.code === 'INVOCATION_NOT_FOUND' && e.status === 404);
      assert.equal((await runRows(b.submissionKey)).length, 0);
    }
  } finally { await database.delete(schema.aiSessions).where(eq(schema.aiSessions.sessionId, foreign)); }
});
test('persisted conversation events are valid sources before snapshot projection; cross-run/session forgery is rejected', async () => {
  const s = await skill(); const id = await session(); const other = await session(); const { fact } = attachWorkbenchConversationFact({ content: 'saved event material' });
  const history = await queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: id, submissionKey: randomUUID(),
    title: 'history', workflowId: 'workbench_chat_v1', workflowVersion: '1.0.0', userMessageFact: runId => buildWorkbenchUserMessageFact({ runId, fact, content: 'saved event material' }) });
  await database.update(schema.harnessRuns).set({ status: 'completed' }).where(eq(schema.harnessRuns.harnessRunId, history.run.harnessRunId));
  const refs = [{ kind: 'conversation', id: fact.userMessage.messageId }];
  const result = await service().submitInvocation(user, id, request(s.skillId, refs)); assert.equal(result.status, 202);
  await assert.rejects(service().submitInvocation(user, other, request(s.skillId, refs)), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
  await assert.rejects(service().submitInvocation(user, id, request(s.skillId, [{ kind: 'conversation', id: history.run.harnessRunId }])), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
});
test('attachment and legacy conversation body drift between prepare and commit is rejected with no half Run', async () => {
  const s = await skill();
  for (const kind of ['file', 'conversation'] as const) {
    const a = attachment(); const m = message(); const id = await session({ attachments: [a], messages: [m] });
    const b = request(s.skillId, [{ kind, id: kind === 'file' ? a.attachmentId : m.messageId }]);
    const stale = service(async (...args) => {
      const prepared = await manifest.prepareExecution(...args);
      await database.update(schema.aiSessions).set(kind === 'file' ? { attachments: [{ ...a, parsedSummary: 'changed' }] } : { messages: [{ ...m, content: 'changed' }] }).where(eq(schema.aiSessions.sessionId, id));
      return prepared;
    });
    await assert.rejects(stale.submitInvocation(user, id, b), (e: any) => e.code === 'INVOCATION_SOURCE_CHANGED');
    assert.equal((await runRows(b.submissionKey)).length, 0);
  }
});
test('persisted event body drift is rejected, and unreadable or foreign-owner material cannot establish provenance', async () => {
  const s = await skill(); const id = await session(); const { fact } = attachWorkbenchConversationFact({ content: 'event source' });
  const history = await queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: id, submissionKey: randomUUID(),
    title: 'history', workflowId: 'workbench_chat_v1', workflowVersion: '1.0.0', userMessageFact: runId => buildWorkbenchUserMessageFact({ runId, fact, content: 'event source' }) });
  await database.update(schema.harnessRuns).set({ status: 'completed' }).where(eq(schema.harnessRuns.harnessRunId, history.run.harnessRunId));
  const b = request(s.skillId, [{ kind: 'conversation', id: fact.userMessage.messageId }]);
  const stale = service(async (...args) => {
    const prepared = await manifest.prepareExecution(...args);
    await database.update(schema.harnessRunEvents).set({ payload: buildWorkbenchUserMessageFact({ runId: history.run.harnessRunId, fact, content: 'changed event source' }) })
      .where(and(eq(schema.harnessRunEvents.harnessRunId, history.run.harnessRunId), eq(schema.harnessRunEvents.eventType, 'user/message')));
    return prepared;
  });
  await assert.rejects(stale.submitInvocation(user, id, b), (e: any) => e.code === 'INVOCATION_SOURCE_CHANGED');
  assert.equal((await runRows(b.submissionKey)).length, 0);
  await database.update(schema.harnessRuns).set({ ownerUserId: randomUUID() }).where(eq(schema.harnessRuns.harnessRunId, history.run.harnessRunId));
  try { await assert.rejects(service().submitInvocation(user, id, b), (e: any) => e.code === 'INVOCATION_NOT_FOUND'); }
  finally { await database.update(schema.harnessRuns).set({ ownerUserId: user.id }).where(eq(schema.harnessRuns.harnessRunId, history.run.harnessRunId)); }
  const unreadable = attachment(); const empty = await session({ attachments: [{ ...unreadable, parsedSummary: '' }] });
  await assert.rejects(service().submitInvocation(user, empty, request(s.skillId, [{ kind: 'file', id: unreadable.attachmentId }])), (e: any) => e.code === 'INVOCATION_NOT_FOUND');
});
test('source repository sanitizes errors during the second transactional verification', async () => {
  const id = await session(); const prepared = await repository.prepare(user, id, []);
  await assert.rejects(prepared.verify({ select() { throw new Error('private SQL parameters'); } } as any),
    (e: any) => e.code === 'INVOCATION_INTERNAL' && !e.message.includes('private'));
});
test('current role/status and owner are rechecked in the actual queue transaction', async () => {
  const s = await skill();
  for (const change of ['businessRole', 'role', 'status', 'owner'] as const) {
    const id = await session(); const b = request(s.skillId);
    const stale = service(async (...args) => {
      const prepared = await manifest.prepareExecution(...args);
      if (change === 'owner') await database.update(schema.aiSessions).set({ ownerUserId: randomUUID() }).where(eq(schema.aiSessions.sessionId, id));
      else await database.update(schema.users).set({ [change]: change === 'businessRole' ? 'delivery' : change === 'role' ? 'user' : 'disabled' }).where(eq(schema.users.userId, user.id));
      return prepared;
    });
    try {
      await assert.rejects(stale.submitInvocation(user, id, b), (e: any) => e.code === (change === 'owner' ? 'INVOCATION_NOT_FOUND' : 'INVOCATION_FORBIDDEN'));
      assert.equal((await runRows(b.submissionKey)).length, 0);
    } finally {
      await database.update(schema.users).set({ role: 'admin', businessRole: 'pre_sales', status: 'active' }).where(eq(schema.users.userId, user.id));
      await database.update(schema.aiSessions).set({ ownerUserId: user.id }).where(eq(schema.aiSessions.sessionId, id));
    }
  }
});
test('publication change during prepare rejects stale admission; max=1 service acquires no nested queue connection', async () => {
  const s = await skill(); const id = await session(); const b = request(s.skillId);
  const stale = service(async (...args) => {
    const prepared = await manifest.prepareExecution(...args); const next = await changes.action(s.skillId, s.revision, actor, 'promote');
    await roots.mutate(next.skillId, next.revision, actor, 'publish', r => { r.versions[1].status = 'published'; r.activeVersionId = r.currentVersionId; }); return prepared;
  });
  await assert.rejects(stale.submitInvocation(user, id, b), (e: any) => e.code === 'INVOCATION_CONTEXT_CHANGED'); assert.equal((await runRows(b.submissionKey)).length, 0);
  const single = new Pool({ connectionString: target, max: 1, connectionTimeoutMillis: 500 }); const one = drizzle(single, { schema });
  try {
    const a = attachment(); const m = message(); const withSources = await session({ messages: [m], attachments: [a] });
    const source = createExecutionManifestService({ database: one, loadSkillContext: async d => { await single.query('SELECT 1'); return loadContext(d); } });
    const run = await createSkillInvocationService({ queue: createHarnessRuntimeRepository(one), repository: createInvocationPgRepository(one), prepareExecution: source.prepareExecution })
      .submitInvocation(user, withSources, request(s.skillId, [{ kind: 'file', id: a.attachmentId }, { kind: 'conversation', id: m.messageId }]));
    assert.equal(run.status, 202); assert.notEqual((await persisted(run.data.runId)).executionConfig, undefined);
  } finally { await single.end(); }
});
test('workflow invocation freezes its published old Skill binding after the Skill default changes', async () => {
  const s = await skill();
  const workflows = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database,
    releases: createSkillReleaseRepository(database), getTools: async () => [], loadSkillContext: loadContext }), user);
  let w = await workflows.create({ name: 'Invocation workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
    steps: [{ id: 's', name: 'Skill', type: 'skill', skillId: s.skillId, skillVersionId: s.currentVersionId, inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' }],
    outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.s.output.text' } }] });
  w = await workflows.validate(w.workflowId, w.revision);
  w = await workflows.review(w.workflowId, w.revision, 'Static fixture review');
  const published = await workflows.publish(w.workflowId, w.revision);
  const next = await changes.action(s.skillId, s.revision, actor, 'promote');
  await roots.mutate(next.skillId, next.revision, actor, 'publish', r => { r.versions[1].status = 'published'; r.activeVersionId = r.currentVersionId; });
  const result = await service().submitInvocation(user, await session(), { submissionKey: randomUUID(), content: 'Workflow', execution: { kind: 'workflow', workflowId: w.workflowId, input: { text: 'original' } } });
  const saved = readPersistedExecutionManifest(((await persisted(result.data.runId)).executionConfig as Record<string, unknown>).executionManifest);
  assert.equal(saved.target.versionId, published.currentVersionId); assert.equal(saved.skills[0].versionId, s.currentVersionId);
  const controls = createExecutionEmergencyRepository(database);
  await controls.assertRunAdmission(result.data.runId, user.id);
  await controls.change('skill', s.skillId, user, 0, 'Stop dependency', 'stop');
  await assert.rejects(controls.assertRunAdmission(result.data.runId, user.id), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED');
  await controls.change('skill', s.skillId, user, 1, 'Release dependency', 'release');
  await assert.rejects(controls.assertRunAdmission(result.data.runId, user.id), (e: any) => e.code === 'EXECUTION_MANUAL_RETRY_REQUIRED');
  async function startWorkflow() { return service().submitInvocation(user, await session(), { submissionKey: randomUUID(), content: 'Workflow', execution: { kind: 'workflow', workflowId: w.workflowId, input: { text: 'original' } } }); }
  const fresh = await startWorkflow(); await controls.assertRunAdmission(fresh.data.runId, user.id);
  await controls.change('workflow', w.workflowId, user, 0, 'Stop workflow', 'stop');
  await assert.rejects(startWorkflow(), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED');
  await assert.rejects(controls.assertRunAdmission(fresh.data.runId, user.id), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED');
  await controls.change('workflow', w.workflowId, user, 1, 'Release workflow', 'release');
  await assert.rejects(controls.assertRunAdmission(fresh.data.runId, user.id), (e: any) => e.code === 'EXECUTION_MANUAL_RETRY_REQUIRED');
  const retry = await startWorkflow(); await controls.assertRunAdmission(retry.data.runId, user.id);
  await workflows.status(w.workflowId, published.revision, { enabled: false, archived: true });
  await controls.assertRunAdmission(retry.data.runId, user.id);
});
const emergency = createExecutionEmergencyRepository(database);
test('emergency stop rejects new queue work and committed replay, release requires a new explicit submission', async () => {
  const s = await skill(); const id = await session(); const b = request(s.skillId);
  const first = await service().submitInvocation(user, id, b);
  assert.equal((await emergency.assertRunAdmission(first.data.runId, user.id)).runId, first.data.runId);
  const before = await roots.get(s.skillId);
  await emergency.change('skill', s.skillId, user, 0, 'Investigate', 'stop');
  for (const [sid, body] of [[id, b], [await session(), request(s.skillId)]] as const)
    await assert.rejects(service().submitInvocation(user, sid, body), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED' && e.status === 409);
  await assert.rejects(emergency.assertRunAdmission(first.data.runId, user.id), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED');
  await emergency.change('skill', s.skillId, user, 1, 'Reviewed', 'release');
  assert.deepEqual(await roots.get(s.skillId), before, 'normal revisions and published definitions are untouched');
  await assert.rejects(service().submitInvocation(user, id, b), (e: any) => e.code === 'EXECUTION_MANUAL_RETRY_REQUIRED');
  await assert.rejects(emergency.assertRunAdmission(first.data.runId, user.id), (e: any) => e.code === 'EXECUTION_MANUAL_RETRY_REQUIRED');
  const next = await service().submitInvocation(user, await session(), request(s.skillId));
  await emergency.assertRunAdmission(next.data.runId, user.id);
  assert.equal((await persisted(first.data.runId)).status, 'queued', 'release never changes or resumes old Run');
});
test('ordinary disable/archive only rejects new starts; existing persisted run remains admissible', async () => {
  const s = await skill(); const id = await session(); const b = request(s.skillId);
  const first = await service().submitInvocation(user, id, b);
  await changes.setStatus(s.skillId, s.revision, actor, { enabled: false, archived: true });
  await emergency.assertRunAdmission(first.data.runId, user.id);
  assert.deepEqual(await service().submitInvocation(user, id, b), first);
  await assert.rejects(service().submitInvocation(user, await session(), request(s.skillId)), (e: any) => e.code === 'INVOCATION_CONTEXT_CHANGED');
});
test('admission reads actual owner/session/current identity and rejects corrupt or forged epoch bindings', async () => {
  const s = await skill(); const first = await service().submitInvocation(user, await session(), request(s.skillId));
  const saved = await persisted(first.data.runId); const config = saved.executionConfig as Record<string, unknown>;
  await assert.rejects(emergency.assertRunAdmission(first.data.runId, randomUUID()), (e: any) => e.code === 'EXECUTION_RUN_NOT_FOUND');
  for (const binding of [undefined, [], [{ kind: 'skill', id: s.skillId, epoch: -1 }], [{ kind: 'skill', id: 'forged', epoch: 0 }],
    [{ kind: 'skill', id: s.skillId, epoch: 0, extra: true }], [config.executionAuthority, config.executionAuthority]]) {
    await database.update(schema.harnessRuns).set({ executionConfig: { ...config, executionAuthority: binding } }).where(eq(schema.harnessRuns.harnessRunId, first.data.runId));
    await assert.rejects(emergency.assertRunAdmission(first.data.runId, user.id), (e: any) => e.code === 'EXECUTION_RUN_BINDING_INVALID');
  }
  await database.update(schema.harnessRuns).set({ executionConfig: config }).where(eq(schema.harnessRuns.harnessRunId, first.data.runId));
  for (const change of [{ status: 'disabled' as const }, { businessRole: 'delivery' }]) {
    await database.update(schema.users).set(change).where(eq(schema.users.userId, user.id));
    try { await assert.rejects(emergency.assertRunAdmission(first.data.runId, user.id), (e: any) => e.code === 'EXECUTION_AUTHORITY_CHANGED'); }
    finally { await database.update(schema.users).set({ status: 'active', businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
  }
  await database.update(schema.aiSessions).set({ ownerUserId: randomUUID() }).where(eq(schema.aiSessions.sessionId, saved.aiSessionId!));
  try { await assert.rejects(emergency.assertRunAdmission(first.data.runId, user.id), (e: any) => e.code === 'EXECUTION_RUN_NOT_FOUND'); }
  finally { await database.update(schema.aiSessions).set({ ownerUserId: user.id }).where(eq(schema.aiSessions.sessionId, saved.aiSessionId!)); }
});
test('emergency audit is durable, append only, root constrained and concurrent revision writers cannot both win', async () => {
  const s = await skill();
  const outcomes = await Promise.allSettled([emergency.change('skill', s.skillId, user, 0, 'First', 'stop'), emergency.change('skill', s.skillId, user, 0, 'Second', 'stop')]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'EXECUTION_CONTROL_CONFLICT');
  const stored = await createExecutionEmergencyRepository(database).read('skill', s.skillId, user);
  assert.equal(stored.audit.length, 1); assert.equal(stored.control.epoch, 1);
  for (const mutate of [() => database.update(schema.executionEmergencyAudits).set({ reason: 'tamper' }).where(eq(schema.executionEmergencyAudits.id, stored.audit[0].id)),
    () => database.delete(schema.executionEmergencyAudits).where(eq(schema.executionEmergencyAudits.id, stored.audit[0].id))])
    await assert.rejects(mutate(), (e: any) => (e.cause?.code ?? e.code) === '23514');
  const audit = { id: randomUUID(), actorId: user.id, action: 'stop' as const, reason: 'x', epoch: 1, revision: 1, createdAt: new Date() };
  for (const refs of [{}, { skillId: randomUUID() }]) await assert.rejects(database.insert(schema.executionEmergencyAudits).values({ ...audit, ...refs }),
    (e: any) => ['23514', '23503'].includes(e.cause?.code ?? e.code));
  await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
  try { await assert.rejects(emergency.change('skill', s.skillId, user, 1, 'stale admin', 'release'), (e: any) => e.code === 'EXECUTION_CONTROL_FORBIDDEN'); }
  finally { await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id)); }
  assert.equal((await emergency.read('skill', s.skillId, user)).audit.length, 1);
});
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function assertLockWait(pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('Expected actual PostgreSQL lock wait');
}
test('a committed stop wins over queue admission even when preparation finished before the stop', async () => {
  const s = await skill(); const b = request(s.skillId); const id = await session(); const ready = deferred(); const proceed = deferred();
  const inFlight = service(async (...args) => { const prepared = await manifest.prepareExecution(...args); ready.resolve(); await proceed.promise; return prepared; })
    .submitInvocation(user, id, b);
  await ready.promise; await emergency.change('skill', s.skillId, user, 0, 'Stop before queue commit', 'stop'); proceed.resolve();
  await assert.rejects(inFlight, (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED'); assert.equal((await runRows(b.submissionKey)).length, 0);
});
test('stop followed by release during preparation rejects the original submission, requiring a new explicit request', async () => {
  const s = await skill(); const b = request(s.skillId); const id = await session(); const ready = deferred(); const proceed = deferred();
  const inFlight = service(async (...args) => { const prepared = await manifest.prepareExecution(...args); ready.resolve(); await proceed.promise; return prepared; }).submitInvocation(user, id, b);
  await ready.promise; await emergency.change('skill', s.skillId, user, 0, 'Stop during preparation', 'stop');
  await emergency.change('skill', s.skillId, user, 1, 'Reviewed during preparation', 'release'); proceed.resolve();
  await assert.rejects(inFlight, (e: any) => e.code === 'EXECUTION_MANUAL_RETRY_REQUIRED');
  assert.equal((await runRows(b.submissionKey)).length, 0);
});
test('stop and real run admission serialize on the aggregate root; current user changes wait for an admitted transaction', async () => {
  const s = await skill(); const first = await service().submitInvocation(user, await session(), request(s.skillId));
  const locked = deferred(); const release = deferred();
  const fenced = { transaction: (callback: any) => database.transaction(async tx => { const value = await callback(tx); locked.resolve(); await release.promise; return value; }) } as typeof database;
  const admission = createExecutionEmergencyRepository(fenced).assertRunAdmission(first.data.runId, user.id);
  await locked.promise;
  let stopped = false; let revoked = false;
  const stopPid = deferred<number>(); const revokePid = deferred<number>();
  const tracked = (pid: ReturnType<typeof deferred<number>>) => ({ transaction: (callback: any) => database.transaction(async tx => {
    const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`); pid.resolve((result.rows[0] as { pid: number }).pid); return callback(tx);
  }) }) as typeof database;
  const stop = createExecutionEmergencyRepository(tracked(stopPid)).change('skill', s.skillId, user, 0, 'Concurrent stop', 'stop').then(() => { stopped = true; });
  const revoke = tracked(revokePid).transaction(tx => tx.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, user.id))).then(() => { revoked = true; });
  try { await Promise.all([assertLockWait(await stopPid.promise), assertLockWait(await revokePid.promise)]); assert.equal(stopped, false); assert.equal(revoked, false); }
  finally { release.resolve(); await admission; await Promise.allSettled([stop, revoke]); }
  try { await assert.rejects(emergency.assertRunAdmission(first.data.runId, user.id), (e: any) => e.code === 'EXECUTION_AUTHORITY_CHANGED'); }
  finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, user.id)); }
});
test('queue commit holds the same root fence; a waiting stop then blocks that persisted old run', async () => {
  const s = await skill(); const locked = deferred(); const release = deferred(); const stopPid = deferred<number>();
  const waiting = new Proxy(database, { get(base, key) {
    if (key === 'transaction') return (callback: any) => database.transaction(async tx => { const result = await callback(tx); locked.resolve(); await release.promise; return result; });
    return Reflect.get(base, key);
  } });
  const inFlight = createSkillInvocationService({ queue: createHarnessRuntimeRepository(waiting), repository, prepareExecution: manifest.prepareExecution })
    .submitInvocation(user, await session(), request(s.skillId));
  await locked.promise;
  const tracked = { transaction: (callback: any) => database.transaction(async tx => {
    const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`); stopPid.resolve((result.rows[0] as { pid: number }).pid); return callback(tx);
  }) } as typeof database;
  const stop = createExecutionEmergencyRepository(tracked).change('skill', s.skillId, user, 0, 'Wait for queue transaction', 'stop');
  try { await assertLockWait(await stopPid.promise); }
  finally { release.resolve(); }
  const submitted = await inFlight; await stop;
  await assert.rejects(emergency.assertRunAdmission(submitted.data.runId, user.id), (e: any) => e.code === 'EXECUTION_EMERGENCY_STOPPED');
});
