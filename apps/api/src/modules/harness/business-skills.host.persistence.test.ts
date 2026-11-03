import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from './harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry, HarnessFaultInjectedError } from './harness-runtime.worker';
import { createBusinessSkillsWorkflow } from './business-skills.workflow';
import { createBusinessSkillHost } from './business-skills.host';
import { createBusinessSkillOperationWaitService } from './business-skills.operation-wait';
import { readBusinessSkillsHostState } from './business-skills.host-state';
import { createExecutionManifestService } from '../skills/execution-manifest';
import { createSkillInvocationService } from '../skills/skills.invocation';
import { createInvocationPgRepository } from '../skills/skills.invocation-pg.repository';
import { createSkillsPgRepository } from '../skills/skills-pg.repository';
import { createExecutionAuthority } from '../skills/execution-authority';
import { createExecutionBudgetService } from '../skills/execution-budget';
import { skillToolContract } from '../skills/skills.context';
import { createSkillSandbox } from '../skills/skills.sandbox';
import { createSkillRetryService } from '../skills/skills.retry';
import { createSkillOperationExecutionService } from '../skills/skills.operation-execution';
import { createSkillLocalTransactionAdapters } from '../skills/skills.local-adapters';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { buildCreateProjectTool } from '../../agent/tools/mutation.tools';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from '../skills/skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 2000 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `host-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
let nativeCalls = 0;
const write = { ...buildCreateProjectTool(async () => { nativeCalls++; throw new Error('NATIVE WRITE MUST NOT RUN'); }), source: 'code' as const };
const read = { name: 'read_one', description: 'A safe local read', parameters: write.parameters, mutates: false, exfiltrates: false,
 source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const,
 async execute() { nativeCalls++; return { found: true }; } };
const tools = [write, read];
let currentTools = tools;
const inventory = async () => ({ registry: { get: (name: string) => currentTools.find(t => t.name === name) }, tools: currentTools,
 policy: { schemaVersion: 1, policies: {} } }) as any;
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: d.tools.map(t => tools.find(n => n.name === t.toolName)), snapshot: {
 schemaVersion: 1, references: [], tools: d.tools.map(t => { const n = tools.find(n => n.name === t.toolName)!; return { native: { ...skillToolContract(n), source: n.source ?? 'code', sandboxReadSafe: n.sandboxReadSafe === true, capability: n.capability }, policy: DEFAULT_TOOL_POLICY_ENTRY }; }), roles: ['ADMIN'],
 model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'provider:fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
const input = { projectName: 'Host project' };
const definition = (tool: typeof write | typeof read): SkillDefinition => ({ name: 'Host fixture', description: '', category: 'test', instructions: 'Frozen', roles: ['pre_sales'],
 inputSchema: write.parameters, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
 tools: [{ toolName: tool.name, inputMapping: { projectName: '$.projectName' }, requiresConfirmation: tool.mutates }], references: [], examples: [],
 model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } });
async function fixture(tool = write) {
 const roots = createSkillsPgRepository(database); let root = await roots.create(definition(tool), { id: user.id, username: user.username });
 root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Host', domain: 'business_evaluation',
 workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Host fixture', execution: { kind: 'skill', skillId: root.skillId, input } });
 return { runId: accepted.data.runId, root, sessionId, tool };
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: user.role, businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id)); await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
 await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id)); await pool.end(); await closeDb(); });
const service = () => createBusinessSkillOperationWaitService({ database, inventory });
const saved = async (runId: string) => (await queue.findRunForOwner(runId, user.id))!;
const cps = (runId: string) => queue.listCheckpointsForRun({ runId });
const records = () => database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
function hostOptions(f: Awaited<ReturnType<typeof fixture>>, counters: { models: number }, patch: any = {}) {
 return { database, inventory, prepareModel: async (_skill: any, _signal: AbortSignal, ports: any) => ({ transportProvider: 'kimi', async complete(request: any) {
   await ports.beforeDispatch(); counters.models++; assert.equal(request.signal.aborted, false); assert.ok(request.model.maxTokens <= 100); assert.ok(request.model.timeoutMs <= 1000);
   return { provider: 'kimi', model: 'fixed', usage: { outputTokens: 2 }, ...(request.toolResults.length ? { output: { ok: true } }
    : { toolCalls: [{ id: 'call1', name: f.tool.name, arguments: input }] }) };
 } }), ...patch };
}
async function worker(options: any, extra: any = {}) {
 const executor = createBusinessSkillHost(options);
 const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor, createAuthority: () => createExecutionAuthority(database, inventory) })]);
 await createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID(), ...extra }).runNextAttempt();
}
const answer = (runId: string, view: any, decision: 'approve' | 'reject') => ({ runId, actionId: view.actionId, confirmationHash: view.confirmationHash, decision });
test('real Worker checkpoints model batch then pending intent, pauses and a fresh host resumes an approved real project write', async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length, beforeNative = nativeCalls;
 await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'waiting'); assert.equal(counter.models, 1); assert.equal(nativeCalls, beforeNative);
 const checkpoints = await cps(f.runId); assert.equal(checkpoints.length, 2);
 const states = checkpoints.map(cp => (cp.state as any).businessSkills.state);
 assert.equal(states[1].skill.phase, 'tools'); assert.equal(states[1].pendingOperation, undefined); assert.ok(states[0].pendingOperation);
 assert.equal((await records()).length, count);
 const view = await service().read(user, f.runId); assert.equal(view.kind, 'operation'); assert.deepEqual(view.parameters, input); assert.equal(view.status, 'pending');
 await service().answer(user, answer(f.runId, view, 'approve')); assert.equal((await saved(f.runId)).status, 'queued');
 await service().answer(user, answer(f.runId, view, 'approve')); // Same explicit request retries queueing safely.
 await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(counter.models, 2); assert.equal(nativeCalls, beforeNative);
 assert.equal((await records()).length, count + 1); const final = (await cps(f.runId))[0].state as any;
 assert.equal(final.businessSkills.state.skill.toolResults[0].simulated, false);
 const budget = await createExecutionBudgetService({ database }).readBudget(user.id, f.runId); assert.equal(budget.modelAttempts, 2); assert.equal(budget.toolCalls, 1);
});
test('rejection, wrong user and natural-language answers never execute writes', async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length; await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId);
 await assert.rejects(service().answer({ ...user, id: randomUUID() }, answer(f.runId, view, 'approve')));
 await assert.rejects(service().answer(user, { ...answer(f.runId, view, 'approve'), decision: '好的' } as any));
 assert.equal((await saved(f.runId)).status, 'waiting'); await service().answer(user, answer(f.runId, view, 'reject'));
 await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'failed'); assert.equal(counter.models, 1); assert.equal((await records()).length, count);
});
test('safe native reads run inside durable tool budget after the model checkpoint', async () => {
 const f = await fixture(read as any), counter = { models: 0 }, calls = nativeCalls;
 await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(nativeCalls, calls + 1); assert.equal(counter.models, 2);
 const checkpoints = await cps(f.runId); assert.equal(checkpoints.length, 3);
 assert.equal((checkpoints[2].state as any).businessSkills.state.skill.toolResults.length, 0);
 const budget = await createExecutionBudgetService({ database }).readBudget(user.id, f.runId); assert.equal(budget.toolCalls, 1);
});
test('current tool removal and emergency epoch block a resumed approved operation', async () => {
 for (const control of ['tool', 'epoch']) {
  const f = await fixture(), counter = { models: 0 }, count = (await records()).length; await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId);
  await service().answer(user, answer(f.runId, view, 'approve'));
  if (control === 'tool') currentTools = []; else await database.update(schema.skillDefinitions).set({ emergencyEpoch: 1 }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
  try { await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'failed'); assert.equal(counter.models, 1); assert.equal((await records()).length, count); }
  finally { currentTools = tools; }
 }
});
test('approved decision committed before queue failure can be retried with the same explicit request', async () => {
 const f = await fixture(), counter = { models: 0 }; await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId);
 const wrapped = Object.create(database); let fail = true;
 wrapped.transaction = (callback: any) => database.transaction(tx => callback(new Proxy(tx, { get(target, key) {
   if (key === 'update') return (table: any) => { if (fail && table === schema.harnessRuns) { fail = false; throw new Error('CRASH BEFORE RESUME'); } return target.update(table); };
   const value = (target as any)[key]; return typeof value === 'function' ? value.bind(target) : value;
 } })));
 const request = answer(f.runId, view, 'approve'); await assert.rejects(createBusinessSkillOperationWaitService({ database: wrapped, inventory }).answer(user, request));
 assert.equal((await saved(f.runId)).status, 'waiting'); assert.equal((await service().read(user, f.runId)).status, 'approved');
 await service().answer(user, request); await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'completed');
});
test('receipt committed before checkpoint failure is consumed by a new host without a repeated model call or business write', async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length; await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId);
 await service().answer(user, answer(f.runId, view, 'approve'));
 const wrapped = Object.create(queue); wrapped.commitCheckpoint = async (input: any) => {
  if (input.state.businessSkills.state.skill.toolResults.length === 1) throw new HarnessFaultInjectedError('AFTER RECEIPT BEFORE CHECKPOINT');
  return queue.commitCheckpoint(input);
 };
 await worker(hostOptions(f, counter), { repository: wrapped }); assert.equal(counter.models, 1); assert.equal((await records()).length, count + 1);
 // Simulate lease recovery after process death, preserving the real persisted checkpoint.
 await database.update(schema.harnessRunAttempts).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(schema.harnessRunAttempts.harnessRunId, f.runId));
 await database.update(schema.harnessRuns).set({ status: 'queued' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(counter.models, 2); assert.equal((await records()).length, count + 1);
});
test('host state rejects unknown schema, manifest, execution root, kind and forged pending cursor', async () => {
 const f = await fixture(), counter = { models: 0 }; await worker(hostOptions(f, counter)); const run = await saved(f.runId), manifest = (run.executionConfig as any).executionManifest;
 const state = ((await cps(f.runId))[0].state as any).businessSkills.state;
 assert.deepEqual(readBusinessSkillsHostState(state, manifest, f.runId), state);
 for (const bad of [{ schemaVersion: 1, kind: 'skill' }, { ...state, schemaVersion: 2 }, { ...state, kind: 'workflow' }, { ...state, unknown: 1 }, { ...state, skill: { ...state.skill, manifestHash: hash('other') } },
  { ...state, pendingOperation: { operationId: 'invented' } }, { ...state, skill: { ...state.skill, runId: randomUUID() } }]) assert.throws(() => readBusinessSkillsHostState(bad, manifest, f.runId));
});

test('budget reservations clip every model request before the frozen provider dispatch', async () => {
 const f = await fixture(read as any), counter = { models: 0 }, seen: number[] = [];
 await createExecutionBudgetService({ database }).runWithBudget({ runId: f.runId, ownerUserId: user.id, kind: 'model', maxOutputTokens: 128000, timeoutMs: 1000 }, async () => ({ value: {}, outputTokens: 127950 }));
 const base = hostOptions(f, counter), original = base.prepareModel;
 await worker({ ...base, prepareModel: async (...args: any[]) => { const prepared = await original(args[0], args[1], args[2]); return { ...prepared, async complete(request: any) { seen.push(request.model.maxTokens); return prepared.complete(request); } }; } });
 assert.equal((await saved(f.runId)).status, 'completed'); assert.deepEqual(seen, [50, 48]);
 assert.equal((await createExecutionBudgetService({ database }).readBudget(user.id, f.runId)).outputTokens, 127954);
});
test('pause cannot create a wait without a durable pending checkpoint or the current lease', async () => {
 const f = await fixture(), counter = { models: 0 };
 const attempt = await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 60000 }); assert.ok(attempt);
 await assert.rejects(service().pause({ runId: f.runId, attemptId: attempt.attempt.harnessRunAttemptId }));
 assert.equal((await saved(f.runId)).status, 'running');
 await database.update(schema.harnessRunAttempts).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(schema.harnessRunAttempts.harnessRunId, f.runId));
 await database.update(schema.harnessRuns).set({ status: 'queued' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await worker(hostOptions(f, counter)); assert.equal((await saved(f.runId)).status, 'waiting');
 await assert.rejects(service().pause({ runId: f.runId, attemptId: randomUUID() }));
});

test('real create_project production metadata permits explicit local adapter execution while trial writes stay simulated', async () => {
 const tool = buildCreateProjectTool(async () => { assert.fail('Native write must never execute'); });
 const contract = skillToolContract(tool);
 assert.equal(tool.sandboxReadSafe === true, false); assert.equal(contract.simulationOnly, false);
 let reads = 0; const sandbox = createSkillSandbox(definition(tool as any), [contract], async () => { reads++; assert.fail('Trial write cannot use read dispatch'); });
 const result = await sandbox.runTool({ id: 'trial', name: tool.name, arguments: input }, input, new AbortController().signal);
 assert.equal(result.simulated, true); assert.deepEqual(result.result, { dryRun: true, executed: false, reason: 'mutation_isolated' }); assert.equal(reads, 0);
 assert.equal(skillToolContract({ ...tool, name: 'other_unsafe', simulationOnly: undefined } as any).simulationOnly, true);
 assert.equal(skillToolContract({ ...tool, source: 'mcp', simulationOnly: false } as any).simulationOnly, true);
});

test('explicit failed-run retry keeps logical cursor and operation identity and needs current-run approval before receipt reuse', async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length;
 await worker(hostOptions(f, counter)); const firstView = await service().read(user, f.runId);
 await service().answer(user, answer(f.runId, firstView, 'approve')); await worker(hostOptions(f, counter));
 const original = ((await cps(f.runId))[0].state as any).businessSkills.state.skill;
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await database.update(schema.skillDefinitions).set({ emergencyEpoch: 1 }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
 const retried = await createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'kimi', async complete() { assert.fail('Retry preparation cannot dispatch'); } }) })
  .retryInvocation(user, f.runId, { submissionKey: randomUUID(), reason: 'Explicit receipt recovery' });
 const retryId = retried.data.runId; await worker(hostOptions(f, counter)); assert.equal((await saved(retryId)).status, 'waiting');
 const state = ((await cps(retryId))[0].state as any).businessSkills.state.skill, view = await service().read(user, retryId);
 assert.equal(state.runId, f.runId); assert.equal(state.operationId, original.operationId); assert.equal(view.operationId, firstView.operationId);
 assert.equal(view.status, 'pending'); assert.notEqual(view.confirmationHash, firstView.confirmationHash);
 assert.equal(((await saved(retryId)).executionConfig as any).executionAuthority[0].epoch, 1);
 assert.equal(((await saved(f.runId)).executionConfig as any).executionAuthority[0].epoch, 0);
 await assert.rejects(service().answer(user, { ...answer(retryId, view, 'approve'), confirmationHash: firstView.confirmationHash }));
 assert.equal((await saved(retryId)).status, 'waiting'); assert.equal((await records()).length, count + 1);
 await service().answer(user, answer(retryId, view, 'approve')); await worker(hostOptions(f, counter));
 assert.equal((await saved(retryId)).status, 'completed'); assert.equal((await records()).length, count + 1);
});

test('real model authority rechecks DB identity at the actual dispatch boundary after budget reservation', async () => {
 const f = await fixture(), counter = { models: 0 }, base = hostOptions(f, counter), original = base.prepareModel;
 try {
  await worker({ ...base, prepareModel: async (...args: any[]) => {
   await database.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, user.id));
   return original(args[0], args[1], args[2]);
  } });
  assert.equal((await saved(f.runId)).status, 'failed'); assert.equal(counter.models, 0);
  assert.equal((await createExecutionBudgetService({ database }).readBudget(user.id, f.runId)).modelAttempts, 1);
 } finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, user.id)); }
});

test('owner advisory lock held beyond tool budget cannot produce a late project or success receipt', { timeout: 12000 }, async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length;
 await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId);
 await service().answer(user, answer(f.runId, view, 'approve'));
 const control = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 });
 const blocker = await control.connect(), lock = `project-evaluation-code:${user.id}`;
 const pid = Number((await pool.query('SELECT pg_backend_pid() pid')).rows[0].pid);
 let running: Promise<void> | undefined;
 try {
  await blocker.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
  running = worker(hostOptions(f, counter));
  // Observe the real consumer statement blocked on the real owner allocation lock.
  let observed = false;
  for (let n = 0; n < 100; n++) {
   observed = (await blocker.query("SELECT wait_event='advisory' blocked FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.blocked === true;
   if (observed) break;
   await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(observed, true, 'consumer must reach the real advisory lock');
  await new Promise(resolve => setTimeout(resolve, 1150)); // Frozen tool budget is 1000 ms.
 } finally {
  await blocker.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
  blocker.release(); await control.end(); if (running) await running;
 }
 assert.equal((await saved(f.runId)).status, 'failed'); assert.equal(counter.models, 1);
 assert.equal((await records()).length, count, 'budget expiry must roll back the late business write');
 const events = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
 assert.equal(events.filter(e => e.eventType === 'business_operation_executed' && e.status === 'succeeded').length, 0);
 assert.equal(events.filter(e => e.eventType === 'business_operation_executed').length, 0, 'the execution receipt transaction must roll back too');
});

test('expired consumer inventory cannot reopen transactions or write after the parent budget has returned', { timeout: 6000 }, async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length;
 await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId);
 await service().answer(user, answer(f.runId, view, 'approve'));
 let entered!: () => void, release!: () => void;
 const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 const consumer = createSkillOperationExecutionService({ database, adapters: createSkillLocalTransactionAdapters(), inventory: async () => { entered(); await gate; return inventory(); } });
 let late: Promise<any> | undefined;
 try {
  const result = createExecutionBudgetService({ database }).runWithBudget({ runId: f.runId, ownerUserId: user.id, kind: 'tool', timeoutMs: 1000 }, async limits => {
   const task = consumer.executeOperation(user, { runId: f.runId, operationId: view.operationId, confirmationHash: view.confirmationHash },
    { signal: limits.signal, timeoutMs: limits.timeoutMs, deadline: limits.deadline });
   late = task.then(value => ({ value }), error => ({ error })); return { value: await task };
  }).then(value => ({ value }), error => ({ error }));
  await Promise.race([reached, result.then(() => { throw new Error('consumer inventory was not reached before budget outcome'); })]); const outcome: any = await result; assert.equal(outcome.error.code, 'EXECUTION_BUDGET_TIMEOUT');
  assert.equal((await saved(f.runId)).status, 'queued', 'consumer must enforce deadline independently of a Worker status change');
  release(); const finished = await late!; assert.ok(finished.error); assert.equal((await records()).length, count);
  const rows = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
  assert.equal(rows.filter(row => row.eventType === 'business_operation_executed').length, 0);
 } finally { release(); if (late) await late; await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId)); }
});
test('abort after the real adapter insert rolls back project and receipt through the controlled Drizzle chain', async () => {
 const f = await fixture(), counter = { models: 0 }, count = (await records()).length;
 await worker(hostOptions(f, counter)); const view = await service().read(user, f.runId); await service().answer(user, answer(f.runId, view, 'approve'));
 const controller = new AbortController(), adapter = createSkillLocalTransactionAdapters().get('create_project')!;
 let inserted = false;
 const consumer = createSkillOperationExecutionService({ database, inventory, adapters: new Map([['create_project', { kind: 'local-transaction' as const, async execute(tx: Parameters<typeof adapter.execute>[0], input: Parameters<typeof adapter.execute>[1]) {
  const project = await adapter.execute(tx, input); inserted = true; controller.abort(); return project;
 } }]]) });
 try {
  await assert.rejects(consumer.executeOperation(user, { runId: f.runId, operationId: view.operationId, confirmationHash: view.confirmationHash },
   { signal: controller.signal, timeoutMs: 1000, deadline: performance.now() + 1000 }), (error: any) => error.code === 'EXECUTION_BUDGET_ABORTED');
  assert.equal(inserted, true); assert.equal((await records()).length, count);
  const rows = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
  assert.equal(rows.filter(row => row.eventType === 'business_operation_executed').length, 0);
 } finally { await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId)); }
});
