import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import type { AuthUser } from '../../types';
import { createHarnessRuntimeRepository } from './harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry, HarnessFaultInjectedError } from './harness-runtime.worker';
import { createHarnessRecoveryCoordinator } from './harness-runtime.recovery';
import { createBusinessSkillsWorkflow, type BusinessSkillsExecutor } from './business-skills.workflow';
import { createSkillInvocationService } from '../skills/skills.invocation';
import { createInvocationPgRepository } from '../skills/skills.invocation-pg.repository';
import { createExecutionManifestService, readPersistedExecutionManifest } from '../skills/execution-manifest';
import { createSkillsPgRepository } from '../skills/skills-pg.repository';
import { createSkillUsecase } from '../skills/skills.usecase';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createSkillReleaseRepository } from '../skills/skills-release.repository';
import { definition, hash, outcome, payload } from './business-skills.test-fixture';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 2000 });
const database = drizzle(pool, { schema }); const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `adapter-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username }; const roots = createSkillsPgRepository(database); const changes = createSkillUsecase(roots, async () => []);
const skillIds: string[] = []; const workflowIds: string[] = [];
let dependencyReads = 0; let materialBody = 'Original material';
const uri = 'wes://knowledge/adapter-source'; const version = '2026-11-02T00:00:00.000Z';
const loadContext = async (d: any): Promise<any> => { dependencyReads++; await pool.query('SELECT 1'); return { tools: [], snapshot: { schemaVersion: 1,
  references: d.references.map(() => ({ uri, version, digest: hash({ title: 'Material', content: materialBody }) })), tools: [], roles: ['ADMIN'],
  model: { providerId: 'fixture', model: d.model.temperature === 0 ? 'original-model' : 'latest-model', modelSource: 'binding', credentialScope: 'ai', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }; };
const manifests = createExecutionManifestService({ database, loadSkillContext: loadContext, loadWorkflowTools: async () => [],
  loadReference: async () => { dependencyReads++; return { title: 'Material', content: materialBody, status: 'active', updatedAt: version } as any; },
  prepareAuthority: async (_uris, resolve) => ({ value: await resolve(), async verify() {} }) });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
async function skill() {
  const created = await roots.create({ ...structuredClone(definition), references: [{ label: 'Source', uri, version }] }, actor);
  skillIds.push(created.skillId);
  return roots.mutate(created.skillId, created.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
}
async function enqueue(id: string, kind: 'skill' | 'workflow' = 'skill') {
  const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username,
    title: 'Adapter', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
  const result = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Execute frozen task', execution: { kind,
    [kind === 'skill' ? 'skillId' : 'workflowId']: id, input: { text: 'original' } } }); return result.data.runId;
}
const persisted = async (id: string) => (await queue.findRunForOwner(id, user.id))!;
const registry = (executor?: BusinessSkillsExecutor) => createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor })]);
const worker = (r: ReturnType<typeof registry>, options: any = {}) => createHarnessRuntimeWorker({ repository: queue, registry: r, workerId: randomUUID(), ...options });
async function recover(id: string, r: ReturnType<typeof registry>) {
  await database.update(schema.harnessRunAttempts).set({ leaseExpiresAt: new Date(Date.now() - 10000) }).where(eq(schema.harnessRunAttempts.harnessRunId, id));
  const results = await createHarnessRecoveryCoordinator({ repository: queue, registry: r, timing: { backoffMs: [1, 1, 1] } }).scanOnce();
  assert.equal(results.find(row => row.runId === id)?.outcome, 'scheduled');
  await database.update(schema.harnessRuns).set({ availableAt: new Date(Date.now() - 1000) }).where(eq(schema.harnessRuns.harnessRunId, id));
  assert.equal(await worker(r).runNextAttempt(), true);
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
afterEach(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); });
after(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
  await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
  // Published history is intentionally immutable. Retire only this suite's tracked roots.
  const workflowRoots = createWorkflowsPgRepository(database);
  for (const id of workflowIds) {
    const root = (await workflowRoots.get(id))!;
    const retired = await workflowRoots.mutate(id, root.revision, actor, 'status', r => { r.enabled = false; r.archived = true; });
    assert.equal(retired.archived, true); assert.equal(retired.enabled, false);
  }
  for (const id of skillIds) {
    const root = (await roots.get(id))!;
    const retired = await changes.setStatus(id, root.revision, actor, { enabled: false, archived: true });
    assert.equal(retired.archived, true); assert.equal(retired.enabled, false);
  }
  await database.delete(schema.users).where(eq(schema.users.userId, user.id)); await pool.end(); });
test('real queue/claim/commit recovers original Skill material/schema/model after active pointer change and ordinary disable, max=1', async () => {
  const s = await skill(); const id = await enqueue(s.skillId); const original = readPersistedExecutionManifest((await persisted(id)).executionConfig && ((await persisted(id)).executionConfig as any).executionManifest);
  let calls = 0; const r = registry(async input => {
    calls++; assert.deepEqual(input.manifest, original);
    assert.equal(input.manifest.skills[0].materials[0].content, 'Original material'); assert.deepEqual(input.manifest.target.definition.outputSchema, payload);
    assert.equal(input.manifest.skills[0].context.model.model, 'original-model'); assert.equal(input.state.cursor, calls === 1 ? undefined : 1);
    const result = outcome(calls === 1 ? 'execute' : null); result.checkpoint.key = `step-${calls}`; return result;
  });
  await worker(r, { faultInjector: (_step: string, phase: string) => { if (phase === 'afterStepCommit') throw new HarnessFaultInjectedError(); } }).runNextAttempt();
  assert.equal((await persisted(id)).status, 'running'); const saved = await queue.listCheckpointsForRun({ runId: id }); assert.equal(saved.length, 1);
  assert.equal(saved[0].resumePolicy, 'restart_step'); assert.equal((saved[0].state as any).businessSkills.manifestHash, original.manifestHash);
  let next = await changes.action(s.skillId, s.revision, actor, 'promote');
  next = await roots.mutate(next.skillId, next.revision, actor, 'publish', r => { r.versions[1].status = 'published'; r.activeVersionId = r.currentVersionId; });
  await changes.setStatus(next.skillId, next.revision, actor, { enabled: false }); materialBody = 'Changed material'; const reads = dependencyReads;
  await recover(id, r); assert.equal(calls, 2); assert.equal(dependencyReads, reads); assert.equal((await persisted(id)).status, 'completed');
  assert.deepEqual((await queue.getRunSnapshot(id))?.output?.content, { text: 'Frozen result' }); materialBody = 'Original material';
});
test('real Workflow checkpoint recovery keeps old Skill/schema/model/material after different versions publish and ordinary disable', async () => {
  const s = await skill(); const workflowRoots = createWorkflowsPgRepository(database);
  const workflows = createWorkflowService(workflowRoots, createWorkflowContextLoader({ database, releases: createSkillReleaseRepository(database), getTools: async () => [], loadSkillContext: loadContext }), user);
  const workflowDefinition = { name: 'Adapter workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
    steps: [{ id: 's', name: 'Skill', type: 'skill', skillId: s.skillId, skillVersionId: s.currentVersionId,
      inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' }],
    outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.s.output.text' } }] };
  let w = await workflows.create(workflowDefinition); workflowIds.push(w.workflowId);
  w = await workflows.validate(w.workflowId, w.revision); w = await workflows.review(w.workflowId, w.revision, 'Fixture review'); w = await workflows.publish(w.workflowId, w.revision);
  const id = await enqueue(w.workflowId, 'workflow');
  const original = readPersistedExecutionManifest(((await persisted(id)).executionConfig as any).executionManifest);
  let calls = 0; const r = registry(async input => {
    calls++; assert.equal(input.manifest.kind, 'workflow'); assert.deepEqual(input.manifest, original);
    assert.equal(input.manifest.target.versionId, w.currentVersionId); assert.equal(input.manifest.skills[0].versionId, s.currentVersionId);
    assert.equal(input.manifest.skills[0].definition.instructions, 'Original instructions');
    assert.equal(input.manifest.skills[0].context.model.model, 'original-model'); assert.equal(input.manifest.skills[0].context.model.params.temperature, 0);
    assert.deepEqual(input.manifest.target.definition.outputSchema, payload); assert.deepEqual(input.manifest.skills[0].definition.outputSchema, payload);
    assert.deepEqual(input.manifest.publishedDependencies!.skills[0].context, original.skills[0].context);
    assert.equal(input.manifest.skills[0].materials[0].content, 'Original material'); assert.equal(input.state.cursor, calls === 1 ? undefined : 1);
    const result = outcome(calls === 1 ? 'execute' : null); result.checkpoint.key = `workflow-${calls}`; return result;
  });
  await worker(r, { faultInjector: (_step: string, phase: string) => { if (phase === 'afterStepCommit') throw new HarnessFaultInjectedError(); } }).runNextAttempt();
  assert.equal(calls, 1); assert.equal((await persisted(id)).status, 'running');
  const saved = await queue.listCheckpointsForRun({ runId: id }); assert.equal(saved.length, 1);
  assert.equal((saved[0].state as any).businessSkills.state.cursor, 1); assert.equal(saved[0].resumePolicy, 'restart_step');
  const latestSchema = { ...structuredClone(payload), properties: { text: { type: 'string', minLength: 40 } } };
  const latestSkillDefinition = { ...structuredClone(definition), instructions: 'Different latest instructions', model: { ...definition.model, temperature: 0.7 },
    outputSchema: latestSchema, references: [{ label: 'Source', uri, version }] };
  let next = await changes.action(s.skillId, s.revision, actor, 'promote'); next = await changes.action(next.skillId, next.revision, actor, 'checkout');
  next = await changes.save(next.skillId, next.revision, actor, latestSkillDefinition); next = await changes.action(next.skillId, next.revision, actor, 'checkin');
  next = await roots.mutate(next.skillId, next.revision, actor, 'publish', root => { const current = root.versions.find(v => v.skillVersionId === root.currentVersionId)!; current.status = 'published'; root.activeVersionId = root.currentVersionId; });
  assert.notEqual(next.activeVersionId, s.activeVersionId); assert.notEqual(next.versions[1].hash, s.versions[0].hash);
  materialBody = 'Different latest material';
  let nw = await workflows.action(w.workflowId, w.revision, 'promote'); nw = await workflows.action(nw.workflowId, nw.revision, 'checkout');
  nw = await workflows.save(nw.workflowId, nw.revision, { ...workflowDefinition, outputSchema: latestSchema,
    steps: [{ ...workflowDefinition.steps[0], skillVersionId: next.currentVersionId }] });
  nw = await workflows.action(nw.workflowId, nw.revision, 'checkin'); nw = await workflows.validate(nw.workflowId, nw.revision);
  nw = await workflows.review(nw.workflowId, nw.revision, 'Different version review'); nw = await workflows.publish(nw.workflowId, nw.revision);
  assert.notEqual(nw.activeVersionId, w.activeVersionId); assert.notEqual(nw.versions[1].hash, w.versions[0].hash);
  assert.equal(nw.versions[1].dependencySnapshot!.skills[0].skillVersionId, next.currentVersionId);
  assert.equal(nw.versions[1].dependencySnapshot!.skills[0].context.model.model, 'latest-model');
  await workflows.status(nw.workflowId, nw.revision, { enabled: false }); await changes.setStatus(next.skillId, next.revision, actor, { enabled: false });
  const reads = dependencyReads;
  try {
    await recover(id, r); assert.equal(calls, 2); assert.equal(dependencyReads, reads); assert.equal((await persisted(id)).status, 'completed');
    assert.deepEqual(((await persisted(id)).executionConfig as any).executionManifest, original);
    const output = (await queue.getRunSnapshot(id))!.output!; assert.equal(output.status, 'final');
    assert.deepEqual(output.content, { text: 'Frozen result' }); assert.equal(output.contentHash, hash(output.content));
    assert.ok((output.content as any).text.length < latestSchema.properties.text.minLength);
    assert.equal((await queue.listCheckpointsForRun({ runId: id })).length, 2);
  } finally { materialBody = 'Original material'; }
});
test('corrupt saved manifest fails before executor and no recovery-completed event is emitted', async () => {
  const id = await enqueue((await skill()).skillId); const run = await persisted(id); const config = structuredClone(run.executionConfig) as any; config.executionManifest.manifestHash = 'bad';
  await database.update(schema.harnessRuns).set({ executionConfig: config }).where(eq(schema.harnessRuns.harnessRunId, id)); let calls = 0;
  await worker(registry(async () => { calls++; return outcome(); })).runNextAttempt();
  const failed = await persisted(id); assert.equal(failed.status, 'failed'); assert.equal(failed.errorMessage, 'BUSINESS_SKILLS_INVALID_RUN'); assert.equal(calls, 0);
});
for (const corruption of ['terminalPolicy', 'envelope', 'unavailable']) test(`real restart rejects ${corruption} before executor or terminal bypass`, async () => {
  const id = await enqueue((await skill()).skillId); let calls = 0;
  const r = registry(async () => { calls++; return outcome('execute'); });
  await worker(r, { faultInjector: () => {} , repository: { ...queue, upsertRunOutput: async () => { throw new HarnessFaultInjectedError(); } } }).runNextAttempt();
  const cp = (await queue.listCheckpointsForRun({ runId: id }))[0]; assert.ok(cp);
  if (corruption === 'terminalPolicy') { const state = { ...(cp.state as any), nextStepKey: null }; await database.update(schema.harnessRunCheckpoints).set({ resumePolicy: 'resume_next', state, stateHash: hash(state) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId)); }
  if (corruption === 'envelope') { const state = { nextStepKey: null }; await database.update(schema.harnessRunCheckpoints).set({ state, stateHash: hash(state) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId)); }
  await recover(id, corruption === 'unavailable' ? registry() : r); assert.equal(calls, 1); assert.equal((await persisted(id)).status, 'failed');
  const events = await queue.listRunEventsAfter({ runId: id, afterSequence: 0, limit: 100 }); assert.equal(events.some(row => row.eventType === 'recovery_completed'), false);
});
test('terminal restart checkpoint with missing persisted output re-enters executor and writes final output', async () => {
  const id = await enqueue((await skill()).skillId); let calls = 0;
  const r = registry(async () => { calls++; const result = outcome(); result.checkpoint.key = `final-${calls}`; return result; });
  await worker(r, { repository: { ...queue, upsertRunOutput: async () => { throw new HarnessFaultInjectedError(); } } }).runNextAttempt();
  assert.equal((await queue.getRunSnapshot(id))?.output, null); await recover(id, r);
  assert.equal(calls, 2); assert.equal((await persisted(id)).status, 'completed'); assert.equal((await queue.getRunSnapshot(id))?.output?.status, 'final');
});

test('one live attempt advances business cursor across repeated execute steps before final completion', async () => {
  const id = await enqueue((await skill()).skillId); let calls = 0;
  await worker(registry(async input => {
    assert.equal(input.state.cursor, calls || undefined); calls++;
    const result = outcome(calls < 3 ? 'execute' : null); result.state.cursor = calls; result.checkpoint.key = `live-${calls}`; return result;
  })).runNextAttempt();
  assert.equal(calls, 3); assert.equal((await persisted(id)).status, 'completed');
  assert.equal((await queue.listCheckpointsForRun({ runId: id })).length, 3);
});
