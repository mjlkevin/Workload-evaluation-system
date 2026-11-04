import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
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
import { createExecutionEmergencyRepository } from './execution-emergency';
import { createExecutionAuthority } from './execution-authority';
import { createSkillOperationService } from './skills.operations';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
const url = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: url, max: 1, application_name: 'wes-operations-main', connectionTimeoutMillis: 1000 });
const control = new Pool({ connectionString: url, max: 3, application_name: 'wes-operations-control' });
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
const rows = (id: string) => database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, id));
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
test('repeat and reconstructed service return one durable pending intent without changing Run facts', async () => {
 const f = await fixture(), before = structuredClone(f.run), first = await service().prepareOperation(user, f.body);
 assert.deepEqual(await service().prepareOperation(user, f.body), first);
 assert.equal((await rows(f.run.harnessRunId)).length, 1);
 assert.deepEqual(await persisted(f.run.harnessRunId), before);
});
test('explicit retry uses the original logical slot and never adds an intent to the retry Run', async () => {
 const f = await fixture(), first = await service().prepareOperation(user, f.body), r = await retry(f);
 assert.deepEqual(await service().prepareOperation(user, { ...f.body, runId: r.data.runId }), first);
 assert.equal((await rows(f.run.harnessRunId)).length, 1); assert.equal((await rows(r.data.runId)).length, 0);
});
const deny = (code?: string) => (e: any) => e.status >= 400 && (!code || e.code === code);
const updateRun = (id: string, patch: Partial<typeof schema.harnessRuns.$inferInsert>) => database.update(schema.harnessRuns).set(patch).where(eq(schema.harnessRuns.harnessRunId, id));
const updateUser = (patch: any) => database.update(schema.users).set(patch).where(eq(schema.users.userId, user.id));
const emergency = createExecutionEmergencyRepository(database);
async function stopRelease(id: string) {
 const before = await emergency.read('skill', id, user);
 await emergency.change('skill', id, user, before.control.revision, 'Test stop', 'stop');
 await emergency.change('skill', id, user, before.control.revision + 1, 'Test release', 'release');
}
test('strict server command rejects extra grants, bad UUID/slot/JSON and native or mapped parameter changes', async () => {
 const f = await fixture(); let cyclic: any = {}; cyclic.self = cyclic;
 const tooDeep: any = {}; let level = tooDeep; for (let i = 0; i < 34; i++) level = level.next = {};
 for (const patch of [{ runId: 'bad' }, { ordinal: -1 }, { ordinal: 60 }, { ordinal: 0.1 }, { ordinal: '0' }, { stepId: '' }, { toolName: 'x'.repeat(161) },
  { operationKey: 'borrowed' }, { approved: true }, { manifest: {} }, { callId: 'model-call' }, { parameters: cyclic }, { parameters: tooDeep },
  { parameters: { text: 'x'.repeat(1024 * 1024) } }, { parameters: { text: undefined } }, { parameters: { text: Infinity } }, { parameters: JSON.parse('{"constructor":1}') }])
  await assert.rejects(service().prepareOperation(user, { ...f.body, ...patch }), deny('OPERATION_INVALID_REQUEST'));
 for (const body of [null, [], {}, { runId: f.body.runId }]) await assert.rejects(service().prepareOperation(user, body), deny('OPERATION_INVALID_REQUEST'));
 await assert.rejects(service().prepareOperation(user, { ...f.body, parameters: { text: 1 } }), deny('OPERATION_PARAMETERS_INVALID'));
 await assert.rejects(service().prepareOperation(user, { ...f.body, parameters: { text: 'changed' } }), deny('OPERATION_PARAMETERS_MISMATCH'));
 await assert.rejects(service().prepareOperation(user, { ...f.body, stepId: 'other' }), deny('OPERATION_SCOPE_INVALID'));
 await assert.rejects(service().prepareOperation(user, { ...f.body, toolName: 'unknown' }), deny('OPERATION_TOOL_DENIED'));
 assert.equal((await rows(f.run.harnessRunId)).length, 0);
});
test('slot identity excludes tool/content, separates ordinals, normalizes UUID and preserves pending-only envelope', async () => {
 const f = await fixture(), op = await service().prepareOperation(user, { ...f.body, runId: f.body.runId.toUpperCase() });
 assert.deepEqual(await service().prepareOperation(user, f.body), op);
 await assert.rejects(service().prepareOperation(user, { ...f.body, toolName: second.name }), deny('OPERATION_INTENT_CONFLICT'));
 const other = await service().prepareOperation(user, { ...f.body, ordinal: 59 }); assert.notEqual(other.operationKey, op.operationKey);
 const row = (await rows(f.run.harnessRunId)).find(row => row.harnessToolEventId === op.operationId);
 assert.ok(row, 'the original ordinal-zero operation must exist'); const input = row.input as any; assert.equal(input.ordinal, 0);
 assert.equal(row.eventType, 'business_operation_prepared'); assert.equal(row.status, 'pending'); assert.equal(row.effectKey, op.operationKey);
 assert.equal(row.actionId, op.operationKey); assert.equal(row.toolName, native.name);
 assert.equal(row.output, null); assert.equal(row.errorMessage, null); assert.equal(row.resolvedAt, null); assert.equal(row.riskLevel, null);
 assert.equal(input.sourceRunId, f.run.harnessRunId); assert.equal(input.payloadHash, op.payloadHash);
 assert.equal(op.operationKey, `business-op:v1:${hash({ schemaVersion: 1, rootRunId: f.run.harnessRunId, stepId: '$skill', ordinal: 0 })}`);
 op.payloadHash = 'client tampered'; input.parameters.text = 'local read tampered';
 assert.notEqual((await service().prepareOperation(user, f.body)).payloadHash, op.payloadHash);
 const unchanged = (await rows(f.run.harnessRunId)).find(row => row.harnessToolEventId === op.operationId);
 assert.ok(unchanged, 'the same ordinal-zero operation must remain'); assert.equal((unchanged.input as any).ordinal, 0);
 assert.equal((unchanged.input as any).parameters.text, 'original');
 assert.deepEqual(Object.keys(service()).sort(), ['prepareOperation']);
});
test('existing pending rows are fully checked, including legacy/status/output/body/hash/source corruption', async () => {
 const f = await fixture(), op = await service().prepareOperation(user, f.body), [original] = await rows(f.run.harnessRunId);
 const input: any = original.input;
 for (const patch of [{ eventType: 'tool_effect' }, { status: 'approved' }, { status: 'succeeded' }, { toolName: second.name }, { actionId: 'legacy' },
  { output: {} }, { errorMessage: 'error' }, { resolvedAt: new Date() }, { riskLevel: 'low' }, { input: {} },
  { input: { ...input, parameters: { text: 'tampered' } } }, { input: { ...input, binding: { ...input.binding, requiresConfirmation: false } } },
  { input: { ...input, native: { ...input.native, mutates: true } } }, { input: { ...input, policy: { ...input.policy, enabled: false } } },
  { input: { ...input, payloadHash: hash('fake') } }, { input: { ...input, approved: true } }, { input: { ...input, schemaVersion: 2 } },
  { input: { ...input, sourceRunId: randomUUID() } }, { input: { ...input, sourceRunId: input.sourceRunId.toUpperCase() } }]) {
  await database.update(schema.harnessToolEvents).set(patch).where(eq(schema.harnessToolEvents.harnessToolEventId, op.operationId));
  await assert.rejects(service().prepareOperation(user, f.body), deny());
  assert.equal((await rows(f.run.harnessRunId)).length, 1);
  await database.update(schema.harnessToolEvents).set(original).where(eq(schema.harnessToolEvents.harnessToolEventId, op.operationId));
 }
 const other = await fixture();
 await database.update(schema.harnessToolEvents).set({ input: { ...input, sourceRunId: other.run.harnessRunId } }).where(eq(schema.harnessToolEvents.harnessToolEventId, op.operationId));
 await assert.rejects(service().prepareOperation(user, f.body), deny());
});
test('legacy collision cannot become pending authority or be overwritten', async () => {
 const f = await fixture(), key = `business-op:v1:${hash({ schemaVersion: 1, rootRunId: f.run.harnessRunId, stepId: '$skill', ordinal: 0 })}`;
 const event = { harnessToolEventId: randomUUID(), harnessRunId: f.run.harnessRunId, effectKey: key, toolName: native.name, eventType: 'tool_effect', status: 'succeeded', input: {} };
 await database.insert(schema.harnessToolEvents).values(event);
 const before = await rows(f.run.harnessRunId);
 await assert.rejects(service().prepareOperation(user, f.body), deny('OPERATION_INTENT_CONFLICT'));
 assert.deepEqual(await rows(f.run.harnessRunId), before);
});
test('ordinary disable preserves existing Run semantics; ordinary no-confirm read does not need pending intent', async () => {
 const f = await fixture(); await database.update(schema.skillDefinitions).set({ enabled: false, archived: true }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
 assert.equal((await service().prepareOperation(user, f.body)).status, 'pending');
 const read = await fixture({ tools: [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }] });
 await assert.rejects(service().prepareOperation(user, read.body), deny('OPERATION_CONFIRMATION_NOT_REQUIRED'));
 assert.equal((await rows(read.run.harnessRunId)).length, 0);
 const currentConfirm = async () => ({ ...await inventory(), policy: { schemaVersion: 1, policies: { [native.name]: { ...DEFAULT_TOOL_POLICY_ENTRY, approvalStrategy: 'user-confirm' } } } }) as any;
 assert.equal((await service({ inventory: currentConfirm }).prepareOperation(user, read.body)).status, 'pending');
});
test('every replay intersects original role, policy, capability and native contract with current inventory', async () => {
 const f = await fixture(); await service().prepareOperation(user, f.body);
 for (const cause of ['missing', 'capability', 'schema', 'source', 'disabled', 'roles', 'safety', 'description', 'mutates']) {
  const current: any = { ...native }, policy: any = { schemaVersion: 1, policies: {} };
  if (cause === 'capability') current.capability = 'user:manage'; if (cause === 'schema') current.parameters = {};
  if (cause === 'source') current.source = 'mcp'; if (cause === 'safety') current.sandboxReadSafe = false;
  if (cause === 'description') current.description = 'changed'; if (cause === 'mutates') current.mutates = true;
  if (cause === 'disabled' || cause === 'roles') policy.policies[native.name] = { ...DEFAULT_TOOL_POLICY_ENTRY, ...(cause === 'disabled' ? { enabled: false } : { visibleRoles: ['DEV'] }) };
  const changed = async () => ({ registry: { get: (name: string) => name === second.name ? second : cause === 'missing' ? undefined : current }, tools: [], policy }) as any;
  await assert.rejects(service({ inventory: changed }).prepareOperation(user, f.body), deny('EXECUTION_AUTHORITY_DENIED'));
 }
 assert.equal((await rows(f.run.harnessRunId)).length, 1);
});
test('owned active Run, live Session/user/role and exact epoch are mandatory even on replay', async () => {
 const f = await fixture(); await service().prepareOperation(user, f.body);
 await assert.rejects(service().prepareOperation({ ...user, id: randomUUID() }, f.body), deny('EXECUTION_RUN_NOT_FOUND'));
 for (const status of ['completed', 'failed', 'cancelled'] as const) {
  await updateRun(f.run.harnessRunId, { status }); await assert.rejects(service().prepareOperation(user, f.body), deny('EXECUTION_RUN_NOT_ACTIVE'));
 }
 await updateRun(f.run.harnessRunId, { status: 'queued' });
 for (const patch of [{ status: 'disabled' }, { businessRole: 'delivery' }, { role: 'user' }]) {
  await updateUser(patch); await assert.rejects(service().prepareOperation(user, f.body), deny());
  await updateUser({ status: 'active', businessRole: 'pre_sales', role: 'admin' });
 }
 await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
 await assert.rejects(service().prepareOperation(user, f.body), deny('EXECUTION_RUN_NOT_FOUND'));
 await database.update(schema.aiSessions).set({ status: 'temporary_chat' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
 await stopRelease(f.root.skillId);
 await assert.rejects(service().prepareOperation(user, f.body), deny('EXECUTION_MANUAL_RETRY_REQUIRED'));
 const r = await retry(f); const op = await service().prepareOperation(user, { ...f.body, runId: r.data.runId });
 assert.equal(op.rootRunId, f.run.harnessRunId); assert.equal((await rows(f.run.harnessRunId)).length, 1);
});
test('current bad binding/manifest/fingerprint/adapter never prepares a row', async () => {
 const f = await fixture(), config: any = f.run.executionConfig;
 for (const patch of [{ executionConfig: { ...config, executionAuthority: [] } }, { executionConfig: { ...config, executionAuthority: [{ ...config.executionAuthority[0], epoch: -1 }] } },
  { executionConfig: { ...config, executionAuthority: [{ ...config.executionAuthority[0], grant: true }] } }, { executionConfig: { ...config, executionManifest: { ...config.executionManifest, manifestHash: hash('bad') } } },
  { metadata: { invocationFingerprint: hash('bad') } }, { workflowVersion: 'wrong' }, { submissionKey: null }]) {
  await updateRun(f.run.harnessRunId, patch); await assert.rejects(service().prepareOperation(user, f.body), deny());
  await updateRun(f.run.harnessRunId, f.run);
 }
 assert.equal((await rows(f.run.harnessRunId)).length, 0);
});
test('full ancestry rejects absent/cyclic/nonfailed/cross-owner/session/manifest/fingerprint/old-binding nodes', async () => {
 const f = await fixture(), r = await retry(f), body = { ...f.body, runId: r.data.runId }, config: any = f.run.executionConfig;
 for (const patch of [{ retryOfRunId: randomUUID() }, { retryOfRunId: r.data.runId }, { status: 'completed' as const }, { ownerUserId: randomUUID() }, { aiSessionId: randomUUID() },
  { workflowId: 'other-adapter' }, { metadata: { invocationFingerprint: hash('bad') } },
  { executionConfig: { ...config, executionAuthority: [] } }, { executionConfig: { ...config, executionAuthority: [...config.executionAuthority, ...config.executionAuthority] } },
  { executionConfig: { ...config, executionAuthority: [{ ...config.executionAuthority[0], epoch: -1 }] } },
  { executionConfig: { ...config, executionAuthority: [{ ...config.executionAuthority[0], id: 'wrong' }] } },
  { executionConfig: { ...config, executionAuthority: [{ ...config.executionAuthority[0], approved: true }] } }]) {
  await updateRun(f.run.harnessRunId, patch); await assert.rejects(service().prepareOperation(user, body), deny());
  await updateRun(f.run.harnessRunId, { ...f.run, status: 'failed' });
 }
 const changed = structuredClone(config); changed.executionManifest.initialInput = { text: 'different' };
 const { manifestHash: _, ...base } = changed.executionManifest; changed.executionManifest.manifestHash = hash(base);
 await updateRun(f.run.harnessRunId, { executionConfig: changed, metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: changed.content,
  execution: { kind: 'skill', skillId: f.root.skillId, input: changed.executionManifest.initialInput, sources: [] } }) } });
 await assert.rejects(service().prepareOperation(user, body), deny('OPERATION_LINEAGE_INVALID'));
 assert.equal((await rows(f.run.harnessRunId)).length, 0); assert.equal((await rows(r.data.runId)).length, 0);
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(work: Promise<T>): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('operation lock gate timeout')), 6000); })]); }
 finally { if (timer) clearTimeout(timer); }
}
async function blockedBy(pid: number) {
 for (let n = 0; n < 500; n++) {
  if ((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))", [pid])).rowCount) return;
  await new Promise(r => setTimeout(r, 10));
 }
 throw new Error(`expected actual PG lock waiter blocked by ${pid}`);
}
/** Gate after the real ledger INSERT, before commit; no timers simulate overlap. */
function gateInsert(base = database, rollback = false) {
 const entered = deferred(), release = deferred(), state = { pid: 0 }; const gated = Object.create(base);
 gated.transaction = (callback: any, config: any) => base.transaction(async tx => {
  const executor = Object.create(tx);
  executor.insert = (table: any) => {
   const statement = tx.insert(table), values = statement.values.bind(statement);
   statement.values = ((...args: any[]) => {
    const query = (values as any)(...args), conflict = query.onConflictDoNothing.bind(query);
    query.onConflictDoNothing = (...args: any[]) => {
     const insert = conflict(...args), returning = insert.returning.bind(insert);
     insert.returning = async () => { const rows = await returning(); state.pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      entered.resolve(); await release.promise; if (rollback) throw new Error('injected after insert'); return rows; };
     return insert;
    };
    return query;
   }) as any;
   return statement;
  };
  return callback(executor);
 }, config);
 return { database: gated, entered, release, state };
}
test('same single-connection service requests and independent PG insert wait converge on exactly one intent', async () => {
 const f = await fixture(); const same = await Promise.all([service().prepareOperation(user, f.body), service().prepareOperation(user, f.body)]);
 assert.deepEqual(same[0], same[1]);
 const separate = await fixture(), gate = gateInsert();
 const first = service({ database: gate.database }).prepareOperation(user, separate.body); void first.catch(() => {});
 let second: Promise<any> | undefined;
 try { await bounded(gate.entered.promise); second = service({ database: alternate }).prepareOperation(user, separate.body); void second.catch(() => {});
  await bounded(blockedBy(gate.state.pid));
 } finally { gate.release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
 assert.deepEqual(await first, await second); assert.equal((await rows(separate.run.harnessRunId)).length, 1);
});
test('independent competing payload waits for insert then conflicts without a second row', async () => {
 const f = await fixture(), gate = gateInsert(); const first = service({ database: gate.database }).prepareOperation(user, f.body); void first.catch(() => {});
 let outcome: Promise<any> | undefined;
 try { await bounded(gate.entered.promise); outcome = service({ database: alternate }).prepareOperation(user, { ...f.body, toolName: second.name }).then(value => ({ value }), error => ({ error }));
  await bounded(blockedBy(gate.state.pid));
 } finally { gate.release.resolve(); await Promise.allSettled([first, ...(outcome ? [outcome] : [])]); }
 await first; assert.equal((await outcome).error.code, 'OPERATION_INTENT_CONFLICT'); assert.equal((await rows(f.run.harnessRunId)).length, 1);
});
test('fault after a real INSERT rolls back completely; fresh preparation succeeds', async () => {
 const f = await fixture(), gate = gateInsert(database, true), preparing = service({ database: gate.database }).prepareOperation(user, f.body);
 const result = preparing.then(value => ({ value }), error => ({ error }));
 try { await bounded(gate.entered.promise); } finally { gate.release.resolve(); }
 assert.equal((await result as any).error.code, 'OPERATION_PREPARATION_UNAVAILABLE'); assert.equal((await rows(f.run.harnessRunId)).length, 0);
 assert.equal((await service().prepareOperation(user, f.body)).status, 'pending');
});
test('inventory I/O retains no connection and final admission catches user/role/epoch/Session changes', async () => {
 for (const cause of ['user', 'role', 'stop-release', 'session', 'identity', 'manifest']) {
  const f = await fixture(), entered = deferred(), release = deferred();
  const preparing = service({ inventory: async () => { entered.resolve(); await release.promise; return inventory(); } }).prepareOperation(user, f.body);
  const result = preparing.then(value => ({ value }), error => ({ error }));
  try {
   await bounded(entered.promise); await bounded(pool.query('SELECT 1'));
   if (cause === 'user') await updateUser({ status: 'disabled' });
   if (cause === 'role') await updateUser({ role: 'user' });
   if (cause === 'stop-release') await stopRelease(f.root.skillId);
   if (cause === 'session') await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
   if (cause === 'identity') await updateUser({ businessRole: 'delivery' });
   if (cause === 'manifest') await updateRun(f.run.harnessRunId, { metadata: { invocationFingerprint: hash('changed') } });
  } finally { release.resolve(); await result; await updateUser({ status: 'active', role: 'admin', businessRole: 'pre_sales' }); }
  assert.ok((await result as any).error, cause); assert.equal((await rows(f.run.harnessRunId)).length, 0, cause);
 }
});
test('retry parent/actor/reason/hash cannot be rewritten or cleared to wash a prior logical identity', async () => {
 const f = await fixture(), r = await retry(f), child = await persisted(r.data.runId), metadata: any = child.metadata;
 const siblingRoot = { ...f.run, harnessRunId: randomUUID(), submissionKey: randomUUID(), status: 'failed' as const };
 await database.insert(schema.harnessRuns).values(siblingRoot);
 for (const patch of [{ retryOfRunId: null }, { retryOfRunId: siblingRoot.harnessRunId }, { metadata: { invocationFingerprint: metadata.invocationFingerprint } },
  { metadata: { ...metadata, retryRequestHash: hash('bad') } }, { metadata: { ...metadata, retryActorId: randomUUID() } },
  { metadata: { ...metadata, retryReason: '' } }, { metadata: { ...metadata, retryReason: ' Explicit retry' } }, { metadata: { ...metadata, retryReason: 'x'.repeat(1001) } }]) {
  await updateRun(child.harnessRunId, patch);
  await assert.rejects(service().prepareOperation(user, { ...f.body, runId: child.harnessRunId }), deny('OPERATION_LINEAGE_INVALID'));
  await updateRun(child.harnessRunId, child);
 }
 const rootMetadata: any = f.run.metadata;
 await updateRun(f.run.harnessRunId, { metadata: { ...rootMetadata, retryReason: 'hidden retry' } });
 await assert.rejects(service().prepareOperation(user, { ...f.body, runId: child.harnessRunId }), deny('OPERATION_LINEAGE_INVALID'));
});
test('complete ancestry permits 64 nodes and fails closed at node 65 without reminting a root', async () => {
 const f = await fixture(); await updateRun(f.run.harnessRunId, { status: 'failed' });
 const chain: typeof schema.harnessRuns.$inferInsert[] = []; let parent = f.run.harnessRunId;
 for (let n = 0; n < 64; n++) {
  const id = randomUUID(), reason = `Depth ${n}`, metadata = { ...(f.run.metadata as any), retryActorId: user.id, retryReason: reason,
   retryRequestHash: hash({ sourceRunId: parent, sessionId: f.sessionId, fingerprint: (f.run.metadata as any).invocationFingerprint, reason }) };
  chain.push({ ...f.run, harnessRunId: id, submissionKey: randomUUID(), retryOfRunId: parent, metadata, status: 'failed' }); parent = id;
 }
 await database.insert(schema.harnessRuns).values(chain);
 const allowed = chain[62].harnessRunId!; await updateRun(allowed, { status: 'queued' });
 const op = await service().prepareOperation(user, { ...f.body, runId: allowed }); assert.equal(op.rootRunId, f.run.harnessRunId);
 await updateRun(allowed, { status: 'failed' }); await updateRun(parent, { status: 'queued' });
 await assert.rejects(service().prepareOperation(user, { ...f.body, runId: parent }), deny('OPERATION_LINEAGE_INVALID'));
 assert.equal((await rows(f.run.harnessRunId)).length, 1); assert.equal((await rows(parent)).length, 0);
});
test('siblings after a failed first retry retain its source provenance and the same pending root record', async () => {
 const f = await fixture(), a = await retry(f), first = await service().prepareOperation(user, { ...f.body, runId: a.data.runId });
 await updateRun(a.data.runId, { status: 'failed' }); const b = await retry(f);
 assert.deepEqual(await service().prepareOperation(user, { ...f.body, runId: b.data.runId }), first);
 const [row] = await rows(f.run.harnessRunId); assert.equal((row.input as any).sourceRunId, a.data.runId);
 assert.equal((await rows(a.data.runId)).length, 0); assert.equal((await rows(b.data.runId)).length, 0);
});
test('changed fully valid frozen definition at the same root slot conflicts instead of allocating a new operation', async () => {
 const f = await fixture(); await service().prepareOperation(user, f.body);
 const config: any = structuredClone(f.run.executionConfig), m = config.executionManifest;
 m.target.definition.instructions = 'Changed frozen intent'; m.skills[0].definition.instructions = m.target.definition.instructions;
 m.target.hash = hash(m.target.definition); m.skills[0].hash = m.target.hash;
 const { manifestHash: _, ...base } = m; m.manifestHash = hash(base);
 await updateRun(f.run.harnessRunId, { executionConfig: config });
 await assert.rejects(service().prepareOperation(user, f.body), deny('OPERATION_INTENT_CONFLICT'));
 assert.equal((await rows(f.run.harnessRunId)).length, 1);
});
test('configuration change during inventory is fenced and rolls back with no pending row', async () => {
 const f = await fixture(), entered = deferred(), release = deferred();
 const [old] = await database.select().from(schema.systemConfigs).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
 const preparing = service({ inventory: async () => { entered.resolve(); await release.promise; return inventory(); } }).prepareOperation(user, f.body);
 const outcome = preparing.then(value => ({ value }), error => ({ error }));
 try {
  await bounded(entered.promise);
  if (old) await database.update(schema.systemConfigs).set({ version: old.version + 1 }).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
  else await database.insert(schema.systemConfigs).values({ configKey: 'toolPolicy', store: { schemaVersion: 1, policies: {} } });
 } finally {
  release.resolve(); await outcome;
  if (old) await database.update(schema.systemConfigs).set(old).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
  else await database.delete(schema.systemConfigs).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
 }
 assert.equal((await outcome as any).error.code, 'SKILL_CONTEXT_CHANGED'); assert.equal((await rows(f.run.harnessRunId)).length, 0);
});
test('preparation leaves checkpoints, output, event sequence and model records untouched and calls no dispatch', async () => {
 const f = await fixture(); let dispatches = 0;
 const guarded = async () => ({ ...await inventory(), registry: { get: (name: string) => [native, second].find(t => t.name === name),
  execute: async () => { dispatches++; throw new Error('NO TOOL DISPATCH'); } } });
 await database.insert(schema.harnessRunCheckpoints).values({ harnessRunCheckpointId: randomUUID(), harnessRunId: f.run.harnessRunId, sequence: 1,
  checkpointKey: 'original', checkpointKind: 'structural', workflowId: f.run.workflowId!, workflowVersion: f.run.workflowVersion!, stepKey: 'original',
  resumePolicy: 'resume_next', state: { immutable: true }, stateHash: hash('original'), runtimeValidation: {} });
 await database.insert(schema.harnessRunOutputs).values({ harnessRunOutputId: randomUUID(), harnessRunId: f.run.harnessRunId, status: 'final', content: { original: true }, contentHash: hash('original') });
 const before = await queue.getRunSnapshot(f.run.harnessRunId), run = await persisted(f.run.harnessRunId);
 const modelRows = () => database.select().from(schema.harnessModelRuns).where(eq(schema.harnessModelRuns.harnessRunId, f.run.harnessRunId));
 const models = await modelRows(), events = await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 });
 await service({ inventory: guarded }).prepareOperation(user, f.body); await service({ inventory: guarded }).prepareOperation(user, f.body);
 assert.deepEqual(await queue.getRunSnapshot(f.run.harnessRunId), before); assert.deepEqual(await persisted(f.run.harnessRunId), run);
 assert.deepEqual(await modelRows(), models); assert.deepEqual(await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 }), events);
 assert.equal(dispatches, 0); assert.equal((await rows(f.run.harnessRunId)).length, 1);
});
test('write/exfiltration/MCP may only prepare an intent; existing dispatch authority remains closed', async () => {
 for (const cause of ['write', 'exfiltrate', 'mcp']) {
  const f = await fixture(), config: any = structuredClone(f.run.executionConfig), m = config.executionManifest;
  const current: any = { ...native, ...(cause === 'write' ? { mutates: true } : cause === 'exfiltrate' ? { exfiltrates: true } : { source: 'mcp', simulationOnly: true }) };
  m.skills[0].context.tools[0].native = current; const { manifestHash: _, ...base } = m; m.manifestHash = hash(base);
  await updateRun(f.run.harnessRunId, { executionConfig: config });
  const tools = async () => ({ ...await inventory(), registry: { get: (name: string) => name === second.name ? second : name === native.name ? { ...current, ...(cause === 'mcp' ? { mcpAllowedRoles: ['ADMIN'] } : {}) } : undefined } });
  assert.equal((await service({ inventory: tools }).prepareOperation(user, f.body)).status, 'pending');
  await assert.rejects(createExecutionAuthority(database, tools as any).check({ runId: f.run.harnessRunId, ownerUserId: user.id,
   manifestHash: m.manifestHash, stepId: '$skill', phase: 'tool', toolName: native.name }), deny('EXECUTION_AUTHORITY_DENIED'));
 }
});
test('final transaction configuration fence catches a change after inventory preparation completed', async () => {
 const f = await fixture(); const [old] = await database.select().from(schema.systemConfigs).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
 const gated = Object.create(database); let transactions = 0;
 gated.transaction = async (callback: any, settings: any) => {
  if (++transactions === 4) {
   if (old) await alternate.update(schema.systemConfigs).set({ version: old.version + 1 }).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
   else await alternate.insert(schema.systemConfigs).values({ configKey: 'toolPolicy', store: { schemaVersion: 1, policies: {} } });
  }
  return database.transaction(callback, settings);
 };
 try { await assert.rejects(service({ database: gated }).prepareOperation(user, f.body), deny('SKILL_CONTEXT_CHANGED')); }
 finally {
  if (old) await database.update(schema.systemConfigs).set(old).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
  else await database.delete(schema.systemConfigs).where(eq(schema.systemConfigs.configKey, 'toolPolicy'));
 }
 assert.equal(transactions, 4); assert.equal((await rows(f.run.harnessRunId)).length, 0);
});
test('individually bounded frozen manifest and mapped parameters cannot compose an oversized persisted intent', async () => {
 const f = await fixture(), config: any = structuredClone(f.run.executionConfig), m = config.executionManifest, text = 'x'.repeat(400000);
 const current = { ...native, description: 'd'.repeat(300000), parameters: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'], additionalProperties: false } };
 m.initialInput = { text }; m.skills[0].context.tools[0].native = current;
 for (const d of [m.target.definition, m.skills[0].definition]) d.tools[0].inputMapping = { a: '$.text', b: '$.text' };
 m.target.hash = hash(m.target.definition); m.skills[0].hash = m.target.hash;
 const { manifestHash: _, ...base } = m; m.manifestHash = hash(base);
 await updateRun(f.run.harnessRunId, { executionConfig: config, metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: config.content,
  execution: { kind: 'skill', skillId: f.root.skillId, input: m.initialInput, sources: [] } }) } });
 const tools = async () => ({ ...await inventory(), registry: { get: (name: string) => name === second.name ? second : name === native.name ? current : undefined } });
 assert.ok(Buffer.byteLength(JSON.stringify(m)) < 1024 * 1024);
 const body = { ...f.body, parameters: { a: text, b: text } }; assert.ok(Buffer.byteLength(JSON.stringify(body)) < 1024 * 1024);
 await assert.rejects(service({ inventory: tools }).prepareOperation(user, body), deny('OPERATION_INTENT_INVALID'));
 assert.equal((await rows(f.run.harnessRunId)).length, 0);
});

test('a valid owned business Workflow with a direct native tool still cannot use the root Skill operation service', async () => {
 const f = await fixture(), m: any = workflowManifest(d => {
  d.steps = d.steps.filter(s => s.type === 'tool'); d.steps[0].inputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }];
  d.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }];
 });
 m.target.id = randomUUID(); m.target.versionId = randomUUID(); m.caller = { id: user.id, businessRole: 'pre_sales' }; m.initialInput = { text: 'original' };
 const { manifestHash: _, ...base } = m; m.manifestHash = hash(base);
 await database.insert(schema.workflowDefinitions).values({ workflowId: m.target.id, name: 'Operation Workflow fixture', description: '', category: 'test',
  enabled: true, archived: false, currentVersionId: m.target.versionId, activeVersionId: m.target.versionId, revision: 0, createdAt: new Date(), updatedAt: new Date() });
 const config = { ...f.run.executionConfig as any, executionManifest: m, executionAuthority: [{ kind: 'workflow', id: m.target.id, epoch: 0 }] };
 await updateRun(f.run.harnessRunId, { executionConfig: config, metadata: { invocationFingerprint: hash({ sessionId: f.sessionId, content: config.content,
  execution: { kind: 'workflow', workflowId: m.target.id, input: m.initialInput, sources: m.sources } }) } });
 await assert.rejects(service().prepareOperation(user, f.body), deny('OPERATION_SCOPE_INVALID'));
 assert.equal((await rows(f.run.harnessRunId)).length, 0);
});
