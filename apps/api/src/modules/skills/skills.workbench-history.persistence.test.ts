import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry, HarnessFaultInjectedError } from '../harness/harness-runtime.worker';
import { createBusinessSkillsWorkflow } from '../harness/business-skills.workflow';
import { createBusinessSkillsWorkflowExecutor } from '../harness/business-skills.workflow-host';
import { createBusinessSkillsWaitService } from '../harness/business-skills.wait';
import { createSkillOperationDecisionService } from './skills.operation-decisions';
import { createBusinessSkillOperationWaitService } from '../harness/business-skills.operation-wait';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createSkillReleaseRepository } from './skills-release.repository';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createExecutionAuthority } from './execution-authority';
import { createBusinessExecutionProjectionService } from './skills.workbench-projection';
import { skillToolContract } from './skills.context';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { buildCreateProjectTool } from '../../agent/tools/mutation.tools';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from './skills.types';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import type { RuntimeContext } from '../../agent/context/context.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 2000 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `timeline-history-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username };
const payload = { type: 'object', properties: { projectName: { type: 'string' } }, required: ['projectName'], additionalProperties: false };
let reads = 0;
const nativeRuntimes: Array<RuntimeContext | undefined> = [];
const write = { ...buildCreateProjectTool(async () => { assert.fail('Native write must never dispatch'); }), source: 'code' as const };
const read = { name: 'workflow_read', description: 'Safe local read', parameters: payload, source: 'code' as const, sandboxReadSafe: true,
 mutates: false, exfiltrates: false, capability: 'estimates:read' as const,
 async execute(_args: unknown, _user: unknown, runtime?: RuntimeContext) { reads++; nativeRuntimes.push(runtime); return { found: true }; } };
const tools = [write, read]; let currentTools = tools;
const inventory = async () => ({ registry: { get: (name: string) => currentTools.find(t => t.name === name) }, tools: currentTools,
 policy: { schemaVersion: 1, policies: {} } }) as any;
const contracts = () => tools.map(tool => ({ ...skillToolContract(tool), source: 'code', capability: tool.capability,
 sandboxReadSafe: tool.sandboxReadSafe === true, requiresConfirmation: tool.mutates, policy: DEFAULT_TOOL_POLICY_ENTRY, allowedRoles: ['pre_sales'] }));
const definition: SkillDefinition = { name: 'Workflow child', description: '', category: 'test', instructions: 'Frozen child instructions', roles: ['pre_sales'],
 inputSchema: payload, outputSchema: payload, tools: [{ toolName: read.name, inputMapping: { projectName: '$.projectName' }, requiresConfirmation: false }],
 references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const loadSkillContext = async (d: SkillDefinition) => ({ tools: d.tools.map(t => tools.find(n => n.name === t.toolName)), snapshot: {
 schemaVersion: 1, references: [], tools: d.tools.map(t => { const n = tools.find(n => n.name === t.toolName)!;
 return { native: { ...skillToolContract(n), source: 'code', sandboxReadSafe: n.sandboxReadSafe === true, capability: n.capability }, policy: DEFAULT_TOOL_POLICY_ENTRY }; }), roles: ['ADMIN'],
 model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'provider:fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any;
const manifests = createExecutionManifestService({ database, loadSkillContext, loadWorkflowTools: async () => contracts() as any });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
const path = (target: string, source: string) => ({ target, source: { kind: 'path' as const, path: source } });
async function fixture(edit: (d: WorkflowDefinition) => void = () => {}) {
 const skills = createSkillsPgRepository(database); let child = await skills.create(definition, actor);
 child = await skills.mutate(child.skillId, child.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const d: WorkflowDefinition = { name: 'Four nodes', description: '', category: 'test', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
 steps: [{ id: 'child', name: 'Child', type: 'skill', skillId: child.skillId, skillVersionId: child.currentVersionId, inputMapping: [path('projectName', '$.input.projectName')], onFailure: 'fail' },
 { id: 'input', name: 'Input', type: 'userInput', prompt: 'Original question', inputSchema: payload, outputSchema: payload, inputMapping: [path('projectName', '$.steps.child.output.projectName')], onFailure: 'fail' },
 { id: 'confirm', name: 'Confirm', type: 'confirmation', prompt: 'Original confirmation', inputSchema: payload, inputMapping: [path('projectName', '$.steps.input.output.projectName')], onFailure: 'fail' },
 { id: 'direct', name: 'Direct', type: 'tool', toolName: read.name, requiresConfirmation: false, inputMapping: [path('projectName', '$.steps.input.output.projectName')], onFailure: 'fail' }],
 outputMapping: [path('projectName', '$.steps.input.output.projectName')] }; edit(d);
 const workflows = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, releases: createSkillReleaseRepository(database), getTools: async () => contracts() as any, loadSkillContext }), user);
 let root = await workflows.create(d); root = await workflows.validate(root.workflowId, root.revision); root = await workflows.review(root.workflowId, root.revision, 'Test review'); root = await workflows.publish(root.workflowId, root.revision);
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Four nodes', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Four nodes', execution: { kind: 'workflow', workflowId: root.workflowId, input: { projectName: 'Original project' } } });
 return { runId: accepted.data.runId, sessionId, root, child, workflows };
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: user.role, businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id)); await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
 await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 const remaining = await Promise.all([
  database.select({ id: schema.versionRecords.recordId }).from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id)),
  database.select({ id: schema.harnessRuns.harnessRunId }).from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)),
  database.select({ id: schema.aiSessions.sessionId }).from(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)),
  database.select({ id: schema.users.userId }).from(schema.users).where(eq(schema.users.userId, user.id)),
 ]);
 assert.deepEqual(remaining.map(rows => rows.length), [0, 0, 0, 0]);
 console.log('[projection-race cleanup] records=0 runs=0 sessions=0 users=0');
 await pool.end(); await closeDb(); });
const saved = async (runId: string) => (await queue.findRunForOwner(runId, user.id))!;
const checkpoints = (runId: string) => queue.listCheckpointsForRun({ runId });
const events = (runId: string) => queue.listRunEventsAfter({ runId, afterSequence: 0, limit: 500 });
const awaiting = async (runId: string) => (await events(runId)).filter(e => e.eventType.startsWith('workflow.awaiting_')).at(-1)!.payload as any;
const answer = async (f: Awaited<ReturnType<typeof fixture>>, value: unknown) => { const view = await awaiting(f.runId);
 return { runId: f.runId, sessionId: f.sessionId, requestedBy: user.id, actionId: view.actionId, kind: view.kind, stepId: view.stepId, contentHash: view.contentHash, value }; };
function options(counter: { models: number }) {
 return { database, inventory, prepareModel: async (_skill: any, _signal: AbortSignal, ports: any) => ({ transportProvider: 'kimi', async complete(request: any) {
 await ports.beforeDispatch(); counter.models++; assert.equal(request.signal.aborted, false); assert.ok(request.model.maxTokens <= 100); assert.ok(request.model.timeoutMs <= 1000);
 return { provider: 'kimi', model: 'fixed', usage: { outputTokens: 2 }, ...(request.toolResults.length ? { output: request.input } : { toolCalls: [{ id: 'read1', name: read.name, arguments: request.input }] }) };
 } }) };
}
async function worker(counter: { models: number }, extra: any = {}) {
 const { hostOptions, ...workerOptions } = extra;
 const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor: createBusinessSkillsWorkflowExecutor({ ...options(counter), ...hostOptions }), createAuthority: () => createExecutionAuthority(database, inventory) })]);
 return createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID(), ...workerOptions }).runNextAttempt();
}
async function recover(runId: string) {
 await database.update(schema.harnessRunAttempts).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(schema.harnessRunAttempts.harnessRunId, runId));
 await database.update(schema.harnessRuns).set({ status: 'queued' }).where(eq(schema.harnessRuns.harnessRunId, runId));
}

import { createSkillRetryService } from './skills.retry';
const retryService = () => createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => assert.fail('No dispatch during retry preparation') }) });
const projection = () => createBusinessExecutionProjectionService({ database, inventory });
test('timeline retains real questions, false confirmation, completed child tools and read-only refresh', async () => {
 const f = await fixture(d => { d.steps[2].branches = [{ when: [{ path: '$.steps.confirm.output.approved', op: 'eq', value: false }], target: '$end' }]; });
 const counter = { models: 0 }; await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { projectName: 'Answered project' })); await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { approved: false })); await worker(counter);
 const counts = async () => [await database.select().from(schema.harnessRunEvents), await database.select().from(schema.harnessToolEvents), await database.select({ messages: schema.aiSessions.messages }).from(schema.aiSessions)];
 const before = await counts(), view = await projection().read(user, f.runId), timeline = view.timeline;
 assert.equal(timeline.coverage, 'complete');
 assert.deepEqual(timeline.entries.filter(e => e.kind === 'stage').map(e => e.stepId), ['child', 'input', 'confirm']);
 const tools = timeline.entries.filter(e => e.kind === 'tool_result'); assert.equal(tools.length, 1);
 assert.equal(tools[0].toolName, read.name); assert.equal(tools[0].runId, f.runId);
 assert.deepEqual(timeline.entries.find(e => e.kind === 'answer')?.content, { projectName: 'Answered project' });
 assert.deepEqual(timeline.entries.find(e => e.kind === 'decision')?.content, { approved: false });
 assert.equal(timeline.entries.find(e => e.kind === 'decision')?.status, 'rejected');
 assert.deepEqual(await projection().read(user, f.runId), view); assert.deepEqual(await counts(), before);
 const encoded = JSON.stringify(timeline); for (const key of ['executionAuthority', 'credentialScope', 'instructions', 'currentToolsHash', 'basis']) assert.equal(encoded.includes(key), false);
 const completed = (await checkpoints(f.runId)).find(cp => (cp.state as any).businessSkills.state.skill?.phase === 'completed')!;
 await database.delete(schema.harnessRunCheckpoints).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, completed.harnessRunCheckpointId));
 const legacy = (await projection().read(user, f.runId)).timeline;
 assert.equal(legacy.coverage, 'partial'); assert.ok(legacy.unavailable.includes('unsupported_history'));
 assert.equal(legacy.entries.filter(e => e.kind === 'tool_result').length, 0);
 assert.ok(legacy.entries.some(e => e.kind === 'result' && e.stepId === 'child'));
 await database.insert(schema.harnessRunCheckpoints).values(completed);
 const summary = await projection().readSummary(user, f.runId);
 await database.update(schema.harnessRunCheckpoints).set({ stateHash: '0'.repeat(64) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, completed.harnessRunCheckpointId));
 await assert.rejects(projection().read(user, f.runId), (e: any) => e.status === 409);
 assert.deepEqual(await projection().readSummary(user, f.runId), summary);
 assert.deepEqual(summary.results.output, view.results.output);
});
test('historical approved result and rejected decision retain exact public shape and ignore unrelated sources', async () => {
 const edit = (d: WorkflowDefinition) => { const direct = d.steps[3]; if (direct.type !== 'tool') throw Error();
 direct.toolName = write.name; direct.requiresConfirmation = true; direct.inputMapping = [path('projectName', '$.input.projectName')]; d.steps = [direct]; d.outputMapping = [path('projectName', '$.input.projectName')]; };
 for (const decision of ['approve', 'reject'] as const) {
  const f = await fixture(edit), counter = { models: 0 }; await worker(counter);
  const waits = createBusinessSkillOperationWaitService({ database, inventory }), prompt = await waits.read(user, f.runId);
  await waits.answer(user, { runId: f.runId, actionId: prompt.actionId, confirmationHash: prompt.confirmationHash, decision }); await worker(counter);
  const unrelated = randomUUID();
  await database.insert(schema.harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: f.runId, effectKey: randomUUID(), eventType: 'business_operation_prepared', status: 'pending', toolName: write.name, input: { sourceRunId: unrelated, parameters: 'PRIVATE unrelated' } });
  const view = await projection().read(user, f.runId), entries = view.timeline.entries;
  assert.equal(entries.find(e => e.kind === 'decision')?.status, decision === 'approve' ? 'approved' : 'rejected');
  assert.equal(entries.filter(e => e.kind === 'tool_result').length, decision === 'approve' ? 1 : 0);
  assert.equal(JSON.stringify(entries).includes('PRIVATE'), false);
  if (decision === 'approve') {
   const [effect] = (await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId))).filter(r => r.eventType === 'business_operation_executed');
   await database.update(schema.harnessToolEvents).set({ output: { ...(effect.output as object), privateEnvelope: true } }).where(eq(schema.harnessToolEvents.harnessToolEventId, effect.harnessToolEventId));
   await assert.rejects(projection().read(user, f.runId), (e: any) => e.status === 409);
   await database.update(schema.harnessToolEvents).set({ output: effect.output }).where(eq(schema.harnessToolEvents.harnessToolEventId, effect.harnessToolEventId));
  }
  const [ledger] = (await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId))).filter(r => r.eventType === 'business_operation_decision');
  const input = structuredClone(ledger.input) as any; input.actorId = randomUUID();
  await database.update(schema.harnessToolEvents).set({ input }).where(eq(schema.harnessToolEvents.harnessToolEventId, ledger.harnessToolEventId));
  await assert.rejects(projection().read(user, f.runId), (e: any) => e.status === 409);
 }
});

test('retry origins keep ancestor successes while an identical failed tail belongs to the new physical run', async () => {
 const f = await fixture(d => { const child = d.steps[0]; d.steps = [child, { ...child, id: 'second', name: 'Second' }]; d.outputMapping = [path('projectName', '$.steps.child.output.projectName')]; });
 const counter = { models: 0 };
 const failingModel = async (skill: any, _signal: AbortSignal, ports: any) => ({ transportProvider: 'kimi', async complete(request: any) {
  await ports.beforeDispatch(); counter.models++;
  return { provider: 'kimi', model: 'fixed', usage: { outputTokens: 2 }, ...(skill.stepId === 'second' ? { output: { wrong: true } }
   : request.toolResults.length ? { output: request.input } : { toolCalls: [{ id: 'read1', name: read.name, arguments: request.input }] }) };
 } });
 await worker(counter, { hostOptions: { prepareModel: failingModel } }); assert.equal((await saved(f.runId)).status, 'failed');
 const child = (await retryService().retryInvocation(user, f.runId, { submissionKey: randomUUID(), reason: 'Try same failure' })).data.runId;
 await worker(counter, { hostOptions: { prepareModel: failingModel } }); assert.equal((await saved(child)).status, 'failed');
 const timeline = (await projection().read(user, child)).timeline;
 assert.equal(timeline.entries.find(e => e.kind === 'result' && e.stepId === 'child')?.runId, f.runId);
 assert.equal(timeline.entries.find(e => e.kind === 'tool_result' && e.stepId === 'child')?.runId, f.runId);
 assert.equal(timeline.entries.find(e => e.kind === 'failure' && e.stepId === 'second')?.runId, child);
 const next = (await retryService().retryInvocation(user, child, { submissionKey: randomUUID(), reason: 'Repair failure' })).data.runId;
 await worker(counter); assert.equal((await saved(next)).status, 'completed');
 const final = (await projection().read(user, next)).timeline;
 assert.equal(final.entries.find(e => e.kind === 'result' && e.stepId === 'child')?.runId, f.runId);
 assert.equal(final.entries.find(e => e.kind === 'result' && e.stepId === 'second')?.runId, next);
 assert.equal(final.entries.find(e => e.kind === 'tool_result' && e.stepId === 'second')?.runId, next);
 // Exact source proof and whole ancestor identity remain mandatory, even after successful completion.
 const source = (await queue.getRunSnapshot(f.runId))!;
 await database.update(schema.harnessRunCheckpoints).set({ stateHash: '0'.repeat(64) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, source.checkpoint!.harnessRunCheckpointId));
 await assert.rejects(projection().read(user, next), (e: any) => e.status === 409);
});
test('retry preserves the ancestor answer and attributes the new false confirmation to the child run', async () => {
 const f = await fixture(d => { d.steps[2].branches = [{ when: [{ path: '$.steps.confirm.output.approved', op: 'eq', value: false }], target: '$end' }]; });
 const counter = { models: 0 }; await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { projectName: 'Ancestor answer' })); await worker(counter);
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 const child = (await retryService().retryInvocation(user, f.runId, { submissionKey: randomUUID(), reason: 'Resume confirmation' })).data.runId;
 await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer({ ...f, runId: child }, { approved: false })); await worker(counter);
 const timeline = (await projection().read(user, child)).timeline;
 assert.equal(timeline.entries.find(e => e.kind === 'answer')?.runId, f.runId);
 assert.deepEqual(timeline.entries.find(e => e.kind === 'answer')?.content, { projectName: 'Ancestor answer' });
 assert.equal(timeline.entries.find(e => e.kind === 'decision')?.runId, child);
 assert.equal(timeline.entries.find(e => e.kind === 'decision')?.status, 'rejected');
 await database.update(schema.harnessRuns).set({ aiSessionId: randomUUID() }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await assert.rejects(projection().read(user, child), (e: any) => e.status === 409);
});
test('a retry with tools from two physical runs omits group provenance instead of using the completion run', async () => {
 const f = await fixture(d => { d.steps = [d.steps[0]]; d.outputMapping = [path('projectName', '$.steps.child.output.projectName')]; });
 const counter = { models: 0 }, before = reads;
 const prepareModel = async (_skill: any, _signal: AbortSignal, ports: any) => ({ transportProvider: 'kimi', async complete(request: any) {
  await ports.beforeDispatch(); counter.models++;
  return { provider: 'kimi', model: 'fixed', usage: { outputTokens: 2 }, ...(request.toolResults.length ? { output: request.input }
   : { toolCalls: ['read1', 'read2'].map(id => ({ id, name: read.name, arguments: request.input })) }) };
 } });
 await worker(counter, { hostOptions: { prepareModel }, faultInjector(_step: string, phase: string) {
  if (phase === 'beforeStep' && reads === before + 1) throw new HarnessFaultInjectedError('Stop after first physical tool');
 } });
 await database.update(schema.harnessRunAttempts).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(schema.harnessRunAttempts.harnessRunId, f.runId));
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 const child = (await retryService().retryInvocation(user, f.runId, { submissionKey: randomUUID(), reason: 'Resume mixed tools' })).data.runId;
 const pending = (await projection().read(user, child)).timeline;
 assert.equal(pending.entries.find(e => e.kind === 'tool_result')?.runId, f.runId);
 await worker(counter, { hostOptions: { prepareModel } }); assert.equal((await saved(child)).status, 'completed');
 const final = (await projection().read(user, child)).timeline, tools = final.entries.filter(e => e.kind === 'tool_result');
 assert.equal(tools.length, 2); assert.equal(tools.every(e => !('runId' in e)), true);
 assert.equal(final.coverage, 'partial'); assert.ok(final.unavailable.includes('receipt_origin_missing'));
 assert.equal(final.entries.find(e => e.kind === 'result')?.runId, child); assert.equal(reads, before + 2);
});

for (const readMode of ['read', 'readSummary'] as const) test(`${readMode}: a decision-only race with unchanged checkpoint returns the approved current action`, async () => {
 const f = await fixture(d => { const direct = d.steps[3]; if (direct.type !== 'tool') throw Error();
 direct.toolName = write.name; direct.requiresConfirmation = true; direct.inputMapping = [path('projectName', '$.input.projectName')]; d.steps = [direct]; d.outputMapping = [path('projectName', '$.input.projectName')]; });
 const counter = { models: 0 }; await worker(counter);
 const waits = createBusinessSkillOperationWaitService({ database, inventory }), prompt = await waits.read(user, f.runId), cp = (await saved(f.runId)).lastCheckpointId;
 let changed = false;
 const view = await createBusinessExecutionProjectionService({ database, inventory: async () => {
  if (!changed) { changed = true; await createSkillOperationDecisionService({ database, inventory }).decideOperation(user,
   { runId: f.runId, operationId: prompt.operationId, confirmationHash: prompt.confirmationHash, decision: 'approve' }); }
  return inventory();
 } })[readMode](user, f.runId);
 assert.equal((await saved(f.runId)).lastCheckpointId, cp); assert.equal((await saved(f.runId)).status, 'waiting');
 assert.equal(view.pendingOperation?.status, 'approved');
 if (readMode === 'read') {
  assert.ok('timeline' in view);
  assert.equal(view.timeline.entries.find(e => e.kind === 'decision')?.status, 'approved');
 } else assert.equal('timeline' in view, false);
 const summary = await projection().readSummary(user, f.runId);
 assert.deepEqual(summary.pendingOperation, view.pendingOperation); assert.equal('timeline' in summary, false);
});

test('summary refresh handles operation completion and cancellation during unlocked inventory without a stale approval', async () => {
 for (const change of ['complete', 'cancel'] as const) {
  const f = await fixture(d => { const direct = d.steps[3]; if (direct.type !== 'tool') throw Error();
   direct.toolName = write.name; direct.requiresConfirmation = true; direct.inputMapping = [path('projectName', '$.input.projectName')];
   d.steps = [direct]; d.outputMapping = [path('projectName', '$.input.projectName')]; });
  const counter = { models: 0 }; await worker(counter);
  const waits = createBusinessSkillOperationWaitService({ database, inventory }), prompt = await waits.read(user, f.runId);
  let calls = 0;
  const service = createBusinessExecutionProjectionService({ database, readHistory: async () => assert.fail('No history for summary'), inventory: async () => {
   calls++;
   if (change === 'complete') {
    await waits.answer(user, { runId: f.runId, actionId: prompt.actionId, confirmationHash: prompt.confirmationHash, decision: 'approve' });
    await worker(counter);
   } else await database.update(schema.harnessRuns).set({ cancelRequestedAt: new Date() }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
   return inventory();
  } });
  const view = await service.readSummary(user, f.runId);
  assert.equal(calls, 1); assert.equal(view.pendingOperation, undefined); assert.equal(view.pendingInput, undefined);
  if (change === 'complete') {
   assert.equal((await saved(f.runId)).status, 'completed');
   assert.deepEqual(view.results.output, (await projection().read(user, f.runId)).results.output);
  } else assert.ok((await saved(f.runId)).cancelRequestedAt);
 }
});

test('summary fails closed on DB revocation during inventory and retries a moving current Run at most once', async () => {
 for (const change of ['revoke', 'move'] as const) {
  const f = await fixture(d => { const direct = d.steps[3]; if (direct.type !== 'tool') throw Error();
   direct.toolName = write.name; direct.requiresConfirmation = true; direct.inputMapping = [path('projectName', '$.input.projectName')];
   d.steps = [direct]; d.outputMapping = [path('projectName', '$.input.projectName')]; });
  await worker({ models: 0 }); let calls = 0;
  const service = createBusinessExecutionProjectionService({ database, readHistory: async () => assert.fail('No history for summary'), inventory: async () => {
   calls++;
   if (change === 'revoke') await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
   else await database.update(schema.harnessRuns).set({ status: calls === 1 ? 'queued' : 'running' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
   return inventory();
  } });
  try {
   await assert.rejects(service.readSummary(user, f.runId), (e: any) => e.status === (change === 'revoke' ? 403 : 409));
   assert.equal(calls, change === 'revoke' ? 1 : 2);
  } finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
 }
});
