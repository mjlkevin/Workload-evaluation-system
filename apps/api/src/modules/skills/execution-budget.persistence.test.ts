import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { manifest as workflowManifest } from '../harness/workflows.runtime.fixture';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillRetryService } from './skills.retry';
import { createExecutionBudgetService } from './execution-budget';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
const url = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: url, max: 1, application_name: 'wes-budget-main', connectionTimeoutMillis: 1000 });
const control = new Pool({ connectionString: url, max: 3, application_name: 'wes-budget-control' });
const database = drizzle(pool, { schema }), alternate = drizzle(control, { schema });
const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `budget-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const native = { name: 'budget_read', description: 'Fixture read', parameters: payload, mutates: false, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
const definition: SkillDefinition = { name: 'Budget fixture', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'],
 inputSchema: payload, outputSchema: payload, tools: [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }],
 references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const inventory = async () => ({ registry: { get: (name: string) => name === native.name ? native : undefined }, tools: [], policy: { schemaVersion: 1, policies: {} } }) as any;
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: [native], snapshot: {
 schemaVersion: 1, references: [], tools: [{ native, policy: DEFAULT_TOOL_POLICY_ENTRY }], roles: ['ADMIN'],
 model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'provider:fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
const retainedSkillRoots: string[] = [];
const service = (extra: any = {}) => createExecutionBudgetService({ database, ...extra });
const rows = (id: string) => database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, id));
const updateRun = (id: string, patch: any) => database.update(schema.harnessRuns).set(patch).where(eq(schema.harnessRuns.harnessRunId, id));
async function fixture() {
 const roots = createSkillsPgRepository(database); let root = await roots.create(structuredClone(definition), { id: user.id, username: user.username });
 retainedSkillRoots.push(root.skillId);
 root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Budget', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Frozen request', execution: { kind: 'skill', skillId: root.skillId, input: { text: 'original' } } });
 return { root, sessionId, runId: accepted.data.runId };
}
async function retry(runId: string) {
 await updateRun(runId, { status: 'failed' });
 const next = await createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { throw new Error('NO MODEL DISPATCH'); } }) }).retryInvocation(user, runId, { submissionKey: randomUUID(), reason: 'Explicit retry' });
 return next.data.runId;
}
const request = (runId: string, patch: Record<string, unknown> = {}) => ({ runId, ownerUserId: user.id, kind: 'model' as const, maxOutputTokens: 100, timeoutMs: 1000, ...patch });
const denied = (code?: string) => (e: any) => e.status >= 400 && (!code || e.code === code);
const ok = async () => ({ value: 'ok', outputTokens: 0 });
function deferred<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function wrappedDatabase(wrap: (tx: any, count: number) => any) {
 const wrapped = Object.create(database); let count = 0;
 wrapped.transaction = (callback: any, settings: any) => database.transaction(tx => callback(wrap(tx, ++count)), settings);
 return wrapped;
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => {
 await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
 await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
 await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 for (const [table, column] of [['harness_runs', 'owner_user_id'], ['ai_sessions', 'owner_user_id'], ['users', 'user_id']])
  assert.equal(Number((await pool.query(`SELECT count(*) n FROM ${table} WHERE ${column}=$1`, [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM skill_definitions WHERE skill_id=ANY($1::text[])', [retainedSkillRoots])).rows[0].n), retainedSkillRoots.length);
 const retainedAudit = Number((await pool.query('SELECT count(*) n FROM skill_revisions WHERE skill_id=ANY($1::text[])', [retainedSkillRoots])).rows[0].n);
 assert.ok(retainedAudit >= retainedSkillRoots.length * 2);
 console.info(`budget cleanup: Runs/Sessions/users=0; retained Skill roots=${retainedSkillRoots.length}, audit=${retainedAudit}`);
 await pool.end(); await control.end();
});
test('twenty explicit retry Runs and reconstructed services share one root token budget', async () => {
 const f = await fixture(); let runId = f.runId, callbacks = 0;
 for (let i = 0; i < 20; i++) {
  if (i) runId = await retry(runId);
  await service().runWithBudget(request(runId, { maxOutputTokens: 6400 }), async c => { callbacks++; assert.equal(c.maxOutputTokens, 6400); return { value: i, outputTokens: 6400 }; });
 }
 const snapshot = await service().readBudget(user.id, runId);
 assert.equal(snapshot.rootRunId, f.runId); assert.equal(snapshot.outputTokens, 128000); assert.equal(snapshot.modelAttempts, 20);
 await assert.rejects(service().runWithBudget(request(runId), async () => { callbacks++; return { value: null }; }), denied('EXECUTION_BUDGET_EXHAUSTED'));
 assert.equal(callbacks, 20); assert.equal((await rows(f.runId)).filter(r => r.effectKey === 'business-budget:v1').length, 1);
});
test('model attempts and tool calls have independent non-refundable sixty-call ceilings', async () => {
 const f = await fixture(); let calls = 0;
 for (const kind of ['model', 'tool'] as const) {
  for (let i = 0; i < 60; i++) await service().runWithBudget(request(f.runId, { kind, maxOutputTokens: kind === 'model' ? 1 : 0 }), async c => { calls++; if (kind === 'tool') assert.equal(c.maxOutputTokens, 0); return { value: true, outputTokens: 0 }; });
  await assert.rejects(service().runWithBudget(request(f.runId, { kind, maxOutputTokens: kind === 'model' ? 1 : 0 }), async () => { calls++; return { value: true }; }), denied('EXECUTION_BUDGET_EXHAUSTED'));
 }
 assert.equal(calls, 120); const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.modelAttempts, 60); assert.equal(snapshot.toolCalls, 60);
});
test('concurrent full-budget reservations have exactly one winner before external dispatch', async () => {
 const f = await fixture(), entered = deferred(), release = deferred(); let calls = 0;
 const first = service().runWithBudget(request(f.runId, { maxOutputTokens: 128000 }), async () => { calls++; entered.resolve(); await release.promise; return { value: 'winner', outputTokens: 128000 }; });
 await entered.promise;
 const second = createExecutionBudgetService({ database: alternate }).runWithBudget(request(f.runId, { maxOutputTokens: 128000 }), async () => { calls++; return { value: 'loser' }; });
 await assert.rejects(second, denied('EXECUTION_BUDGET_EXHAUSTED')); release.resolve(); assert.equal(await first, 'winner'); assert.equal(calls, 1);
});
test('max-one pool callback can query committed reservation, before any output exists', async () => {
 const f = await fixture();
 assert.equal(await service().runWithBudget(request(f.runId), async c => {
  const entries = await rows(f.runId), reserved = entries.find(r => r.eventType === 'business_budget_reservation');
  assert.equal(reserved?.status, 'reserved'); assert.equal(reserved?.output, null);
  const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.modelAttempts, 1); assert.equal(snapshot.outputTokens, 100);
  assert.equal(c.timeoutMs, 1000); return { value: 'released', outputTokens: 12 };
 }), 'released');
 const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.outputTokens, 12); assert.equal(snapshot.modelAttempts, 1);
});
test('unknown usage, failed call and cancellation retain full reservations across reconstruction', async () => {
 const f = await fixture(); await service().runWithBudget(request(f.runId), async () => ({ value: true }));
 await assert.rejects(service().runWithBudget(request(f.runId), async () => { throw new Error('provider private detail'); }), denied('EXECUTION_BUDGET_CALLBACK_FAILED'));
 const controller = new AbortController();
 await assert.rejects(service().runWithBudget(request(f.runId, { signal: controller.signal }), async c => { controller.abort(); assert.equal(c.signal.aborted, true); return { value: 'late', outputTokens: 0 }; }), denied('EXECUTION_BUDGET_ABORTED'));
 const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.outputTokens, 300); assert.equal(snapshot.modelAttempts, 3); assert.ok(snapshot.activeMs >= 2000);
 const failed = (await rows(f.runId)).filter(r => r.status === 'failed'); assert.equal(failed.length, 2); assert.equal(JSON.stringify(failed).includes('provider private detail'), false);
});
test('timeout never becomes late success and conservatively exhausts active execution budget', async () => {
 const f = await fixture(), done = deferred<{ value: string; outputTokens: number }>(); let signal: AbortSignal | undefined;
 const work = service().runWithBudget(request(f.runId, { timeoutMs: 20 }), async c => { signal = c.signal; return done.promise; });
 await assert.rejects(work, denied('EXECUTION_BUDGET_TIMEOUT')); assert.equal(signal?.aborted, true);
 done.resolve({ value: 'late', outputTokens: 0 }); await new Promise(r => setTimeout(r, 5));
 let snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.outputTokens, 100); assert.equal(snapshot.modelAttempts, 1); assert.equal(snapshot.activeMs, 20);
 await assert.rejects(service().runWithBudget(request(f.runId, { timeoutMs: 300000 }), async c => { assert.equal(c.timeoutMs, 299980); throw new Error('unknown'); }), denied());
 snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.activeMs, 300000);
 await assert.rejects(service().runWithBudget(request(f.runId), ok), denied('EXECUTION_BUDGET_EXHAUSTED'));
});
test('successful fast work refunds reserved active time; manual waiting does not consume time', async () => {
 const f = await fixture(); await service().runWithBudget(request(f.runId, { timeoutMs: 300000 }), ok);
 const before = await service().readBudget(user.id, f.runId); assert.ok(before.activeMs < 300000);
 await updateRun(f.runId, { status: 'waiting' }); await new Promise(r => setTimeout(r, 25));
 assert.deepEqual(await service().readBudget(user.id, f.runId), before);
});
test('invalid usage and oversized usage fail closed, never refunding tokens or time', async () => {
 for (const outputTokens of [-1, NaN, Infinity, 101, 0.5, '0', null]) {
  const f = await fixture(); await assert.rejects(service().runWithBudget(request(f.runId), async () => ({ value: true, outputTokens } as any)), denied('EXECUTION_BUDGET_USAGE_INVALID'));
  const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.outputTokens, 100); assert.equal(snapshot.activeMs, 1000); assert.equal(snapshot.modelAttempts, 1);
 }
});
test('invalid trusted request and pre-aborted signal never create reservations or dispatch', async () => {
 const f = await fixture(), aborted = new AbortController(); aborted.abort(); let calls = 0;
 for (const patch of [{ kind: 'other' }, { maxOutputTokens: -1 }, { maxOutputTokens: 128001 }, { maxOutputTokens: NaN }, { timeoutMs: 0 }, { timeoutMs: 300001 },
  { timeoutMs: Infinity }, { ownerUserId: '' }, { kind: 'tool', maxOutputTokens: 1 }, { signal: aborted.signal }, { limits: { modelAttempts: 999 } }])
  await assert.rejects(service().runWithBudget(request(f.runId, patch) as any, async () => { calls++; return { value: true }; }), denied());
 assert.equal(calls, 0); assert.equal((await rows(f.runId)).length, 0);
});
test('foreign owner, inactive Run, malformed lineage and changed authority reject before dispatch', async () => {
 const f = await fixture(); let calls = 0; const callback = async () => { calls++; return { value: true }; };
 await assert.rejects(service().runWithBudget(request(f.runId, { ownerUserId: randomUUID() }), callback), denied());
 await updateRun(f.runId, { status: 'succeeded' }); await assert.rejects(service().runWithBudget(request(f.runId), callback), denied());
 await updateRun(f.runId, { status: 'queued', retryOfRunId: f.runId }); await assert.rejects(service().runWithBudget(request(f.runId), callback), denied());
 await updateRun(f.runId, { retryOfRunId: null });
 await database.update(schema.skillDefinitions).set({ emergencyStopped: true }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
 await assert.rejects(service().runWithBudget(request(f.runId), callback), denied()); assert.equal(calls, 0);
});
test('admission transaction failure rolls back counters and reservations before dispatch', async () => {
 const f = await fixture(); let calls = 0;
 const faulty = wrappedDatabase(tx => { const wrapper = Object.create(tx); wrapper.insert = (table: any) => {
  const builder = tx.insert(table); return { values(values: any) { if (values.eventType === 'business_budget_reservation') throw new Error('injected reservation failure'); return builder.values(values); } };
 }; return wrapper; });
 await assert.rejects(service({ database: faulty }).runWithBudget(request(f.runId), async () => { calls++; return { value: true }; }), denied());
 assert.equal(calls, 0); assert.equal((await rows(f.runId)).length, 0);
});
test('settlement failure leaves durable reservation charged and cannot dispatch it again', async () => {
 const f = await fixture(); let calls = 0;
 const faulty = wrappedDatabase((tx, n) => { if (n !== 2) return tx; const wrapper = Object.create(tx); wrapper.update = () => { throw new Error('injected settlement failure'); }; return wrapper; });
 await assert.rejects(service({ database: faulty }).runWithBudget(request(f.runId, { maxOutputTokens: 128000 }), async () => { calls++; return { value: 'external completed', outputTokens: 0 }; }), denied());
 assert.equal((await rows(f.runId)).filter(r => r.status === 'reserved').length, 1);
 await assert.rejects(service().runWithBudget(request(f.runId), async () => { calls++; return { value: 'duplicate' }; }), denied('EXECUTION_BUDGET_EXHAUSTED')); assert.equal(calls, 1);
 assert.equal((await service().readBudget(user.id, f.runId)).outputTokens, 128000);
});
test('legacy ledger, wrong bindings and poisoned counters never reset or grant budget', async () => {
 const f = await fixture(); await service().runWithBudget(request(f.runId), ok);
 const ledger = (await rows(f.runId)).find(r => r.effectKey === 'business-budget:v1')!;
 for (const patch of [{ input: {} }, { input: { ...(ledger.input as object), ownerUserId: randomUUID() } }, { output: { ...(ledger.output as object), modelAttempts: 0 } },
  { output: { ...(ledger.output as object), activeMs: -1 } }, { status: 'succeeded' }, { toolName: 'legacy' }, { output: { ...(ledger.output as object), extra: true } }]) {
  await database.update(schema.harnessToolEvents).set(patch).where(eq(schema.harnessToolEvents.harnessToolEventId, ledger.harnessToolEventId));
  await assert.rejects(service().runWithBudget(request(f.runId), ok), denied('EXECUTION_BUDGET_LEDGER_INVALID'));
  await database.update(schema.harnessToolEvents).set(ledger).where(eq(schema.harnessToolEvents.harnessToolEventId, ledger.harnessToolEventId));
 }
});
test('reservation corruption cannot be hidden by ledger totals', async () => {
 const f = await fixture(); await service().runWithBudget(request(f.runId), ok);
 const reserved = (await rows(f.runId)).find(r => r.eventType === 'business_budget_reservation')!;
 await database.update(schema.harnessToolEvents).set({ input: { ...(reserved.input as object), sourceRunId: randomUUID() } }).where(eq(schema.harnessToolEvents.harnessToolEventId, reserved.harnessToolEventId));
 await assert.rejects(service().readBudget(user.id, f.runId), denied('EXECUTION_BUDGET_LEDGER_INVALID'));
});
test('repeated settlement transaction callback does not refund or decrement twice', async () => {
 const f = await fixture(); let count = 0; const wrapped = Object.create(database);
 wrapped.transaction = (callback: any, settings: any) => database.transaction(async tx => {
  count++; const first = await callback(tx); if (count === 2) assert.deepEqual(await callback(tx), first); return first;
 }, settings);
 await service({ database: wrapped }).runWithBudget(request(f.runId), async () => ({ value: true, outputTokens: 7 }));
 const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.modelAttempts, 1); assert.equal(snapshot.outputTokens, 7);
 assert.equal((await rows(f.runId)).filter(r => r.eventType === 'business_budget_reservation').length, 1);
});

test('Workflow roots use the same durable budget without imposing a single-Skill scope', async () => {
 const f = await fixture(), saved = await queue.findRunForOwner(f.runId, user.id), config = saved!.executionConfig as any;
 const m = workflowManifest(d => { d.steps = d.steps.filter(s => s.type === 'userInput'); d.steps[0].inputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }]; d.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.steps.u.output.text' } }]; });
 m.target.id = randomUUID(); m.caller = { id: user.id, businessRole: 'pre_sales' }; const { manifestHash: _, ...base } = m; m.manifestHash = hash(base);
 await database.insert(schema.workflowDefinitions).values({ workflowId: m.target.id, name: 'Budget workflow', description: '', category: 'test', currentVersionId: m.target.versionId, enabled: true, archived: false, revision: 0, createdAt: new Date(), updatedAt: new Date() });
 const execution = { kind: 'workflow', workflowId: m.target.id, input: m.initialInput, sources: m.sources };
 await updateRun(f.runId, { executionConfig: { ...config, executionManifest: m, executionAuthority: [{ kind: 'workflow', id: m.target.id, epoch: 0 }] }, metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: config.content, execution }) } });
 await service().runWithBudget(request(f.runId, { maxOutputTokens: 128000 }), async () => ({ value: true, outputTokens: 128000 }));
 await updateRun(f.runId, { status: 'waiting' });
 await assert.rejects(service().runWithBudget(request(f.runId), ok), denied('EXECUTION_BUDGET_EXHAUSTED'));
 assert.equal((await service().readBudget(user.id, f.runId)).outputTokens, 128000);
});
test('explicitly unknown model usage is conservatively charged, and the next output cap is reduced', async () => {
 const f = await fixture();
 await service().runWithBudget(request(f.runId, { maxOutputTokens: 127999 }), async () => ({ value: true, outputTokens: undefined }));
 assert.equal((await service().readBudget(user.id, f.runId)).outputTokens, 127999);
 await service().runWithBudget(request(f.runId), async c => { assert.equal(c.maxOutputTokens, 1); return { value: true, outputTokens: 1 }; });
 await assert.rejects(service().runWithBudget(request(f.runId), ok), denied('EXECUTION_BUDGET_EXHAUSTED'));
});
test('non-JSON callback values cannot become successful evidence or release reservations', async () => {
 const cyclic: any = {}; cyclic.self = cyclic;
 for (const value of [new Date(), new Map([['private', 'value']]), cyclic, { n: Infinity }, JSON.parse('{"__proto__":1}'), undefined]) {
  const f = await fixture(); await assert.rejects(service().runWithBudget(request(f.runId), async () => ({ value, outputTokens: 0 })), denied());
  const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.outputTokens, 100); assert.equal(snapshot.activeMs, 1000);
 }
});
test('terminal owned Runs retain a read-only budget summary while new dispatch stays denied', async () => {
 const f = await fixture(); await service().runWithBudget(request(f.runId), async () => ({ value: true, outputTokens: 7 }));
 const active = await service().readBudget(user.id, f.runId); const before = await rows(f.runId); let calls = 0;
 for (const status of ['completed', 'failed', 'cancelled'] as const) {
  await updateRun(f.runId, { status });
  assert.deepEqual(await service().readBudget(user.id, f.runId), active);
  await assert.rejects(service().runWithBudget(request(f.runId), async () => { calls++; return { value: true }; }), denied('EXECUTION_RUN_NOT_ACTIVE'));
 }
 assert.equal(calls, 0); assert.deepEqual(await rows(f.runId), before);
 await assert.rejects(service().readBudget(randomUUID(), f.runId), denied());
});
test('reading a valid terminal Run without activity neither creates a ledger nor a dispatch allowance', async () => {
 const f = await fixture(); await updateRun(f.runId, { status: 'completed' });
 const snapshot = await service().readBudget(user.id, f.runId); assert.equal(snapshot.modelAttempts, 0); assert.equal(snapshot.activeMs, 0);
 assert.equal((await rows(f.runId)).length, 0); await assert.rejects(service().runWithBudget(request(f.runId), ok), denied('EXECUTION_RUN_NOT_ACTIVE'));
});
test('event-loop blocking callback cannot outrun the deadline timer and refund a timed-out reservation', async () => {
 for (const kind of ['model', 'tool'] as const) {
  const f = await fixture(); let observed: AbortSignal | undefined, calls = 0;
  await assert.rejects(service().runWithBudget(request(f.runId, { kind, timeoutMs: 20, maxOutputTokens: kind === 'model' ? 100 : 0 }), async context => {
   observed = context.signal; calls++;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
   return { value: 'late synchronous result', outputTokens: 0 };
  }), denied('EXECUTION_BUDGET_TIMEOUT'));
  assert.equal(calls, 1); assert.equal(observed?.aborted, true);
  const snapshot = await service().readBudget(user.id, f.runId);
  assert.equal(snapshot.outputTokens, kind === 'model' ? 100 : 0); assert.equal(snapshot.activeMs, 20);
  assert.equal(snapshot.modelAttempts, kind === 'model' ? 1 : 0); assert.equal(snapshot.toolCalls, kind === 'tool' ? 1 : 0);
  const reservation = (await rows(f.runId)).find(row => row.eventType === 'business_budget_reservation')!;
  assert.equal(reservation.status, 'failed'); assert.equal(reservation.errorMessage, 'EXECUTION_BUDGET_TIMEOUT');
 }
});
