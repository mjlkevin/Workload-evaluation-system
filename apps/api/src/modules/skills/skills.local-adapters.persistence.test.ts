import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createSkillLocalTransactionAdapters } from './skills.local-adapters';
import { buildCreateProjectTool } from '../../agent/tools/mutation.tools';
import { createProjectEvaluationForUser, listProjectEvaluationsForUser, getProjectEvaluationForUser } from '../project-evaluations/project-evaluations.usecase';
import { closeDb } from '../../db/client';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillRetryService } from './skills.retry';
import { createSkillOperationService } from './skills.operations';
import { createSkillOperationDecisionService } from './skills.operation-decisions';
import { createSkillOperationExecutionService, type SkillLocalTransactionAdapter } from './skills.operation-execution';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
const fixtureId = randomUUID(), prefix = `SKILL-${fixtureId}`;
const url = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: url, max: 1, application_name: 'wes-execution-main', connectionTimeoutMillis: 1000 });
const control = new Pool({ connectionString: url, max: 3, application_name: 'wes-execution-control' });
const database = drizzle(pool, { schema }), alternate = drizzle(control, { schema });
const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `operation-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const tool = buildCreateProjectTool(() => { throw new Error('NO NATIVE EXECUTE'); });
const payload = { ...tool.parameters, additionalProperties: false };
const native = { name: tool.name, description: tool.description, capability: tool.capability, mutates: true, parameters: payload, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true };
const second = { ...native, name: 'operation_other' }, ask = { ...native, name: 'ask_user', mutates: false };
const definition: SkillDefinition = { name: 'Operation fixture', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'],
 inputSchema: payload, outputSchema: payload, tools: [native, second].map(t => ({ toolName: t.name, inputMapping: { projectName: '$.projectName', customerName: '$.customerName', industry: '$.industry' }, requiresConfirmation: true })),
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
 const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Frozen request', execution: { kind: 'skill', skillId: root.skillId, input: { projectName: 'Adapter project', customerName: 'Customer', industry: 'Manufacturing' } } });
 return { root, sessionId, run: await persisted(accepted.data.runId), body: { runId: accepted.data.runId, stepId: '$skill', ordinal: 0, toolName: patch.tools?.[0]?.toolName ?? native.name, parameters: { projectName: 'Adapter project', customerName: 'Customer', industry: 'Manufacturing' } } };
}
async function retry(f: Awaited<ReturnType<typeof fixture>>) {
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
 return createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { throw new Error('NO MODEL DISPATCH'); } }) }).retryInvocation(user, f.run.harnessRunId, { submissionKey: randomUUID(), reason: 'Explicit retry' });
}
before(async () => {
 const now = new Date();
 // Owned rows only; this file is a serial-store writer because these sources are global.
 await database.insert(schema.versionCodeRules).values({ ruleId: fixtureId, moduleKey: 'global', moduleName: 'Fixture', moduleCode: 'GL', prefix,
  format: '{PREFIX}-{NNN}', status: 'active', sortOrder: -2147483648, updatedAt: now });
 await database.insert(schema.productTemplates).values({ templateId: fixtureId, templateVersion: '1', templateName: 'Fixture', createdAt: now, updatedAt: now });
 for (const table of [schema.productLines, schema.productSkus, schema.productModules]) await database.insert(table).values({ id: fixtureId, name: fixtureId, createdAt: now, updatedAt: now });
 await database.insert(schema.productSkuModuleAssignments).values(['active', 'inactive'].map(status => ({ id: `${fixtureId}-${status}`, templateId: fixtureId, productId: fixtureId, skuId: fixtureId,
  moduleId: status === 'active' ? null : fixtureId, templateItemId: status, groupId: 'fixture', groupName: 'Fixture', itemName: status, deliveryPoint: 'Delivery', deliveryDesc: 'Description', evalDesc: 'Evaluation',
  standardDays: status === 'active' ? 7.5 : 99, status: status as 'active' | 'inactive', createdAt: now, updatedAt: now })));
 await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
 assert.equal(Number((await pool.query('SELECT count(*) n FROM version_records WHERE owner_user_id=$1', [user.id])).rows[0].n), 0); await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 assert.equal(Number((await pool.query('SELECT count(*) n FROM harness_runs WHERE owner_user_id=$1', [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM ai_sessions WHERE owner_user_id=$1', [user.id])).rows[0].n), 0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM users WHERE user_id=$1', [user.id])).rows[0].n), 0);
 // Published Skill revisions are immutable audit evidence and intentionally retained.
 await database.delete(schema.versionCodeRules).where(eq(schema.versionCodeRules.ruleId, fixtureId));
 await database.delete(schema.productSkuModuleAssignments).where(eq(schema.productSkuModuleAssignments.templateId, fixtureId));
 await database.delete(schema.productTemplates).where(eq(schema.productTemplates.templateId, fixtureId));
 for (const table of [schema.productLines, schema.productSkus, schema.productModules]) await database.delete(table).where(eq(table.id, fixtureId));
 await closeDb(); await pool.end(); await control.end(); });
const decisions = (extra: any = {}) => createSkillOperationDecisionService({ database, inventory, ...extra });
const deny = (code?: string) => (e: any) => e.status >= 400 && (!code || e.code === code);
async function pending() { const f = await fixture(), op = await service().prepareOperation(user, f.body); return { ...f, op, request: { runId: f.run.harnessRunId, operationId: op.operationId } }; }
async function approve(f: Awaited<ReturnType<typeof pending>>, extra: any = {}) {
 const view = await decisions(extra).readForConfirmation(user, f.request);
 return decisions(extra).decideOperation(user, { ...f.request, confirmationHash: view.confirmationHash, decision: 'approve' });
}
const adapters = () => createSkillLocalTransactionAdapters();
const execution = (extra: any = {}) => createSkillOperationExecutionService({ database, inventory, adapters: adapters(), ...extra });
const business = () => database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
const receipts = async (root: string) => (await rows(root)).filter(r => r.eventType === 'business_operation_executed');
async function approved() { const f = await pending(), view = await approve(f); return { ...f, view, command: { ...f.request, confirmationHash: view.confirmationHash } }; }

test('approved create_project writes a normal project draft using current owner, trusted session, snapshot and version rules', async () => {
 const f = await approved();
 await database.update(schema.users).set({ username: user.username + '-current' }).where(eq(schema.users.userId, user.id));
 try {
  const first = await execution().executeOperation(user, f.command), result = first.result as any;
  assert.equal(result.projectName, 'Adapter project'); assert.equal(result.ownerUsername, user.username + '-current');
  assert.equal(result.createdFromSessionId, f.sessionId); assert.equal(result.currentStage, 'project_discovery'); assert.equal(result.status, 'draft');
  assert.deepEqual(await execution().executeOperation(user, f.command), first);
  const records = (await business()).filter(r => r.recordId === result.projectId); assert.equal(records.length, 1);
  const row = records[0], p = row.payload as any;
  assert.equal(row.type, 'global'); assert.equal(row.templateId, 'project-evaluation'); assert.equal(row.ownerUserId, user.id);
  assert.equal(row.createdByUserId, user.id); assert.equal(row.updatedByUsername, user.username + '-current'); assert.equal(row.status, 'draft');
  assert.equal(row.checkoutStatus, 'checked_in'); assert.equal(row.versionDocStatus, 'drafting'); assert.equal(row.majorLetter, 'A'); assert.equal(row.minorNumber, 0);
  assert.equal(row.baseCode, row.versionCode); assert.equal(row.isHistoricalArchive, false); assert.deepEqual(row.lastCheckinPayload, {});
  assert.equal(p.recordKind, 'project_evaluation'); assert.equal(p.totalDays, 0); assert.equal(p.projectStatus, 'draft');
  assert.ok(p.productMasterSnapshot.capturedAt); assert.ok(Array.isArray(p.productMasterSnapshot.assignments));
  assert.ok(row.versionCode.startsWith(prefix + '-')); assert.ok(!row.versionCode.includes('{'));
  const active = p.productMasterSnapshot.assignments.filter((a: any) => a.productId === fixtureId);
  assert.equal(active.length, 1); assert.deepEqual(active[0], { productId: fixtureId, productName: fixtureId, skuId: fixtureId, skuName: fixtureId,
   moduleId: null, moduleName: '', standardDays: 7.5, deliveryPoint: 'Delivery', deliveryDesc: 'Description', evalDesc: 'Evaluation', templateItemId: 'active' });
  assert.equal((await receipts(f.op.rootRunId)).length, 1);
  assert.equal((await getProjectEvaluationForUser(user, result.projectId))?.projectName, result.projectName);
  assert.ok((await listProjectEvaluationsForUser(user)).some(p => p.projectId === result.projectId));
 } finally { await database.update(schema.users).set({ username: user.username }).where(eq(schema.users.userId, user.id)); }
});

test('only create_project is explicitly assembled; no default service grant or native dispatch', async () => {
 assert.deepEqual([...adapters().keys()], ['create_project']); const f = await approved(), count = (await business()).length;
 await assert.rejects(execution({ adapters: undefined }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_TOOL_DENIED'));
 assert.equal((await business()).length, count); assert.equal((await receipts(f.op.rootRunId)).length, 0);
});
test('parameter whitelist rejects authority, source, totals, unknown properties and illegal shapes before writes', async () => {
 const adapter = adapters().get('create_project')!, count = (await business()).length;
 const base = { operationId: randomUUID(), ownerId: user.id, sessionId: randomUUID() };
 const bad: unknown[] = [null, [], 'name', {}, { projectName: '' }, { projectName: '  ' }, { projectName: 10 }, { projectName: 'x', customerName: null }, { projectName: 'x', industry: [] },
  ...['ownerId', 'ownerUserId', 'id', 'recordId', 'status', 'currentStage', 'createdByUsername', 'createdFromSessionId', 'totalDays', 'productMasterSnapshot', 'unknown'].map(key => ({ projectName: 'x', [key]: 'forged' })),
  JSON.parse('{"projectName":"x","__proto__":{}}'), { projectName: 'x', [Symbol('bad')]: 1 }, Object.create({ projectName: 'x' })];
 let getters = 0; bad.push(Object.defineProperty({}, 'projectName', { enumerable: true, get() { getters++; return 'x'; } }));
 for (const parameters of bad) await assert.rejects(database.transaction(tx => adapter.execute(tx, { ...base, parameters })), deny('OPERATION_PARAMETERS_INVALID'));
 assert.equal(getters, 0); assert.equal((await business()).length, count);
});
test('trusted session overrides source only through context; current DB username and normal creation semantics are shared', async () => {
 const sessionId = randomUUID(), adapter = adapters().get('create_project')!;
 const project = await database.transaction(tx => adapter.execute(tx, { operationId: randomUUID(), ownerId: user.id, sessionId,
  parameters: { projectName: '  Whitespace project  ', customerName: '  Customer  ', industry: '  Industry  ' } })) as any;
 assert.equal(project.createdFromSessionId, sessionId); assert.equal(project.projectName, 'Whitespace project'); assert.equal(project.customerName, 'Customer');
 const normal = await createProjectEvaluationForUser({ ...user, username: 'stale-request' }, { projectName: 'Normal project', currentStage: 'custom', totalDays: 12, createdFromSessionId: sessionId });
 assert.equal(normal.ownerUsername, user.username); assert.equal(normal.currentStage, 'custom'); assert.equal(normal.createdFromSessionId, sessionId);
 const normalRow = (await business()).find(r => r.recordId === normal.projectId)!;
 assert.equal((normalRow.payload as any).totalDays, 12); assert.ok(normal.versionCode.startsWith(prefix + '-'));
 const defaultProject = await createProjectEvaluationForUser(user, {}); assert.equal(defaultProject.projectName, '新项目评估'); assert.equal(defaultProject.currentStage, 'project_discovery');
});
test('callback exception after a real project insert rolls back both project and execution receipt', async () => {
 const f = await approved(), count = (await business()).length, adapter = adapters().get('create_project')!;
 const throwing: SkillLocalTransactionAdapter = { kind: 'local-transaction', async execute(tx, input) {
  const result = await adapter.execute(tx, input) as any;
  assert.equal((await tx.select().from(schema.versionRecords).where(eq(schema.versionRecords.recordId, result.projectId))).length, 1);
  throw new Error('CALLBACK_FAILURE_AFTER_PROJECT_INSERT');
 } };
 await assert.rejects(execution({ adapters: new Map([['create_project', throwing]]) }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_UNAVAILABLE'));
 assert.equal((await business()).length, count); assert.equal((await receipts(f.op.rootRunId)).length, 0);
 await execution().executeOperation(user, f.command); assert.equal((await business()).length, count + 1);
});
test('execution receipt update failure rolls back the real project insert', async () => {
 const f = await approved(), count = (await business()).length, wrapped = Object.create(database); let inserts = 0;
 wrapped.transaction = (callback: any, settings: any) => database.transaction(tx => callback(new Proxy(tx, { get(target, key) {
  if (key === 'update') return (table: any) => { const builder = target.update(table); return new Proxy(builder, { get(b, prop) {
   if (prop === 'set') return (values: any) => { if (table === schema.harnessToolEvents && values.status === 'succeeded') { inserts++; throw new Error('RECEIPT_UPDATE_FAILED'); } return b.set(values); };
   const value = (b as any)[prop]; return typeof value === 'function' ? value.bind(b) : value;
  } }); };
  const value = (target as any)[key]; return typeof value === 'function' ? value.bind(target) : value;
 } })), settings);
 await assert.rejects(execution({ database: wrapped }).executeOperation(user, f.command), deny('OPERATION_EXECUTION_UNAVAILABLE'));
 assert.equal(inserts, 1); assert.equal((await business()).length, count); assert.equal((await receipts(f.op.rootRunId)).length, 0);
});
test('retry approval reuses the same committed project and receipt', async () => {
 const f = await approved(), first = await execution().executeOperation(user, f.command), count = (await business()).length;
 const retried = await retry(f), run = await persisted(retried.data.runId), op = await service().prepareOperation(user, { ...f.body, runId: run.harnessRunId });
 assert.equal(op.operationId, f.op.operationId);
 const request = { runId: run.harnessRunId, operationId: op.operationId }, view = await decisions().readForConfirmation(user, request);
 await assert.rejects(execution().executeOperation(user, { ...request, confirmationHash: view.confirmationHash }), deny('OPERATION_APPROVAL_REQUIRED'));
 await decisions().decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
 assert.deepEqual(await execution().executeOperation(user, { ...request, confirmationHash: view.confirmationHash }), first);
 assert.equal((await business()).length, count); assert.equal((await receipts(f.op.rootRunId)).length, 1);
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(work: Promise<T>): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('project allocation timeout')), 8000); })]); }
 finally { if (timer) clearTimeout(timer); }
}
test('two operation IDs and ordinary creation share the owner lock and allocate three unique rule codes', async () => {
 const first = await approved(), second = await approved(), entered = deferred(), release = deferred(), adapter = adapters().get('create_project')!;
 let pid = 0;
 const held: SkillLocalTransactionAdapter = { kind: 'local-transaction', async execute(tx, input) {
  const result = await adapter.execute(tx, input); pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
  entered.resolve(); await release.promise; return result;
 } };
 const a = execution({ database: alternate, adapters: new Map([['create_project', held]]) }).executeOperation(user, first.command);
 let b: Promise<any> | undefined, c: Promise<any> | undefined;
 try {
  await bounded(entered.promise);
  b = execution().executeOperation(user, second.command); c = createProjectEvaluationForUser(user, { projectName: 'Concurrent ordinary project' });
  await bounded((async () => { for (let attempt = 0; attempt < 500; attempt++) {
   const waiters = await control.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))", [pid]);
   if (Number(waiters.rows[0].n) >= 2) return; await new Promise(r => setTimeout(r, 10));
  } throw new Error('expected two real owner-lock waiters'); })());
 } finally { release.resolve(); }
 const results = await bounded(Promise.all([a, b!, c!]));
 const projects = [results[0].result, results[1].result, results[2]], codes = projects.map(p => p.versionCode);
 assert.equal(new Set(codes).size, 3); assert.equal(new Set(projects.map(p => p.projectId)).size, 3);
 assert.ok(codes.every(code => code.startsWith(prefix + '-') && !code.includes('{')));
 for (const p of projects) assert.ok(await getProjectEvaluationForUser(user, p.projectId));
});

test('all creation reads use caller transaction state and an outer rollback leaves no project or source changes', async () => {
 const count = (await business()).length, adapter = adapters().get('create_project')!;
 await assert.rejects(database.transaction(async tx => {
  await tx.update(schema.users).set({ username: 'uncommitted-owner' }).where(eq(schema.users.userId, user.id));
  await tx.update(schema.versionCodeRules).set({ prefix: 'UNCOMMITTED' }).where(eq(schema.versionCodeRules.ruleId, fixtureId));
  await tx.update(schema.productSkuModuleAssignments).set({ standardDays: 17 }).where(eq(schema.productSkuModuleAssignments.id, `${fixtureId}-active`));
  const result = await adapter.execute(tx, { operationId: randomUUID(), ownerId: user.id, sessionId: randomUUID(), parameters: { projectName: 'Transaction-only project' } }) as any;
  assert.equal(result.ownerUsername, 'uncommitted-owner'); assert.equal(result.versionCode, 'UNCOMMITTED-001');
  const [row] = await tx.select().from(schema.versionRecords).where(eq(schema.versionRecords.recordId, result.projectId));
  assert.equal((row.payload as any).productMasterSnapshot.assignments.find((a: any) => a.productId === fixtureId).standardDays, 17);
  throw new Error('OUTER_ROLLBACK');
 }), /OUTER_ROLLBACK/);
 assert.equal((await business()).length, count);
 assert.equal((await database.select().from(schema.users).where(eq(schema.users.userId, user.id)))[0].username, user.username);
 assert.equal((await database.select().from(schema.versionCodeRules).where(eq(schema.versionCodeRules.ruleId, fixtureId)))[0].prefix, prefix);
 assert.equal((await database.select().from(schema.productSkuModuleAssignments).where(eq(schema.productSkuModuleAssignments.id, `${fixtureId}-active`)))[0].standardDays, 7.5);
});

async function withEmptyVersionRules<T>(task: () => Promise<T>): Promise<T> {
 // This suite holds the exclusive test DB lease. Restore exact rows even on a failed RED assertion.
 const saved = await database.transaction(async tx => {
  const snapshot = await tx.select().from(schema.versionCodeRules).orderBy(schema.versionCodeRules.ruleId);
  if (snapshot.length) await tx.delete(schema.versionCodeRules).where(inArray(schema.versionCodeRules.ruleId, snapshot.map(row => row.ruleId)));
  return snapshot;
 });
 try {
  assert.equal((await database.select().from(schema.versionCodeRules)).length, 0);
  return await task();
 } finally {
  if (saved.length) await database.insert(schema.versionCodeRules).values(saved);
  assert.deepEqual(await database.select().from(schema.versionCodeRules).orderBy(schema.versionCodeRules.ruleId), saved);
 }
}
test('ordinary creation on an empty rules table preserves built-in GL date and sequence defaults', async () => {
 await withEmptyVersionRules(async () => {
  const project = await createProjectEvaluationForUser(user, { projectName: 'Empty rules ordinary project' });
  assert.match(project.versionCode, /^GL-\d{8}-\d{3}$/);
  assert.ok(await getProjectEvaluationForUser(user, project.projectId));
  assert.equal((await database.select().from(schema.versionCodeRules)).length, 0);
 });
});
test('approved adapter on an empty rules table uses the same GL defaults without seeding rules', async () => {
 const f = await approved();
 await withEmptyVersionRules(async () => {
  const result = (await execution().executeOperation(user, f.command)).result as any;
  assert.match(result.versionCode, /^GL-\d{8}-\d{3}$/);
  assert.ok(await getProjectEvaluationForUser(user, result.projectId));
  assert.equal((await database.select().from(schema.versionCodeRules)).length, 0);
 });
});
test('nonempty rules without an active global rule preserve the existing UUID fallback', async () => {
 const f = await approved(), ruleId = `${fixtureId}-no-global`;
 await withEmptyVersionRules(async () => {
  await database.insert(schema.versionCodeRules).values({ ruleId, moduleKey: 'dev', moduleName: 'Fixture', moduleCode: 'DV', prefix: 'DV',
   format: '{PREFIX}-{NNN}', status: 'active', sortOrder: 0, updatedAt: new Date() });
  try {
   const normal = await createProjectEvaluationForUser(user, { projectName: 'No global ordinary project' });
   const project = (await execution().executeOperation(user, f.command)).result as any;
   assert.match(normal.versionCode, /^PROJECT-[a-f0-9-]{36}$/); assert.match(project.versionCode, /^PROJECT-[a-f0-9-]{36}$/);
   assert.notEqual(normal.versionCode, project.versionCode);
  } finally { await database.delete(schema.versionCodeRules).where(eq(schema.versionCodeRules.ruleId, ruleId)); }
 });
});
