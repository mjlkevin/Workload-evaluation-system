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
import { createSkillOperationExecutionService, type SkillLocalTransactionAdapter } from './skills.operation-execution';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
const url = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: url, max: 1, application_name: 'wes-execution-main', connectionTimeoutMillis: 1000 });
const control = new Pool({ connectionString: url, max: 3, application_name: 'wes-execution-control' });
const database = drizzle(pool, { schema }), alternate = drizzle(control, { schema });
const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `operation-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const native = { name: 'operation_write', description: 'Fixture write', parameters: payload, mutates: true, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
const second = { ...native, name: 'operation_other' }, ask = { ...native, name: 'ask_user', mutates: false };
const definition: SkillDefinition = { name: 'Operation fixture', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'],
 inputSchema: payload, outputSchema: payload, tools: [native, second].map(t => ({ toolName: t.name, inputMapping: { text: '$.text' }, requiresConfirmation: true })),
 references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const inventory = async () => ({ registry: { get: (name: string) => [native, second, ask].find(t => t.name === name) }, tools: [], policy: { schemaVersion: 1, policies: {} } }) as any;
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: d.tools.map(t => [native, second, ask].find(n => n.name === t.toolName)), snapshot: {
 schemaVersion: 1, references: [], tools: d.tools.map(t => ({ native: [native, second, ask].find(n => n.name === t.toolName), policy: DEFAULT_TOOL_POLICY_ENTRY })), roles: ['ADMIN'],
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
 return { root, sessionId, run: await persisted(accepted.data.runId), body: { runId: accepted.data.runId, stepId: '$skill', ordinal: 0, toolName: patch.tools?.[0]?.toolName ?? native.name, parameters: { text: 'original' } } };
}
async function retry(f: Awaited<ReturnType<typeof fixture>>) {
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
 return createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { throw new Error('NO MODEL DISPATCH'); } }) }).retryInvocation(user, f.run.harnessRunId, { submissionKey: randomUUID(), reason: 'Explicit retry' });
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
 assert.equal(Number((await pool.query('SELECT count(*) n FROM version_records WHERE owner_user_id=$1', [user.id])).rows[0].n), 0); await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 assert.equal(Number((await pool.query('SELECT count(*) n FROM harness_runs WHERE owner_user_id=$1', [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM ai_sessions WHERE owner_user_id=$1', [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM users WHERE user_id=$1', [user.id])).rows[0].n), 0);
 await pool.end(); await control.end(); });
const decisions = (extra: any = {}) => createSkillOperationDecisionService({ database, inventory, ...extra });
const deny = (code?: string) => (e: any) => e.status >= 400 && (!code || e.code === code);
async function pending() { const f = await fixture(), op = await service().prepareOperation(user, f.body); return { ...f, op, request: { runId: f.run.harnessRunId, operationId: op.operationId } }; }
async function approve(f: Awaited<ReturnType<typeof pending>>, extra: any = {}) {
 const view = await decisions(extra).readForConfirmation(user, f.request);
 return decisions(extra).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' });
}
const execution = (extra: any = {}) => createSkillOperationExecutionService({ database, inventory, adapters: new Map([[native.name, adapter]]), ...extra });
const adapter: SkillLocalTransactionAdapter = { kind: 'local-transaction', async execute(tx, input) {
 const now = new Date(), id = randomUUID();
 await tx.insert(schema.versionRecords).values({ recordId: id, type: 'assessment', versionCode: `C2c-${id}`, templateId: 'c2c-test', baseCode: `C2c-${id}`,
  ownerUserId: input.ownerId, status: 'draft', payload: { operationId: input.operationId, parameters: input.parameters }, createdAt: now, updatedAt: now,
  createdByUserId: input.ownerId, updatedByUserId: input.ownerId, createdByUsername: user.username, updatedByUsername: user.username,
  checkoutStatus: 'checked_in', versionDocStatus: 'drafting', majorLetter: 'A', minorNumber: 0, isHistoricalArchive: false, lastCheckinPayload: {} });
 return { recordId: id, text: 'written' };
} };
const business = async (operationId: string) => (await database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id))).filter(r => (r.payload as any).operationId === operationId);
const receipts = async (root: string) => (await rows(root)).filter(r => r.eventType === 'business_operation_executed');
async function approved() { const f = await pending(), view = await approve(f); return { ...f, view, command: { ...f.request, confirmationHash: view.confirmationHash } }; }
test('duplicate and reconstructed service consume once: one actual business row and one receipt', async () => {
 const f = await approved(), first = await execution().executeOperation(user, f.command);
 assert.deepEqual(await execution().executeOperation(user, f.command), first);
 const records = await business(f.op.operationId); assert.equal(records.length, 1);
 assert.equal(records[0].type, 'assessment'); assert.equal(records[0].checkoutStatus, 'checked_in'); assert.equal(records[0].versionDocStatus, 'drafting');
 assert.equal(records[0].minorNumber, 0); assert.equal(records[0].majorLetter, 'A'); assert.equal(records[0].baseCode, records[0].versionCode);
 assert.equal((await receipts(f.op.rootRunId)).length, 1);
});
test('adapter writes followed by invalid JSON result roll back the business row and receipt', async () => {
 const f = await approved();
 await assert.rejects(execution({ adapters: new Map([[native.name, { kind: 'local-transaction', async execute(tx: any, input: any) { await adapter.execute(tx, input); return { bad: Infinity }; } }]]) }).executeOperation(user, f.command));
 assert.equal((await business(f.op.operationId)).length, 0); assert.equal((await receipts(f.op.rootRunId)).length, 0);
});
test('typed native adapter rolls back schema-invalid output before business row and receipt commit', async () => {
 (native as any).outputSchema = payload;
 try {
  const f = await approved();
  const invalid = { kind: 'local-transaction', async execute(tx: any, input: any) { await adapter.execute(tx, input); return { text: 9 }; } };
  let refused: unknown;
  try { await execution({ adapters: new Map([[native.name, invalid]]) }).executeOperation(user, f.command); } catch (error) { refused = error; }
  assert.equal((await business(f.op.operationId)).length, 0, 'schema-invalid native output must roll back the actual business row');
  assert.equal((await receipts(f.op.rootRunId)).length, 0); assert.equal((refused as any)?.code, 'OPERATION_NATIVE_OUTPUT_SCHEMA_FAILED');
  const valid = { kind: 'local-transaction', async execute(tx: any, input: any) { await adapter.execute(tx, input); return { text: 'written' }; } };
  const service = execution({ adapters: new Map([[native.name, valid]]) });
  const first = await service.executeOperation(user, f.command); assert.deepEqual(first.result, { text: 'written' });
  assert.deepEqual(await service.executeOperation(user, f.command), first); assert.equal((await business(f.op.operationId)).length, 1);
  const receipt = (await receipts(f.op.rootRunId))[0];
  await database.update(schema.harnessToolEvents).set({ output: { schemaVersion: 1, result: { text: 9 } } }).where(eq(schema.harnessToolEvents.harnessToolEventId, receipt.harnessToolEventId));
  await assert.rejects(service.executeOperation(user, f.command), deny('OPERATION_NATIVE_OUTPUT_SCHEMA_FAILED'));
 } finally { delete (native as any).outputSchema; }
});
const updateRun = (id: string, patch: any) => database.update(schema.harnessRuns).set(patch).where(eq(schema.harnessRuns.harnessRunId, id));
const updateUser = (patch: any) => database.update(schema.users).set(patch).where(eq(schema.users.userId, user.id));
const updateEvent = (id: string, patch: any) => database.update(schema.harnessToolEvents).set(patch).where(eq(schema.harnessToolEvents.harnessToolEventId, id));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(work: Promise<T>): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('execution gate timeout')), 6000); })]); }
 finally { if (timer) clearTimeout(timer); }
}
async function blockedBy(pid: number) {
 for (let n = 0; n < 500; n++) {
  if ((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))", [pid])).rowCount) return;
  await new Promise(r => setTimeout(r, 10));
 }
 throw new Error(`expected actual SQL Lock waiter blocked by ${pid}`);
}
function wrappedDatabase(wrap: (tx: any, count: number) => any) {
 const wrapped = Object.create(database); let count = 0;
 wrapped.transaction = (callback: any, settings: any) => database.transaction(tx => callback(wrap(tx, ++count)), settings);
 return wrapped;
}
test('service returns detached exact JSON result, leaves pending/Run/checkpoints/outputs/models/events intact, and never dispatches registry', async () => {
 const f = await approved(); let dispatches = 0;
 const tools = async () => ({ ...await inventory(), registry: { get: (name: string) => [native, second, ask].find(t => t.name === name), execute: async () => { dispatches++; throw new Error('NO NATIVE EXECUTE'); } } });
 const before = await persisted(f.command.runId), pendingBefore = (await rows(f.op.rootRunId)).find(r => r.harnessToolEventId === f.op.operationId);
 const snapshot = await queue.getRunSnapshot(f.command.runId), events = await queue.listRunEventsAfter({ runId: f.command.runId, afterSequence: 0, limit: 100 });
 const models = () => database.select().from(schema.harnessModelRuns).where(eq(schema.harnessModelRuns.harnessRunId, f.command.runId));
 const beforeModels = await models(), first = await execution({ inventory: tools }).executeOperation(user, f.command), stable = structuredClone(first);
 assert.deepEqual(Object.keys(first).sort(), ['executionId', 'operationId', 'result', 'rootRunId', 'status']);
 (first.result as any).text = 'caller mutation';
 assert.deepEqual(await execution().executeOperation(user, f.command), stable);
 assert.deepEqual(await persisted(f.command.runId), before); assert.deepEqual(await queue.getRunSnapshot(f.command.runId), snapshot);
 assert.deepEqual(await queue.listRunEventsAfter({ runId: f.command.runId, afterSequence: 0, limit: 100 }), events); assert.deepEqual(await models(), beforeModels);
 assert.deepEqual((await rows(f.op.rootRunId)).find(r => r.harnessToolEventId === f.op.operationId), pendingBefore);
 assert.equal(dispatches, 0); assert.deepEqual(Object.keys(execution()), ['executeOperation']);
 const receipt = (await receipts(f.op.rootRunId))[0];
 assert.deepEqual(Object.keys(receipt.input as object).sort(), ['confirmationHash', 'decisionId', 'manifestHash', 'operationId', 'operationKey', 'ownerId', 'payloadHash', 'rootRunId', 'schemaVersion', 'sessionId', 'sourceRunId', 'toolName']);
 assert.equal(receipt.effectKey, `business-op-execution:v1:${hash({ operationId: f.op.operationId })}`); assert.equal(receipt.actionId, receipt.effectKey);
 assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.errorMessage, null); assert.equal(receipt.riskLevel, null);
 assert.equal((receipt.input as any).decisionId, f.view.decisionId); assert.equal((receipt.input as any).sourceRunId, f.command.runId);
 assert.deepEqual(receipt.output, { schemaVersion: 1, result: stable.result });
 assert.equal((await business(f.op.operationId)).length, 1);
});
test('strict three-field command normalizes UUID/hash and rejects caller-supplied authority, adapters, tool, parameters and JSON attacks', async () => {
 const f = await approved(); let cyclic: any = {}; cyclic.self = cyclic;
 const deep: any = {}; let level = deep; for (let n = 0; n < 34; n++) level = level.next = {};
 for (const bad of [null, [], {}, { ...f.command, runId: 'bad' }, { ...f.command, operationId: 'bad' }, { ...f.command, confirmationHash: 'g'.repeat(64) },
  { ...f.command, approved: true }, { ...f.command, decisionId: f.view.decisionId }, { ...f.command, parameters: {} }, { ...f.command, adapters: new Map() },
  { ...f.command, toolName: native.name }, { ...f.command, confirmationHash: cyclic }, { ...f.command, confirmationHash: deep },
  { ...f.command, confirmationHash: 'x'.repeat(1024 * 1024) }, { ...f.command, ...JSON.parse('{"__proto__":1}') }])
  await assert.rejects(execution().executeOperation(user, bad), deny('OPERATION_INVALID_REQUEST'));
 const result = await execution().executeOperation(user, { runId: f.command.runId.toUpperCase(), operationId: f.command.operationId.toUpperCase(), confirmationHash: f.command.confirmationHash.toUpperCase() });
 assert.equal(result.operationId, f.op.operationId); assert.equal((await business(f.op.operationId)).length, 1);
});
test('no approval, rejection, old hash, foreign owner, unknown/cross-root operation cannot write', async () => {
 const f = await pending(), view = await decisions().readForConfirmation(user, f.request), command = { ...f.request, confirmationHash: view.confirmationHash };
 await assert.rejects(execution().executeOperation(user, command), deny('OPERATION_APPROVAL_REQUIRED'));
 await decisions().decideOperation(user, { ...command, decision: 'reject' });
 await assert.rejects(execution().executeOperation(user, command), deny('OPERATION_APPROVAL_REQUIRED'));
 const ok = await approved(), other = await fixture();
 for (const body of [{ ...ok.command, confirmationHash: hash('stale') }, { ...ok.command, operationId: randomUUID() }, { ...ok.command, runId: other.run.harnessRunId }])
  await assert.rejects(execution().executeOperation(user, body), deny());
 await assert.rejects(execution().executeOperation({ ...user, id: randomUUID() }, ok.command), deny());
 assert.equal((await business(f.op.operationId)).length, 0); assert.equal((await business(ok.op.operationId)).length, 0);
 assert.equal((await receipts(f.op.rootRunId)).length, 0); assert.equal((await receipts(ok.op.rootRunId)).length, 0);
});
test('default adapter is fail-closed and copied adapter map/callable cannot change in inventory gap', async () => {
 const f = await approved(); await assert.rejects(execution({ adapters: undefined }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_TOOL_DENIED'));
 await assert.rejects(execution({ adapters: new Map([[native.name, { kind: 'remote', execute: adapter.execute }]]) }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_TOOL_DENIED'));
 const mutable = { ...adapter }, adapters = new Map([[native.name, mutable]]); let replacements = 0;
 const service = execution({ adapters, inventory: async () => { adapters.clear(); mutable.execute = async () => { replacements++; throw new Error('replaced'); }; return inventory(); } });
 await service.executeOperation(user, f.command); assert.equal(replacements, 0); assert.equal((await business(f.op.operationId)).length, 1);
});
test('read-only, MCP, exfiltration and simulation tools remain denied even with approval and adapter', async () => {
 for (const patch of [{ mutates: false }, { source: 'mcp', simulationOnly: true }, { exfiltrates: true }, { simulationOnly: true, sandboxReadSafe: false }]) {
  const f = await fixture(), config: any = structuredClone(f.run.executionConfig), manifest = config.executionManifest;
  const current: any = { ...native, ...patch };
  manifest.skills[0].context.tools[0].native = current;
  const { manifestHash: _, ...base } = manifest; manifest.manifestHash = hash(base); await updateRun(f.run.harnessRunId, { executionConfig: config });
  const tools = async () => ({ ...await inventory(), registry: { get: (name: string) => name === native.name ? { ...current, ...(current.source === 'mcp' ? { mcpAllowedRoles: ['ADMIN'] } : {}) } : second } });
  const op = await service({ inventory: tools }).prepareOperation(user, f.body), request = { runId: f.run.harnessRunId, operationId: op.operationId };
  const view = await decisions({ inventory: tools }).readForConfirmation(user, request);
  await decisions({ inventory: tools }).decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
  await assert.rejects(execution({ inventory: tools }).executeOperation(user, { ...request, confirmationHash: view.confirmationHash }), deny());
  assert.equal((await business(op.operationId)).length, 0); assert.equal((await receipts(op.rootRunId)).length, 0);
 }
});
test('new retry needs new approval before reusing original committed receipt without a second business write', async () => {
 const f = await approved(), first = await execution().executeOperation(user, f.command), original = (await receipts(f.op.rootRunId))[0];
 const r = await retry(f), request = { ...f.request, runId: r.data.runId }, fresh = await decisions().readForConfirmation(user, request);
 await assert.rejects(execution().executeOperation(user, { ...request, confirmationHash: f.command.confirmationHash }), deny('OPERATION_CONFIRMATION_CHANGED'));
 await assert.rejects(execution().executeOperation(user, { ...request, confirmationHash: fresh.confirmationHash }), deny('OPERATION_APPROVAL_REQUIRED'));
 await decisions().decideOperation(user, { ...request, confirmationHash: fresh.confirmationHash, decision: 'approve' });
 assert.deepEqual(await execution().executeOperation(user, { ...request, confirmationHash: fresh.confirmationHash }), first);
 assert.equal((await business(f.op.operationId)).length, 1); assert.deepEqual(await receipts(f.op.rootRunId), [original]);
 assert.equal((await rows(request.runId)).length, 0);
});
test('same operation SQL unique conflict actually waits after INSERT and only winner invokes adapter', async () => {
 const f = await approved(), entered = deferred(), release = deferred(); let pid = 0, calls = 0;
 const gatedAdapter = { kind: 'local-transaction', async execute(tx: any, input: any) {
  calls++; const result = await adapter.execute(tx, input); pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
  entered.resolve(); await bounded(release.promise); return result;
 } };
 const first = execution({ adapters: new Map([[native.name, gatedAdapter]]) }).executeOperation(user, f.command);
 let secondWork: Promise<any> | undefined;
 try {
  await bounded(entered.promise);
  secondWork = execution({ database: alternate }).executeOperation(user, f.command);
  await bounded(blockedBy(pid)); assert.equal(calls, 1);
 } finally { release.resolve(); await Promise.allSettled([first, ...(secondWork ? [secondWork] : [])]); }
 assert.deepEqual(await secondWork, await first); assert.equal(calls, 1);
 assert.equal((await business(f.op.operationId)).length, 1); assert.equal((await receipts(f.op.rootRunId)).length, 1);
});
test('adapter exception, unsafe outputs and completion update failure roll back actual writes; a fresh attempt can succeed', async () => {
 let cyclic: any = {}; cyclic.self = cyclic;
 const inheritedArray: any = []; Object.setPrototypeOf(inheritedArray, { toJSON: () => ({ disguised: true }) });
 let getterCalls = 0; const getterOutput = { get bad() { getterCalls++; return 'getter must not run'; } };
 const deep: any = {}; let level = deep; for (let n = 0; n < 34; n++) level = level.next = {};
 for (const output of [undefined, Infinity, new Date(), new Map(), inheritedArray, { bad: undefined }, { bad: () => 1 }, cyclic, deep,
  { huge: 'x'.repeat(1024 * 1024) }, JSON.parse('{"constructor":1}'), getterOutput]) {
  const f = await approved(); let calls = 0;
  await assert.rejects(execution({ adapters: new Map([[native.name, { kind: 'local-transaction', async execute(tx: any, input: any) {
   calls++; await adapter.execute(tx, input); return output;
  } }]]) }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_INVALID'));
  assert.equal(calls, 1); assert.equal((await business(f.op.operationId)).length, 0); assert.equal((await receipts(f.op.rootRunId)).length, 0);
  await execution().executeOperation(user, f.command); assert.equal((await business(f.op.operationId)).length, 1);
 }
 assert.equal(getterCalls, 0);
 for (const cause of ['throw', 'update']) {
  const f = await approved(), wrapped = wrappedDatabase(tx => { const executor = Object.create(tx); executor.update = (table: any) => { if (table === schema.harnessToolEvents) throw new Error('injected completion failure'); return tx.update(table); }; return executor; });
  await assert.rejects(execution({ ...(cause === 'update' ? { database: wrapped } : { adapters: new Map([[native.name, { kind: 'local-transaction', async execute(tx: any, input: any) { await adapter.execute(tx, input); throw new Error('after real write'); } }]]) }) }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_UNAVAILABLE'));
  assert.equal((await business(f.op.operationId)).length, 0); assert.equal((await receipts(f.op.rootRunId)).length, 0);
  await execution().executeOperation(user, f.command); assert.equal((await business(f.op.operationId)).length, 1); assert.equal((await receipts(f.op.rootRunId)).length, 1);
 }
});
test('receipt envelope, input/output bounds, provenance and PostgreSQL microsecond ordering are revalidated without writes', async () => {
 const f = await approved(); await execution().executeOperation(user, f.command);
 const row = (await receipts(f.op.rootRunId))[0], input: any = row.input;
 const other = await approved();
 for (const patch of [{ eventType: 'confirmation' }, { status: 'executing' }, { status: 'confirmed' }, { actionId: 'legacy' }, { toolName: 'other' },
  { errorMessage: 'bad' }, { riskLevel: 'low' }, { resolvedAt: null }, { output: { schemaVersion: 2, result: {} } }, { output: { schemaVersion: 1, result: {}, extra: true } },
  { input: { ...input, extra: true } }, { input: { ...input, operationKey: 'other' } }, { input: { ...input, payloadHash: hash('other') } },
  { input: { ...input, ownerId: randomUUID() } }, { input: { ...input, sessionId: randomUUID() } },
  { input: { ...input, sourceRunId: input.sourceRunId.toUpperCase() } }, { input: { ...input, decisionId: input.decisionId.toUpperCase() } },
  { input: { ...input, confirmationHash: input.confirmationHash.toUpperCase() } }, { input: { ...input, sourceRunId: other.command.runId } },
  { input: { ...input, decisionId: other.view.decisionId } }, { input: { ...input, decisionId: randomUUID() } }, { input: { ...input, confirmationHash: hash('forged') } }]) {
  await updateEvent(row.harnessToolEventId, patch);
  await assert.rejects(execution().executeOperation(user, f.command), deny());
  assert.equal((await business(f.op.operationId)).length, 1); await updateEvent(row.harnessToolEventId, row);
 }
 for (const times of ["resolved_at=created_at - interval '1 microsecond'", "resolved_at='infinity'::timestamptz"]) {
  await control.query(`UPDATE harness_tool_events SET ${times} WHERE harness_tool_event_id=$1`, [row.harnessToolEventId]);
  await assert.rejects(execution().executeOperation(user, f.command), deny('OPERATION_EXECUTION_INVALID')); await updateEvent(row.harnessToolEventId, row);
 }
 assert.equal((await business(f.op.operationId)).length, 1); assert.equal((await receipts(f.op.rootRunId)).length, 1);
});
test('legacy collision under execution effectKey cannot be accepted as completion or dispatched', async () => {
 const f = await approved(), effectKey = `business-op-execution:v1:${hash({ operationId: f.op.operationId })}`;
 await database.insert(schema.harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: f.op.rootRunId, effectKey, actionId: effectKey,
  eventType: 'confirmation', toolName: native.name, status: 'confirmed', input: { approved: true } });
 await assert.rejects(execution().executeOperation(user, f.command), deny('OPERATION_EXECUTION_INVALID'));
 assert.equal((await business(f.op.operationId)).length, 0);
});
test('real ask_user and unsupported remote/file manifest sources cannot enter the adapter', async () => {
 const f = await fixture({ tools: [{ toolName: ask.name, inputMapping: { text: '$.text' }, requiresConfirmation: true }] });
 const op = await service().prepareOperation(user, f.body), request = { runId: f.run.harnessRunId, operationId: op.operationId };
 const view = await decisions().readForConfirmation(user, request);
 await decisions().decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
 await assert.rejects(execution({ adapters: new Map([[ask.name, adapter]]) }).executeOperation(user, { ...request, confirmationHash: view.confirmationHash }), deny('OPERATION_EXECUTION_TOOL_DENIED'));
 assert.equal((await business(op.operationId)).length, 0);
 for (const source of ['remote', 'file']) {
  const f = await approved(), config: any = structuredClone(f.run.executionConfig), manifest = config.executionManifest;
  manifest.skills[0].context.tools[0].native.source = source; const { manifestHash: _, ...base } = manifest; manifest.manifestHash = hash(base);
  await updateRun(f.command.runId, { executionConfig: config });
  await assert.rejects(execution().executeOperation(user, f.command), deny('EXECUTION_MANIFEST_INVALID'));
  assert.equal((await business(f.op.operationId)).length, 0);
 }
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
test('current authority is checked before a successful receipt can replay, including terminal Run, session and emergency epoch', async () => {
 for (const cause of ['inactive', 'role', 'business-role', 'failed', 'completed', 'cancelled', 'archive', 'delete-session', 'stop-release']) {
  const f = await approved(); await execution().executeOperation(user, f.command); const receipt = await receipts(f.op.rootRunId);
  try {
   if (cause === 'inactive') await updateUser({ status: 'disabled' }); if (cause === 'role') await updateUser({ role: 'user' });
   if (cause === 'business-role') await updateUser({ businessRole: 'development' });
   if (['failed', 'completed', 'cancelled'].includes(cause)) await updateRun(f.command.runId, { status: cause });
   if (cause === 'archive') await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
   if (cause === 'delete-session') await database.delete(schema.aiSessions).where(eq(schema.aiSessions.sessionId, f.sessionId));
   if (cause === 'stop-release') {
    const emergency = createExecutionEmergencyRepository(database), current = await emergency.read('skill', f.root.skillId, user);
    await emergency.change('skill', f.root.skillId, user, current.control.revision, 'Stop receipt replay', 'stop');
    await assert.rejects(execution().executeOperation(user, f.command), deny('EXECUTION_EMERGENCY_STOPPED'));
    await emergency.change('skill', f.root.skillId, user, current.control.revision + 1, 'Release receipt replay', 'release');
   }
   await assert.rejects(execution().executeOperation(user, f.command), deny());
   assert.equal((await business(f.op.operationId)).length, 1); assert.deepEqual(await receipts(f.op.rootRunId), receipt);
  } finally { await updateUser({ status: 'active', role: 'admin', businessRole: 'pre_sales' }); }
 }
});
test('max=1 inventory can query DB without retained locks and changes in the inventory gap stop both fresh writes and replay', async () => {
 for (const replay of [false, true]) for (const cause of ['inactive', 'cancel', 'archive', 'stop-release', 'pending']) {
  const f = await approved(); if (replay) await execution().executeOperation(user, f.command);
  const entered = deferred(), release = deferred(); let resolved = 0;
  const tools = async () => { await bounded(pool.query('SELECT 1')); resolved++; entered.resolve(); await bounded(release.promise); return inventory(); };
  const outcome = execution({ inventory: tools }).executeOperation(user, f.command).then(value => ({ value }), error => ({ error }));
  try {
   await bounded(entered.promise);
   if (cause === 'inactive') await updateUser({ status: 'disabled' }); if (cause === 'cancel') await updateRun(f.command.runId, { status: 'cancelled' });
   if (cause === 'archive') await database.update(schema.aiSessions).set({ status: 'archived' }).where(eq(schema.aiSessions.sessionId, f.sessionId));
   if (cause === 'pending') { const row = (await rows(f.op.rootRunId)).find(r => r.harnessToolEventId === f.op.operationId)!; await updateEvent(f.op.operationId, { input: { ...(row.input as any), parameters: { text: 'changed' } } }); }
   if (cause === 'stop-release') {
    const emergency = createExecutionEmergencyRepository(database), current = await emergency.read('skill', f.root.skillId, user);
    await emergency.change('skill', f.root.skillId, user, current.control.revision, 'Stop inventory gap', 'stop');
    await emergency.change('skill', f.root.skillId, user, current.control.revision + 1, 'Release inventory gap', 'release');
   }
  } finally { release.resolve(); await outcome; await updateUser({ status: 'active', role: 'admin', businessRole: 'pre_sales' }); }
  assert.equal(resolved, 1); assert.ok('error' in await outcome, `${replay} ${cause}`);
  assert.equal((await business(f.op.operationId)).length, replay ? 1 : 0); assert.equal((await receipts(f.op.rootRunId)).length, replay ? 1 : 0);
 }
});
test('microsecond policy changes during inventory or immediately before final fence stop writes and receipt replay', async () => {
 for (const replay of [false, true]) for (const phase of ['inventory', 'final']) await revision('toolPolicy', async () => {
  await control.query("UPDATE system_configs SET updated_at='2026-11-03T00:00:00.000001Z' WHERE config_key='toolPolicy'");
  const f = await approved(); if (replay) await execution().executeOperation(user, f.command);
  const mutate = () => control.query("UPDATE system_configs SET updated_at='2026-11-03T00:00:00.000002Z' WHERE config_key='toolPolicy'");
  const wrapped = wrappedDatabase((tx, count) => { const executor = Object.create(tx); let changed = false;
   executor.execute = async (query: any) => { if (count === 4 && !changed && phase === 'final') { changed = true; await mutate(); } return tx.execute(query); }; return executor; });
  const tools = async () => { await bounded(pool.query('SELECT 1')); if (phase === 'inventory') await mutate(); return inventory(); };
  await assert.rejects(execution({ database: wrapped, inventory: tools }).executeOperation(user, f.command), deny('OPERATION_CONFIRMATION_CHANGED'));
  assert.equal((await business(f.op.operationId)).length, replay ? 1 : 0); assert.equal((await receipts(f.op.rootRunId)).length, replay ? 1 : 0);
 });
});
test('retry receipt validates historical source authority and strict old approval independently of current approval', async () => {
 const f = await approved(); const first = await execution().executeOperation(user, f.command), r = await retry(f), request = { ...f.request, runId: r.data.runId };
 const fresh = await decisions().readForConfirmation(user, request); await decisions().decideOperation(user, { ...request, confirmationHash: fresh.confirmationHash, decision: 'approve' });
 const command = { ...request, confirmationHash: fresh.confirmationHash }, decision = (await rows(f.op.rootRunId)).find(row => row.harnessToolEventId === f.view.decisionId)!, input: any = decision.input;
 const basis = input.basis;
 for (const patch of [{ status: 'rejected' }, { eventType: 'confirmation' }, { actionId: null }, { output: {} }, { errorMessage: 'bad' },
  { input: { ...input, actorId: randomUUID() } }, { input: { ...input, decision: 'reject' } }, { input: { ...input, extra: true } },
  { input: { ...input, basis: { ...basis, sessionId: randomUUID() } } }, { input: { ...input, basis: { ...basis, payloadHash: hash('other') } } },
  { input: { ...input, basis: { ...basis, extra: true } } }, { input: { ...input, basis: { ...basis, executionAuthority: [] } } },
  { input: { ...input, basis: { ...basis, identity: { ...basis.identity, status: 'disabled' } } } },
  { input: { ...input, basis: { ...basis, currentToolsHash: 'bad' } } }, { input: { ...input, basis: { ...basis, configRevisions: [] } } }]) {
  await updateEvent(decision.harnessToolEventId, patch); await assert.rejects(execution().executeOperation(user, command), deny());
  assert.equal((await business(f.op.operationId)).length, 1); await updateEvent(decision.harnessToolEventId, decision);
 }
 await control.query("UPDATE harness_tool_events SET resolved_at=created_at + interval '1 microsecond' WHERE harness_tool_event_id=$1", [decision.harnessToolEventId]);
 await assert.rejects(execution().executeOperation(user, command), deny('OPERATION_DECISION_INVALID')); await updateEvent(decision.harnessToolEventId, decision);
 await updateRun(f.command.runId, { executionConfig: { ...(f.run.executionConfig as any), executionAuthority: [] } });
 await assert.rejects(execution().executeOperation(user, command), deny()); await updateRun(f.command.runId, { ...f.run, status: 'failed' });
 assert.deepEqual(await execution().executeOperation(user, command), first); assert.equal((await business(f.op.operationId)).length, 1);
});
test('rollback of first INSERT releases the SQL waiter to win and commit exactly one business row', async () => {
 const f = await approved(), entered = deferred(), release = deferred(); let pid = 0;
 const work = execution({ adapters: new Map([[native.name, { kind: 'local-transaction', async execute(tx: any, input: any) {
  await adapter.execute(tx, input); pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid); entered.resolve();
  await bounded(release.promise); throw new Error('rollback winner');
 } }]]) }).executeOperation(user, f.command).then(value => ({ value }), error => ({ error }));
 let waiter: Promise<any> | undefined;
 try { await bounded(entered.promise); waiter = execution({ database: alternate }).executeOperation(user, f.command); await bounded(blockedBy(pid)); }
 finally { release.resolve(); await Promise.allSettled([work, ...(waiter ? [waiter] : [])]); }
 assert.ok('error' in await work); assert.equal((await waiter).status, 'succeeded');
 assert.equal((await business(f.op.operationId)).length, 1); assert.equal((await receipts(f.op.rootRunId)).length, 1);
});
test('DB lock order linearizes write-before-revoke and revoke-before-write without undoing a committed effect', async () => {
 const first = await approved(), entered = deferred(), release = deferred(); let pid = 0;
 const work = execution({ adapters: new Map([[native.name, { kind: 'local-transaction', async execute(tx: any, input: any) {
  const result = await adapter.execute(tx, input); pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid); entered.resolve(); await bounded(release.promise); return result;
 } }]]) }).executeOperation(user, first.command);
 let revoke: Promise<any> | undefined;
 try { await bounded(entered.promise); revoke = control.query("UPDATE users SET status='disabled' WHERE user_id=$1", [user.id]); await bounded(blockedBy(pid)); }
 finally { release.resolve(); await Promise.allSettled([work, ...(revoke ? [revoke] : [])]); }
 try {
  assert.equal((await work).status, 'succeeded'); await revoke;
  await assert.rejects(execution().executeOperation(user, first.command), deny('EXECUTION_AUTHORITY_CHANGED'));
  assert.equal((await business(first.op.operationId)).length, 1); assert.equal((await receipts(first.op.rootRunId)).length, 1);
 } finally { await updateUser({ status: 'active' }); }
 const second = await approved(), client = await control.connect(); let outcome: Promise<any> | undefined;
 try {
  await client.query('BEGIN'); await client.query("UPDATE users SET status='disabled' WHERE user_id=$1", [user.id]);
  const holder = Number((await client.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  outcome = execution().executeOperation(user, second.command).then(value => ({ value }), error => ({ error }));
  await bounded(blockedBy(holder)); await client.query('COMMIT');
  assert.ok('error' in await outcome); assert.equal((await business(second.op.operationId)).length, 0); assert.equal((await receipts(second.op.rootRunId)).length, 0);
 } finally { await client.query('ROLLBACK'); client.release(); await outcome; await updateUser({ status: 'active' }); }
});
test('new configuration confirmation can approve replay while retaining the original microsecond-stamped approval and receipt', async () => {
 await revision('toolPolicy', async () => {
  await control.query("UPDATE system_configs SET effective_at='2026-11-03T00:00:00.000001Z' WHERE config_key='toolPolicy'");
  const f = await approved(), first = await execution().executeOperation(user, f.command), receipt = await receipts(f.op.rootRunId);
  await control.query("UPDATE system_configs SET effective_at='2026-11-03T00:00:00.000002Z' WHERE config_key='toolPolicy'");
  await assert.rejects(execution().executeOperation(user, f.command), deny('OPERATION_CONFIRMATION_CHANGED'));
  const view = await decisions().readForConfirmation(user, f.request), command = { ...f.request, confirmationHash: view.confirmationHash };
  assert.notEqual(command.confirmationHash, f.command.confirmationHash);
  await assert.rejects(execution().executeOperation(user, command), deny('OPERATION_APPROVAL_REQUIRED'));
  await decisions().decideOperation(user, { ...command, decision: 'approve' });
  assert.deepEqual(await execution().executeOperation(user, command), first); assert.deepEqual(await receipts(f.op.rootRunId), receipt);
  assert.equal((await business(f.op.operationId)).length, 1);
 });
});
