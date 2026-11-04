import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { confirmHarnessAction } from '../harness/harness.usecase';
import { createHarnessRepository } from '../harness/harness.repository';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { manifest as workflowManifest } from '../harness/workflows.runtime.fixture';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillRetryService } from './skills.retry';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { createExecutionAuthority } from './execution-authority';
import { createSkillOperationService } from './skills.operations';
import { createSkillOperationDecisionService } from './skills.operation-decisions';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
const url = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: url, max: 1, application_name: 'wes-decisions-main', connectionTimeoutMillis: 1000 });
const control = new Pool({ connectionString: url, max: 3, application_name: 'wes-decisions-control' });
const database = drizzle(pool, { schema }), alternate = drizzle(control, { schema });
const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `operation-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const native = { name: 'operation_read', description: 'Fixture read', parameters: payload, mutates: false, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
const second = { ...native, name: 'operation_other' };
const definition: SkillDefinition = { name: 'Operation fixture', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'],
 inputSchema: payload, outputSchema: payload, tools: [native, second].map(t => ({ toolName: t.name, inputMapping: { text: '$.text' }, requiresConfirmation: true })),
 references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const inventory = async () => ({ registry: { get: (name: string) => [native, second].find(t => t.name === name) }, tools: [], policy: { schemaVersion: 1, policies: {} } }) as any;
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: d.tools.map(t => [native, second].find(n => n.name === t.toolName)), snapshot: {
 schemaVersion: 1, references: [], tools: d.tools.map(t => ({ native: [native, second].find(n => n.name === t.toolName), policy: DEFAULT_TOOL_POLICY_ENTRY })), roles: ['ADMIN'],
 model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'provider:fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
const service = (extra: any = {}) => createSkillOperationService({ database, inventory, ...extra });
const persisted = (id: string) => queue.findRunForOwner(id, user.id).then(r => r!);
const rows = (id: string) => database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, id)).orderBy(schema.harnessToolEvents.harnessToolEventId);
async function fixture(patch: Partial<SkillDefinition> = {}) {
 const roots = createSkillsPgRepository(database); let root = await roots.create({ ...structuredClone(definition), ...patch }, { id: user.id, username: user.username });
 root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Operation', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Frozen request', execution: { kind: 'skill', skillId: root.skillId, input: { text: 'original' } } });
 return { root, sessionId, run: await persisted(accepted.data.runId), body: { runId: accepted.data.runId, stepId: '$skill', ordinal: 0, toolName: native.name, parameters: { text: 'original' } } };
}
async function retry(f: Awaited<ReturnType<typeof fixture>>) {
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
 return createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { throw new Error('NO MODEL DISPATCH'); } }) }).retryInvocation(user, f.run.harnessRunId, { submissionKey: randomUUID(), reason: 'Explicit retry' });
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 assert.equal(Number((await pool.query('SELECT count(*) n FROM harness_runs WHERE owner_user_id=$1', [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM ai_sessions WHERE owner_user_id=$1', [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM users WHERE user_id=$1', [user.id])).rows[0].n), 0);
 await pool.end(); await control.end(); });
const decisions = (extra: any = {}) => createSkillOperationDecisionService({ database, inventory, ...extra });
const deny = (code?: string) => (e: any) => e.status >= 400 && (!code || e.code === code);
async function pending() { const f = await fixture(), op = await service().prepareOperation(user, f.body); return { ...f, op, request: { runId: f.run.harnessRunId, operationId: op.operationId } }; }
test('read is write-free; explicit approval persists across service reconstruction and cannot be overwritten', async () => {
 const f = await pending(), runBefore = await persisted(f.request.runId), eventsBefore = await rows(f.request.runId);
 const view = await decisions().readForConfirmation(user, f.request);
 assert.equal(view.status, 'pending'); assert.deepEqual(view.parameters, { text: 'original' });
 assert.deepEqual(await rows(f.request.runId), eventsBefore);
 const command = { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' };
 const first = await decisions().decideOperation(user, command);
 assert.equal(first.status, 'approved'); assert.ok(first.decisionId);
 assert.deepEqual(await decisions().decideOperation(user, command), first);
 assert.deepEqual(await decisions().readForConfirmation(user, f.request), first);
 await assert.rejects(decisions().decideOperation(user, { ...command, decision: 'reject' }), deny('OPERATION_DECISION_CONFLICT'));
 assert.equal((await rows(f.request.runId)).length, 2);
 assert.deepEqual(await persisted(f.request.runId), runBefore);
 assert.deepEqual((await rows(f.request.runId)).find(r => r.harnessToolEventId === f.op.operationId), eventsBefore.find(r => r.harnessToolEventId === f.op.operationId));
});
test('retry requires a new explicit decision and rejects the old confirmation hash', async () => {
 const f = await pending(), view = await decisions().readForConfirmation(user, f.request);
 const old = await decisions().decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' });
 const r = await retry(f), request = { ...f.request, runId: r.data.runId };
 const fresh = await decisions().readForConfirmation(user, request);
 assert.equal(fresh.status, 'pending'); assert.notEqual(fresh.confirmationHash, old.confirmationHash);
 await assert.rejects(decisions().decideOperation(user, { ...request, confirmationHash: old.confirmationHash, decision: 'approve' }), deny('OPERATION_CONFIRMATION_CHANGED'));
 assert.equal((await rows(f.request.runId)).length, 2); assert.equal((await rows(request.runId)).length, 0);
});
const updateRun = (id: string, patch: Partial<typeof schema.harnessRuns.$inferInsert>) => database.update(schema.harnessRuns).set(patch).where(eq(schema.harnessRuns.harnessRunId, id));
const updateUser = (patch: any) => database.update(schema.users).set(patch).where(eq(schema.users.userId, user.id));
const updateEvent = (id: string, patch: any) => database.update(schema.harnessToolEvents).set(patch).where(eq(schema.harnessToolEvents.harnessToolEventId, id));
async function approve(f: Awaited<ReturnType<typeof pending>>, extra: any = {}) {
 const view = await decisions(extra).readForConfirmation(user, f.request);
 return decisions(extra).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(work: Promise<T>): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('decision gate timeout')), 6000); })]); }
 finally { if (timer) clearTimeout(timer); }
}
async function blockedBy(pid: number) {
 for (let n = 0; n < 500; n++) {
  if ((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))", [pid])).rowCount) return;
  await new Promise(r => setTimeout(r, 10));
 }
 throw new Error(`expected actual SQL Lock waiter blocked by ${pid}`);
}
function gateInsert(rollback = false) {
 const entered = deferred(), release = deferred(), state = { pid: 0 }, gated = Object.create(database);
 gated.transaction = (callback: any, settings: any) => database.transaction(async tx => {
  const executor = Object.create(tx);
  executor.insert = (table: any) => {
   const statement = tx.insert(table), values = statement.values.bind(statement);
   statement.values = ((...args: any[]) => {
    const query = (values as any)(...args), conflict = query.onConflictDoNothing.bind(query);
    query.onConflictDoNothing = (...args: any[]) => {
     const insert = conflict(...args), returning = insert.returning.bind(insert);
     insert.returning = async () => {
      const rows = await returning(); state.pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      entered.resolve(); await bounded(release.promise); if (rollback) throw new Error('injected decision rollback'); return rows;
     };
     return insert;
    };
    return query;
   }) as any;
   return statement;
  };
  return callback(executor);
 }, settings);
 return { database: gated, entered, release, state };
}
test('strict commands normalize UUID/hash case, reject extra authority and JSON attacks, and return detached human content', async () => {
 const f = await pending(), view: any = await decisions().readForConfirmation(user, { runId: f.request.runId.toUpperCase(), operationId: f.request.operationId.toUpperCase() });
 assert.equal(view.runId, f.request.runId); assert.equal(view.operationId, f.request.operationId);
 assert.deepEqual(Object.keys(view).sort(), ['confirmationHash', 'operationId', 'parameters', 'payloadHash', 'rootRunId', 'runId', 'status', 'toolName']);
 view.parameters.text = 'local mutation'; assert.deepEqual((await decisions().readForConfirmation(user, f.request)).parameters, { text: 'original' });
 let cyclic: any = {}; cyclic.self = cyclic;
 const deep: any = {}; let level = deep; for (let i = 0; i < 34; i++) level = level.next = {};
 for (const bad of [null, [], {}, { ...f.request, approved: true }, { ...f.request, parameters: {} }, { ...f.request, owner: user.id },
  { ...f.request, manifest: {} }, { ...f.request, epoch: 0 }, { ...f.request, key: 'borrowed' }, { ...f.request, operationId: 'bad' },
  { ...f.request, runId: 'bad' }, { ...f.request, decision: 'approve' }, { ...f.request, extra: cyclic }, { ...f.request, extra: deep }])
  await assert.rejects(decisions().readForConfirmation(user, bad), deny('OPERATION_INVALID_REQUEST'));
 const command = { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' };
 for (const patch of [{ decision: true }, { decision: 'approved' }, { decision: 'Approve' }, { confirmationHash: 'bad' },
  { confirmationHash: 'g'.repeat(64) }, { confirmationHash: undefined }, { confirmationHash: Infinity }, { confirmationHash: cyclic },
  { confirmationHash: deep }, { confirmationHash: 'x'.repeat(1024 * 1024) }, { approved: true }, { parameters: {} }, { epoch: 0 }])
  await assert.rejects(decisions().decideOperation(user, { ...command, ...patch }), deny('OPERATION_INVALID_REQUEST'));
 await assert.rejects(decisions().decideOperation(user, { ...command, confirmationHash: hash('forged') }), deny('OPERATION_CONFIRMATION_CHANGED'));
 const saved = await decisions().decideOperation(user, { ...command, runId: f.request.runId.toUpperCase(), operationId: f.request.operationId.toUpperCase(), confirmationHash: view.confirmationHash.toUpperCase() });
 assert.equal(saved.status, 'approved'); assert.equal(saved.confirmationHash, view.confirmationHash);
 assert.deepEqual(Object.keys(decisions()).sort(), ['decideOperation', 'readForConfirmation']);
});
test('unknown and cross-root operations are 404 without creating pending or decision rows', async () => {
 const f = await pending(), other = await fixture(), before = await rows(f.request.runId);
 for (const request of [{ ...f.request, operationId: randomUUID() }, { runId: other.run.harnessRunId, operationId: f.op.operationId }]) {
  await assert.rejects(decisions().readForConfirmation(user, request), deny('OPERATION_NOT_FOUND'));
  await assert.rejects(decisions().decideOperation(user, { ...request, confirmationHash: hash('fake'), decision: 'approve' }), deny('OPERATION_NOT_FOUND'));
 }
 await assert.rejects(decisions().readForConfirmation({ ...user, id: randomUUID() }, f.request), deny('EXECUTION_RUN_NOT_FOUND'));
 assert.deepEqual(await rows(f.request.runId), before); assert.equal((await rows(other.run.harnessRunId)).length, 0);
});
test('rejected choice persists as its own strict envelope and same choice replays immutably', async () => {
 const f = await pending(), view = await decisions().readForConfirmation(user, f.request), command = { ...f.request, confirmationHash: view.confirmationHash, decision: 'reject' };
 const saved = await decisions().decideOperation(user, command), row = (await rows(f.request.runId)).find(r => r.harnessToolEventId === saved.decisionId)!;
 assert.equal(saved.status, 'rejected'); assert.equal(saved.decision, 'reject'); assert.equal(row.eventType, 'business_operation_decision');
 assert.equal(row.actionId, row.effectKey); assert.equal(row.harnessRunId, f.op.rootRunId); assert.equal(row.toolName, native.name);
 assert.equal(row.effectKey, `business-op-decision:v1:${hash({ operationId: f.op.operationId, runId: f.request.runId, confirmationHash: view.confirmationHash })}`);
 assert.equal(row.createdAt.getTime(), row.resolvedAt!.getTime()); assert.equal(row.output, null); assert.equal(row.errorMessage, null); assert.equal(row.riskLevel, null);
 assert.deepEqual(Object.keys(row.input as object).sort(), ['actorId', 'basis', 'confirmationHash', 'decision', 'schemaVersion']);
 const serialized = JSON.stringify((row.input as any).basis);
 for (const forbidden of ['credential', 'cipher', 'store', 'password', 'apiKey']) assert.ok(!serialized.includes(forbidden), forbidden);
 assert.deepEqual(await decisions().decideOperation(user, command), saved);
 await assert.rejects(decisions().decideOperation(user, { ...command, decision: 'approve' }), deny('OPERATION_DECISION_CONFLICT'));
 assert.deepEqual((await rows(f.request.runId)).find(r => r.harnessToolEventId === saved.decisionId), row);
});
test('all pending intent fields, JSON bounds, source provenance and legacy envelopes are revalidated read-only', async () => {
 const f = await pending(), original = (await rows(f.request.runId)).find(r => r.harnessToolEventId === f.op.operationId)!, input: any = original.input;
 const deep: any = {}; let level = deep; for (let i = 0; i < 34; i++) level = level.next = {};
 for (const patch of [{ eventType: 'confirmation' }, { status: 'confirmed' }, { status: 'approved' }, { actionId: null }, { effectKey: 'legacy' },
  { output: {} }, { errorMessage: 'failure' }, { riskLevel: 'low' }, { resolvedAt: new Date() }, { input: null }, { input: deep },
  { input: { ...input, extra: 'x'.repeat(1024 * 1024) } }, { input: { ...input, ...JSON.parse('{"constructor":1}') } },
  { input: { ...input, parameters: { text: 'altered' } } }, { input: { ...input, payloadHash: hash('fake') } },
  { input: { ...input, binding: { ...input.binding, requiresConfirmation: false } } }, { input: { ...input, native: { ...input.native, mutates: true } } },
  { input: { ...input, policy: { ...input.policy, enabled: false } } }, { input: { ...input, sourceRunId: randomUUID() } },
  { input: { ...input, sourceRunId: input.sourceRunId.toUpperCase() } }, { input: { ...input, schemaVersion: 2 } }, { input: { ...input, approved: true } }]) {
  // input is NOT NULL at the DB boundary; malformed JSON null is still representable using a SQL literal.
  await updateEvent(f.op.operationId, patch.input === null ? { input: sql`'null'::jsonb` } : patch);
  const corrupted = await rows(f.request.runId);
  await assert.rejects(decisions().readForConfirmation(user, f.request), deny());
  assert.deepEqual(await rows(f.request.runId), corrupted);
  await updateEvent(f.op.operationId, original);
 }
 const other = await fixture(); await updateEvent(f.op.operationId, { input: { ...input, sourceRunId: other.run.harnessRunId } });
 await assert.rejects(decisions().readForConfirmation(user, f.request), deny());
});
test('stored decisions require exact actor/basis/hash/choice/status/time/empty-output envelope; legacy cannot impersonate them', async () => {
 const f = await pending(), saved = await approve(f), original = (await rows(f.request.runId)).find(r => r.harnessToolEventId === saved.decisionId)!, input: any = original.input;
 const deep: any = {}; let level = deep; for (let i = 0; i < 34; i++) level = level.next = {};
 for (const patch of [{ eventType: 'confirmation' }, { status: 'confirmed' }, { status: 'pending' }, { actionId: 'legacy' }, { toolName: second.name },
  { output: { approved: true } }, { errorMessage: 'error' }, { riskLevel: 'low' }, { resolvedAt: null }, { resolvedAt: new Date(original.createdAt.getTime() + 1) },
  { input: {} }, { input: deep }, { input: { ...input, extra: 'x'.repeat(1024 * 1024) } },
  { input: { ...input, ...JSON.parse('{"prototype":1}') } }, { input: { ...input, actorId: randomUUID() } },
  { input: { ...input, confirmationHash: hash('forged') } }, { input: { ...input, basis: { ...input.basis, runId: randomUUID() } } },
  { input: { ...input, decision: 'reject' } }, { input: { ...input, approved: true } }, { input: { ...input, schemaVersion: 2 } }]) {
  await updateEvent(original.harnessToolEventId, patch); const corrupted = await rows(f.request.runId);
  await assert.rejects(decisions().readForConfirmation(user, f.request), deny('OPERATION_DECISION_INVALID'));
  await assert.rejects(decisions().decideOperation(user, { ...f.request, confirmationHash: saved.confirmationHash, decision: 'approve' }), deny('OPERATION_DECISION_INVALID'));
  assert.deepEqual(await rows(f.request.runId), corrupted); await updateEvent(original.harnessToolEventId, original);
 }
});
test('normal queued/running/waiting transitions retain hash and ordinary disable retains the current Run decision', async () => {
 const f = await pending(), saved = await approve(f);
 for (const status of ['running', 'waiting', 'recovering', 'queued'] as const) {
  await updateRun(f.request.runId, { status }); assert.deepEqual(await decisions().readForConfirmation(user, f.request), saved);
 }
 await database.update(schema.skillDefinitions).set({ enabled: false, archived: true }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
 assert.deepEqual(await decisions().readForConfirmation(user, f.request), saved);
});
test('terminal/owner/identity/session/epoch invalidation denies replay while retaining immutable historical decision', async () => {
 const f = await pending(), saved = await approve(f), before = await rows(f.request.runId);
 const replay = () => decisions().decideOperation(user, { ...f.request, confirmationHash: saved.confirmationHash, decision: 'approve' });
 for (const status of ['failed', 'completed', 'cancelled'] as const) {
  await updateRun(f.request.runId, { status }); await assert.rejects(replay(), deny('EXECUTION_RUN_NOT_ACTIVE'));
 }
 await updateRun(f.request.runId, { status: 'queued' });
 for (const patch of [{ status: 'disabled' }, { businessRole: 'delivery' }, { role: 'user' }]) {
  try { await updateUser(patch); await assert.rejects(replay(), deny()); }
  finally { await updateUser({ status: 'active', role: 'admin', businessRole: 'pre_sales' }); }
 }
 await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
 await assert.rejects(replay(), deny('EXECUTION_RUN_NOT_FOUND'));
 await database.update(schema.aiSessions).set({ status: 'temporary_chat' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
 const emergency = createExecutionEmergencyRepository(database), control = await emergency.read('skill', f.root.skillId, user);
 await emergency.change('skill', f.root.skillId, user, control.control.revision, 'Explicit stop', 'stop'); await assert.rejects(replay(), deny('EXECUTION_EMERGENCY_STOPPED'));
 await emergency.change('skill', f.root.skillId, user, control.control.revision + 1, 'Explicit release', 'release'); await assert.rejects(replay(), deny('EXECUTION_MANUAL_RETRY_REQUIRED'));
 const r = await retry(f), request = { ...f.request, runId: r.data.runId }, fresh = await decisions().readForConfirmation(user, request);
 assert.notEqual(fresh.confirmationHash, saved.confirmationHash); assert.equal(fresh.status, 'pending');
 await assert.rejects(decisions().decideOperation(user, { ...request, confirmationHash: saved.confirmationHash, decision: 'approve' }), deny('OPERATION_CONFIRMATION_CHANGED'));
 assert.deepEqual(await rows(f.request.runId), before);
});
async function revision(key: string, work: () => Promise<void>) {
 const old = (await control.query('SELECT version, updated_at::text updated, effective_at::text effective FROM system_configs WHERE config_key=$1', [key])).rows[0];
 if (!old) await database.insert(schema.systemConfigs).values({ configKey: key, store: {} });
 try { await work(); }
 finally {
  if (old) await control.query('UPDATE system_configs SET version=$2,updated_at=$3::timestamptz,effective_at=$4::timestamptz WHERE config_key=$1', [key, old.version, old.updated, old.effective]);
  else await database.delete(schema.systemConfigs).where(eq(schema.systemConfigs.configKey, key));
 }
}
test('effective policy and submillisecond config metadata changes invalidate the old hash; new explicit choice creates a separate history scope', async () => {
 const f = await pending(), original = await approve(f);
 const changedPolicy = async () => ({ ...await inventory(), policy: { schemaVersion: 1, policies: { [native.name]: { ...DEFAULT_TOOL_POLICY_ENTRY, approvalStrategy: 'user-confirm' } } } }) as any;
 const fresh = await decisions({ inventory: changedPolicy }).readForConfirmation(user, f.request);
 assert.equal(fresh.status, 'pending'); assert.notEqual(fresh.confirmationHash, original.confirmationHash);
 await assert.rejects(decisions({ inventory: changedPolicy }).decideOperation(user, { ...f.request, confirmationHash: original.confirmationHash, decision: 'approve' }), deny('OPERATION_CONFIRMATION_CHANGED'));
 assert.equal((await rows(f.request.runId)).length, 2);
 for (const key of ['toolPolicy', 'mcpConfig']) await revision(key, async () => {
  for (const column of ['updated_at', 'effective_at']) {
   await control.query(`UPDATE system_configs SET ${column}='2026-11-03T00:00:00.000001Z' WHERE config_key=$1`, [key]);
   const before = await decisions().readForConfirmation(user, f.request);
   await control.query(`UPDATE system_configs SET ${column}='2026-11-03T00:00:00.000002Z' WHERE config_key=$1`, [key]);
   const after = await decisions().readForConfirmation(user, f.request);
   assert.notEqual(after.confirmationHash, before.confirmationHash, `${key} ${column} preserves PG microseconds`);
   await assert.rejects(decisions().decideOperation(user, { ...f.request, confirmationHash: before.confirmationHash, decision: 'approve' }), deny('OPERATION_CONFIRMATION_CHANGED'));
   const result = await decisions().decideOperation(user, { ...f.request, confirmationHash: after.confirmationHash, decision: 'reject' });
   assert.equal(result.status, 'rejected'); assert.notEqual(result.decisionId, original.decisionId);
  }
 });
 assert.equal((await decisions().readForConfirmation(user, f.request)).decisionId, original.decisionId);
});
test('inventory contract/capability/role/source/policy/safety intersection cannot be replaced by a matching caller hash', async () => {
 const f = await pending(), view = await approve(f);
 for (const cause of ['missing', 'capability', 'schema', 'source', 'disabled', 'roles', 'safety', 'description', 'mutates']) {
  const tool: any = { ...native }, policy: any = { schemaVersion: 1, policies: {} };
  if (cause === 'capability') tool.capability = 'user:manage'; if (cause === 'schema') tool.parameters = {};
  if (cause === 'source') tool.source = 'mcp'; if (cause === 'safety') tool.sandboxReadSafe = false;
  if (cause === 'description') tool.description = 'new contract'; if (cause === 'mutates') tool.mutates = true;
  if (cause === 'disabled' || cause === 'roles') policy.policies[native.name] = { ...DEFAULT_TOOL_POLICY_ENTRY, ...(cause === 'disabled' ? { enabled: false } : { visibleRoles: ['DEV'] }) };
  const tools = async () => ({ ...await inventory(), registry: { get: (name: string) => name === second.name ? second : cause === 'missing' ? undefined : tool }, policy }) as any;
  await assert.rejects(decisions({ inventory: tools }).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' }), deny('EXECUTION_AUTHORITY_DENIED'));
 }
 assert.equal((await rows(f.request.runId)).length, 2);
});
test('same and opposing choices use independent connections and wait on actual unique-index INSERT locks', async () => {
 for (const choice of ['approve', 'reject']) {
  const f = await pending(), view = await decisions().readForConfirmation(user, f.request), gate = gateInsert();
  const command = { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' };
  const first = decisions({ database: gate.database }).decideOperation(user, command); void first.catch(() => {});
  let outcome: Promise<any> | undefined;
  try {
   await bounded(gate.entered.promise);
   outcome = decisions({ database: alternate }).decideOperation(user, { ...command, decision: choice }).then(value => ({ value }), error => ({ error }));
   await bounded(blockedBy(gate.state.pid));
  } finally { gate.release.resolve(); await Promise.allSettled([first, ...(outcome ? [outcome] : [])]); }
  const winner = await first, loser = await outcome;
  if (choice === 'approve') assert.deepEqual(loser.value, winner);
  else assert.equal(loser.error.code, 'OPERATION_DECISION_CONFLICT');
  assert.equal((await rows(f.request.runId)).filter(r => r.eventType === 'business_operation_decision').length, 1);
 }
});
test('exception after a real decision INSERT rolls back the row; a subsequent explicit choice succeeds', async () => {
 const f = await pending(), view = await decisions().readForConfirmation(user, f.request), gate = gateInsert(true);
 const outcome = decisions({ database: gate.database }).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' }).then(value => ({ value }), error => ({ error }));
 try { await bounded(gate.entered.promise); } finally { gate.release.resolve(); }
 assert.equal((await outcome as any).error.code, 'OPERATION_DECISION_UNAVAILABLE');
 assert.equal((await rows(f.request.runId)).length, 1); assert.equal((await decisions().readForConfirmation(user, f.request)).status, 'pending');
 assert.equal((await approve(f)).status, 'approved');
});
test('inventory queries work with max1; revoke/cancel/archive/delete/stop-release during I/O cannot create a half decision', async () => {
 for (const cause of ['user', 'role', 'business-role', 'cancel', 'archive', 'delete-session', 'stop-release', 'intent', 'binding']) {
  const f = await pending(), view = await decisions().readForConfirmation(user, f.request), entered = deferred(), release = deferred();
  const outcome = decisions({ inventory: async () => { await bounded(pool.query('SELECT 1')); entered.resolve(); await bounded(release.promise); return inventory(); } })
   .decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' }).then(value => ({ value }), error => ({ error }));
  try {
   await bounded(entered.promise); await bounded(pool.query('SELECT 1'));
   if (cause === 'user') await updateUser({ status: 'disabled' }); if (cause === 'role') await updateUser({ role: 'user' });
   if (cause === 'business-role') await updateUser({ businessRole: 'delivery' }); if (cause === 'cancel') await updateRun(f.request.runId, { status: 'cancelled' });
   if (cause === 'archive') await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
   if (cause === 'delete-session') await database.delete(schema.aiSessions).where(eq(schema.aiSessions.sessionId, f.sessionId));
   if (cause === 'intent') { const row = (await rows(f.request.runId)).find(r => r.harnessToolEventId === f.op.operationId)!; await updateEvent(f.op.operationId, { input: { ...(row.input as any), parameters: { text: 'changed during I/O' } } }); }
   if (cause === 'binding') await updateRun(f.request.runId, { executionConfig: { ...(f.run.executionConfig as any), executionAuthority: [] } });
   if (cause === 'stop-release') {
    const emergency = createExecutionEmergencyRepository(database), control = await emergency.read('skill', f.root.skillId, user);
    await emergency.change('skill', f.root.skillId, user, control.control.revision, 'Stop during I/O', 'stop');
    await emergency.change('skill', f.root.skillId, user, control.control.revision + 1, 'Release during I/O', 'release');
   }
  } finally { release.resolve(); await outcome; await updateUser({ status: 'active', role: 'admin', businessRole: 'pre_sales' }); }
  assert.ok((await outcome as any).error, cause);
  assert.equal((await rows(f.request.runId)).filter(r => r.eventType === 'business_operation_decision').length, 0, cause);
 }
});
test('metadata revisions changing during inventory or before final transaction are fenced, including microsecond-only changes', async () => {
 for (const phase of ['inventory', 'final']) await revision('toolPolicy', async () => {
  const f = await pending(), view = await decisions().readForConfirmation(user, f.request);
  const gated = Object.create(database); let transactions = 0;
  await control.query("UPDATE system_configs SET updated_at='2026-11-03T00:00:00.000001Z' WHERE config_key='toolPolicy'");
  const mutate = () => control.query("UPDATE system_configs SET updated_at='2026-11-03T00:00:00.000002Z' WHERE config_key='toolPolicy'");
  gated.transaction = async (callback: any, settings: any) => {
   if (++transactions === 4 && phase === 'final') await mutate();
   return database.transaction(callback, settings);
  };
  const tools = async () => { await bounded(pool.query('SELECT 1')); if (phase === 'inventory') await mutate(); return inventory(); };
  await assert.rejects(decisions({ database: gated, inventory: tools }).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' }), deny('OPERATION_CONFIRMATION_CHANGED'));
  assert.equal(transactions, 4); assert.equal((await rows(f.request.runId)).length, 1);
 });
});
test('approval leaves Run/checkpoints/output/events/models unchanged and write/exfiltration/MCP dispatch denied', async () => {
 for (const cause of ['write', 'exfiltrate', 'mcp']) {
  const f = await fixture(), config: any = structuredClone(f.run.executionConfig), m = config.executionManifest;
  const current: any = { ...native, ...(cause === 'write' ? { mutates: true } : cause === 'exfiltrate' ? { exfiltrates: true } : { source: 'mcp', simulationOnly: true }) };
  m.skills[0].context.tools[0].native = current; const { manifestHash: _, ...base } = m; m.manifestHash = hash(base);
  await updateRun(f.run.harnessRunId, { executionConfig: config });
  let dispatches = 0;
  const tools = async () => ({ ...await inventory(), registry: { get: (name: string) => name === second.name ? second : name === native.name ? { ...current, ...(cause === 'mcp' ? { mcpAllowedRoles: ['ADMIN'] } : {}) } : undefined,
   execute: async () => { dispatches++; throw new Error('NO TOOL DISPATCH'); } } });
  const op = await service({ inventory: tools }).prepareOperation(user, f.body), request = { runId: f.run.harnessRunId, operationId: op.operationId };
  await database.insert(schema.harnessRunCheckpoints).values({ harnessRunCheckpointId: randomUUID(), harnessRunId: f.run.harnessRunId, sequence: 1,
   checkpointKey: 'original', checkpointKind: 'structural', workflowId: f.run.workflowId!, workflowVersion: f.run.workflowVersion!, stepKey: 'original', resumePolicy: 'resume_next', state: { original: true }, stateHash: hash('original'), runtimeValidation: {} });
  await database.insert(schema.harnessRunOutputs).values({ harnessRunOutputId: randomUUID(), harnessRunId: f.run.harnessRunId, status: 'final', content: { original: true }, contentHash: hash('original') });
  const snapshot = await queue.getRunSnapshot(f.run.harnessRunId), run = await persisted(f.run.harnessRunId), events = await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 });
  const models = () => database.select().from(schema.harnessModelRuns).where(eq(schema.harnessModelRuns.harnessRunId, f.run.harnessRunId)), modelBefore = await models();
  const view = await decisions({ inventory: tools }).readForConfirmation(user, request);
  const saved = await decisions({ inventory: tools }).decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
  assert.equal(saved.status, 'approved');
  await assert.rejects(createExecutionAuthority(database, tools as any).check({ runId: f.run.harnessRunId, ownerUserId: user.id,
   manifestHash: m.manifestHash, stepId: '$skill', phase: 'tool', toolName: native.name }), deny('EXECUTION_AUTHORITY_DENIED'));
  if (cause === 'mcp') {
   const differentRole = async () => ({ ...await tools(), registry: { get: (name: string) => name === second.name ? second : { ...current, mcpAllowedRoles: ['ADMIN', 'DEV'] } } });
   assert.notEqual((await decisions({ inventory: differentRole }).readForConfirmation(user, request)).confirmationHash, saved.confirmationHash);
   const noManualAllow = async () => ({ ...await tools(), registry: { get: (name: string) => name === second.name ? second : { ...current, mcpAllowedRoles: [] } } });
   await assert.rejects(decisions({ inventory: noManualAllow }).readForConfirmation(user, request), deny('EXECUTION_AUTHORITY_DENIED'));
  }
  assert.deepEqual(await queue.getRunSnapshot(f.run.harnessRunId), snapshot); assert.deepEqual(await persisted(f.run.harnessRunId), run);
  assert.deepEqual(await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 }), events); assert.deepEqual(await models(), modelBefore);
  assert.equal(dispatches, 0); assert.equal((await rows(f.run.harnessRunId)).find(row => row.harnessToolEventId === op.operationId)!.status, 'pending');
 }
});
test('decision timestamps must match at PostgreSQL microsecond precision', async () => {
 const f = await pending(), saved = await approve(f);
 await control.query("UPDATE harness_tool_events SET resolved_at=created_at + interval '1 microsecond' WHERE harness_tool_event_id=$1", [saved.decisionId]);
 await assert.rejects(decisions().readForConfirmation(user, f.request), deny('OPERATION_DECISION_INVALID'));
});
test('legacy confirmation service hardcodes its own envelope and cannot forge a business operation decision', async () => {
 const f = await pending(), view = await decisions().readForConfirmation(user, f.request);
 const key = `business-op-decision:v1:${hash({ operationId: f.op.operationId, runId: f.request.runId, confirmationHash: view.confirmationHash })}`;
 const command: any = { confirmed: true, actionType: native.name, eventType: 'business_operation_decision', status: 'approved', effectKey: key,
  input: { approved: true, confirmationHash: view.confirmationHash }, decision: 'approve' };
 const legacy = await confirmHarnessAction(user, f.request.runId, key, command, createHarnessRepository(database));
 assert.ok(legacy); assert.equal(legacy.event.eventType, 'confirmation'); assert.equal(legacy.event.status, 'confirmed'); assert.equal(legacy.event.effectKey, null);
 assert.equal((await decisions().readForConfirmation(user, f.request)).status, 'pending');
 assert.equal((await rows(f.request.runId)).filter(row => row.eventType === 'business_operation_decision').length, 0);
 assert.equal((await approve(f)).status, 'approved');
});
test('no longer requiring confirmation and unsupported workflow roots cannot acquire decision authority', async () => {
 const f = await fixture({ tools: [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }] });
 const confirmed = async () => ({ ...await inventory(), policy: { schemaVersion: 1, policies: { [native.name]: { ...DEFAULT_TOOL_POLICY_ENTRY, approvalStrategy: 'user-confirm' } } } }) as any;
 const op = await service({ inventory: confirmed }).prepareOperation(user, f.body), request = { runId: f.run.harnessRunId, operationId: op.operationId };
 await assert.rejects(decisions().readForConfirmation(user, request), deny('OPERATION_CONFIRMATION_NOT_REQUIRED'));
 assert.equal((await decisions({ inventory: confirmed }).readForConfirmation(user, request)).status, 'pending');
 const config: any = structuredClone(f.run.executionConfig); config.executionManifest = workflowManifest();
 await updateRun(f.run.harnessRunId, { executionConfig: config });
 await assert.rejects(decisions().readForConfirmation(user, request), deny());
 assert.equal((await rows(f.run.harnessRunId)).length, 1);
});
test('retry ancestry remains strict even when a real prior decision exists at the root', async () => {
 const f = await pending(); await approve(f); const r = await retry(f), request = { ...f.request, runId: r.data.runId };
 for (const patch of [{ status: 'completed' }, { retryOfRunId: r.data.runId }, { ownerUserId: randomUUID() }, { aiSessionId: randomUUID() },
  { metadata: { invocationFingerprint: hash('bad') } }, { executionConfig: { ...(f.run.executionConfig as any), executionAuthority: [] } }]) {
  await updateRun(f.run.harnessRunId, patch as any); await assert.rejects(decisions().readForConfirmation(user, request), deny());
  await updateRun(f.run.harnessRunId, { ...f.run, status: 'failed' });
 }
 assert.equal((await decisions().readForConfirmation(user, request)).status, 'pending');
 assert.equal((await rows(f.run.harnessRunId)).length, 2); assert.equal((await rows(request.runId)).length, 0);
});
test('final revision snapshot is read after the config table fence, closing the same-version timestamp gap', async () => {
 await revision('toolPolicy', async () => {
  const f = await pending(); await control.query("UPDATE system_configs SET updated_at='2026-11-03T00:00:00.000001Z' WHERE config_key='toolPolicy'");
  const view = await decisions().readForConfirmation(user, f.request), gated = Object.create(database); let transactions = 0;
  gated.transaction = (callback: any, settings: any) => database.transaction(async tx => {
   const count = ++transactions, executor = Object.create(tx); let changed = false;
   executor.execute = async (query: any) => {
    if (count === 4 && !changed) { changed = true; await control.query("UPDATE system_configs SET updated_at='2026-11-03T00:00:00.000002Z' WHERE config_key='toolPolicy'"); }
    return tx.execute(query);
   };
   return callback(executor);
  }, settings);
  await assert.rejects(decisions({ database: gated }).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' }), deny('OPERATION_CONFIRMATION_CHANGED'));
  assert.equal((await rows(f.request.runId)).length, 1);
 });
});
