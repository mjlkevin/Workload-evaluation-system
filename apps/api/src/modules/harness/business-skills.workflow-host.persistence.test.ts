import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from './harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry, HarnessFaultInjectedError } from './harness-runtime.worker';
import { createBusinessSkillsWorkflow } from './business-skills.workflow';
import { startHarnessRuntime } from './harness-boot';
import { createBusinessSkillsWorkflowExecutor } from './business-skills.workflow-host';
import { createBusinessSkillsWaitService } from './business-skills.wait';
import { createBusinessSkillOperationWaitService } from './business-skills.operation-wait';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createSkillReleaseRepository } from '../skills/skills-release.repository';
import { createExecutionManifestService } from '../skills/execution-manifest';
import { createSkillInvocationService } from '../skills/skills.invocation';
import { createInvocationPgRepository } from '../skills/skills.invocation-pg.repository';
import { createSkillsPgRepository } from '../skills/skills-pg.repository';
import { createExecutionAuthority } from '../skills/execution-authority';
import { createExecutionBudgetService } from '../skills/execution-budget';
import { createBusinessExecutionProjectionService } from '../skills/skills.workbench-projection';
import { SkillError } from '../skills/skills.types';
import { skillToolContract } from '../skills/skills.context';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { buildCreateProjectTool } from '../../agent/tools/mutation.tools';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from '../skills/skills.types';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import type { RuntimeContext } from '../../agent/context/context.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 2000 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `workflow-host-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
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
test('real Worker dispatches all four nodes and a fresh service resumes original explicit contracts', async () => {
 const f = await fixture(), counter = { models: 0 }, before = reads, runtimeCount = nativeRuntimes.length; await worker(counter);
 assert.equal((await saved(f.runId)).status, 'waiting'); assert.equal(counter.models, 2); assert.equal(reads, before + 1);
 const all = await checkpoints(f.runId), bootstrap = (all.at(-1)!.state as any).businessSkills.state;
 assert.equal(bootstrap.kind, 'workflow'); assert.deepEqual(bootstrap.workflow.receipts, []); assert.equal(bootstrap.skill, undefined);
 assert.equal((await awaiting(f.runId)).prompt, 'Original question');
 const first = await answer(f, { projectName: 'Answered project' }); await createBusinessSkillsWaitService(database).answer(first); await worker(counter);
 assert.equal((await awaiting(f.runId)).kind, 'confirmation');
 assert.equal((await createBusinessSkillsWaitService(database).answer(first)).created, false);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { approved: true })); await worker(counter);
 assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(counter.models, 2); assert.equal(reads, before + 2);
 assert.deepEqual((await queue.getRunSnapshot(f.runId))!.output!.content, { projectName: 'Answered project' });
 const final = ((await checkpoints(f.runId))[0].state as any).businessSkills.state;
 assert.equal(final.workflow.receipts.length, 4); assert.equal(final.skill, undefined); assert.equal(final.pendingOperation, undefined);
 assert.equal((await createBusinessSkillsWaitService(database).answer(first)).created, false);
 const budget = await createExecutionBudgetService({ database }).readBudget(user.id, f.runId); assert.equal(budget.modelAttempts, 2); assert.equal(budget.toolCalls, 2);
 const contexts = nativeRuntimes.slice(runtimeCount); assert.equal(contexts.length, 2);
 for (const runtime of contexts) {
  assert.equal(runtime?.harnessRunId, f.runId); assert.equal(runtime?.aiSessionId, f.sessionId);
  assert.equal(runtime?.actor.userId, user.id); assert.deepEqual(runtime?.actor.roles, ['ADMIN']);
  assert.equal(runtime?.channel, 'api'); assert.equal(runtime?.workflowKey, 'business_skills_v1');
  assert.equal(runtime?.traceId, f.runId); assert.ok(runtime?.actor.capabilities.includes('estimates:read'));
  assert.notEqual(runtime?.requestId, 'read1');
 }
});
test('persisted model batch resumes with a fresh Worker without repeating the model response', async () => {
 const f = await fixture(), counter = { models: 0 }; let commits = 0;
 await worker(counter, { faultInjector(_step: string, phase: string) { if (phase === 'afterStepCommit' && ++commits === 2) throw new HarnessFaultInjectedError('AFTER MODEL BATCH'); } });
 assert.equal(counter.models, 1); const cursor = ((await checkpoints(f.runId))[0].state as any).businessSkills.state;
 assert.equal(cursor.skill.phase, 'tools'); assert.equal(cursor.workflow.receipts.length, 0);
 await recover(f.runId); await worker(counter); assert.equal(counter.models, 2); assert.equal((await saved(f.runId)).status, 'waiting');
});
test('direct create_project uses explicit decision and the real local transaction adapter once across receipt recovery', async () => {
 const f = await fixture(d => { const tool = d.steps[3]; if (tool.type !== 'tool') throw Error();
 tool.toolName = write.name; tool.requiresConfirmation = true; tool.inputMapping = [path('projectName', '$.input.projectName')]; d.steps = [tool]; d.outputMapping = [path('projectName', '$.input.projectName')]; });
 const counter = { models: 0 }, records = () => database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
 const count = (await records()).length; await worker(counter); assert.equal((await saved(f.runId)).status, 'waiting'); assert.equal((await records()).length, count);
 const waits = () => createBusinessSkillOperationWaitService({ database, inventory }); const view = await waits().read(user, f.runId);
 await assert.rejects(waits().answer(user, { runId: f.runId, actionId: view.actionId, confirmationHash: view.confirmationHash, decision: '好的' } as any));
 const request = { runId: f.runId, actionId: view.actionId, confirmationHash: view.confirmationHash, decision: 'approve' as const };
 await waits().answer(user, request); await waits().answer(user, request);
 const crashing = Object.create(queue); crashing.commitCheckpoint = async (input: any) => {
 if (input.state.businessSkills.state.workflow.receipts.length) throw new HarnessFaultInjectedError('AFTER DIRECT RECEIPT'); return queue.commitCheckpoint(input); };
 await worker(counter, { repository: crashing }); assert.equal((await records()).length, count + 1); await recover(f.runId); await worker(counter);
 assert.equal((await saved(f.runId)).status, 'completed'); assert.equal((await records()).length, count + 1); assert.equal(counter.models, 0);
 const receipts = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
 assert.equal(receipts.filter(r => r.eventType === 'business_operation_executed' && r.status === 'succeeded').length, 1);
});
test('first-match branch and bounded repeat preserve the pure interpreter outcome in real Worker checkpoints', async () => {
 const f = await fixture(d => { d.steps[2].branches = [{ when: [{ path: '$.steps.confirm.output.approved', op: 'eq', value: false }], target: '$end' }]; });
 const counter = { models: 0 }, before = reads; await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { projectName: 'Rejected branch' })); await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { approved: false })); await worker(counter);
 assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(reads, before + 1);
 const repeated = await fixture(d => { d.steps = [d.steps[0]]; d.steps[0].repeat = { while: [{ path: '$.input.projectName', op: 'eq', value: 'Original project' }], maxIterations: 2, onLimit: 'fail' };
 d.outputMapping = [path('projectName', '$.steps.child.output.projectName')]; });
 const repeatCount = { models: 0 }; await worker(repeatCount); assert.equal((await saved(repeated.runId)).status, 'failed'); assert.equal(repeatCount.models, 4);
 const state = ((await checkpoints(repeated.runId))[0].state as any).businessSkills.state;
 assert.equal(state.workflow.receipts.length, 2); assert.notEqual(state.workflow.receipts[0].operationId, state.workflow.receipts[1].operationId);
});
for (const corruption of ['hash', 'step', 'contract']) test(`saved ${corruption} corruption cannot dispatch another model or tool`, async () => {
 const f = await fixture(), counter = { models: 0 }; let commits = 0;
 await worker(counter, { faultInjector(_step: string, phase: string) { if (phase === 'afterStepCommit' && ++commits === 2) throw new HarnessFaultInjectedError('STOP AT BATCH'); } });
 const cp = (await checkpoints(f.runId))[0], state = structuredClone(cp.state) as any, before = reads;
 if (corruption === 'hash') await database.update(schema.harnessRunCheckpoints).set({ stateHash: hash('changed') }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
 if (corruption === 'step') { state.businessSkills.state.skill.stepId = 'direct'; await database.update(schema.harnessRunCheckpoints).set({ state, stateHash: hash(state) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId)); }
 if (corruption === 'contract') currentTools = tools.map(t => t.name === read.name ? { ...t, description: 'Changed contract' } : t);
 try { await recover(f.runId); await worker(counter); assert.equal((await saved(f.runId)).status, 'failed'); assert.equal(counter.models, 1); assert.equal(reads, before); }
 finally { currentTools = tools; }
});
test('release during a wait keeps the old Run frozen while a new Run binds the newly published dependency', async () => {
 const f = await fixture(), counter = { models: 0 }; await worker(counter);
 const oldManifest = (await saved(f.runId)).executionConfig as any;
 const skills = createSkillsPgRepository(database); let replacement = await skills.create({ ...definition, instructions: 'New child instructions' }, actor);
 replacement = await skills.mutate(replacement.skillId, replacement.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 let next = await f.workflows.action(f.root.workflowId, f.root.revision, 'promote'); next = await f.workflows.action(next.workflowId, next.revision, 'checkout');
 const d = structuredClone(next.versions.find(v => v.workflowVersionId === next.currentVersionId)!.definition);
 const child = d.steps[0], question = d.steps[1]; if (child.type !== 'skill' || question.type !== 'userInput') throw Error();
 child.skillId = replacement.skillId; child.skillVersionId = replacement.currentVersionId; question.prompt = 'New question';
 next = await f.workflows.save(next.workflowId, next.revision, d); next = await f.workflows.action(next.workflowId, next.revision, 'checkin');
 next = await f.workflows.validate(next.workflowId, next.revision); next = await f.workflows.review(next.workflowId, next.revision, 'New release'); next = await f.workflows.publish(next.workflowId, next.revision);
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'New release', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const newInvocation = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'New invocation', execution: { kind: 'workflow', workflowId: next.workflowId, input: { projectName: 'New project' } } });
 await worker(counter); const nextManifest = (await saved(newInvocation.data.runId)).executionConfig as any;
 assert.equal((await awaiting(newInvocation.data.runId)).prompt, 'New question');
 assert.notEqual(nextManifest.executionManifest.target.versionId, oldManifest.executionManifest.target.versionId);
 assert.equal(nextManifest.executionManifest.skills[0].versionId, replacement.currentVersionId);
 assert.deepEqual((await saved(f.runId)).executionConfig, oldManifest); assert.equal((await awaiting(f.runId)).prompt, 'Original question');
 await createBusinessSkillsWaitService(database).answer(await answer(f, { projectName: 'Old answer' })); await worker(counter);
 await createBusinessSkillsWaitService(database).answer(await answer(f, { approved: true })); await worker(counter);
 assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(counter.models, 4);
});
for (const onFailure of ['wait', 'fail'] as const) test(`invalid child output persists the runtime ${onFailure} outcome`, async () => {
 const f = await fixture(d => { d.steps = [d.steps[0]]; d.steps[0].onFailure = onFailure; d.outputMapping = [path('projectName', '$.steps.child.output.projectName')]; });
 await worker({ models: 0 }, { hostOptions: { prepareModel: async (_skill: any, _signal: any, ports: any) => ({ transportProvider: 'kimi', async complete() {
 await ports.beforeDispatch(); return { provider: 'kimi', model: 'fixed', usage: { outputTokens: 1 }, output: { wrong: true } }; } }) } });
 assert.equal((await saved(f.runId)).status, onFailure === 'wait' ? 'waiting' : 'failed');
 const state = ((await checkpoints(f.runId))[0].state as any).businessSkills.state;
 assert.equal(state.workflow.receipts[0].status, 'failed'); assert.equal(state.skill, undefined); assert.equal(state.pendingOperation, undefined);
 if (onFailure === 'wait') assert.equal((await awaiting(f.runId)).kind, 'failure');
});
test('default production boot drives a real Workflow wait and answer without executor or authority injection', async () => {
 const f = await fixture(d => { d.steps = d.steps.filter(s => s.type === 'userInput' || s.type === 'confirmation');
 d.steps[0].inputMapping = [path('projectName', '$.input.projectName')]; });
 let legacyDispatches = 0;
 const forbidden = () => { legacyDispatches++; throw Error('Business execution must not enter ordinary chat factories'); };
 async function boot() {
  let done!: Promise<boolean>;
  const runtime = startHarnessRuntime({ repo: queue, enabled: true, createModelChat: forbidden, resolveScenario: forbidden, resolveApiKey: forbidden, getProvider: forbidden,
   createWorker({ registry }) {
    assert.ok(registry.get('workbench_chat_v1', '1.0.0')); const actual = createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID() });
    return { ...actual, async start() { done = actual.runNextAttempt(); await done; } };
   } });
  await done; await runtime.stop();
 }
 await boot(); assert.equal((await saved(f.runId)).status, 'waiting'); assert.equal((await awaiting(f.runId)).prompt, 'Original question');
 await createBusinessSkillsWaitService(database).answer(await answer(f, { projectName: 'Default boot answer' }));
 await boot(); assert.equal((await awaiting(f.runId)).kind, 'confirmation');
 await createBusinessSkillsWaitService(database).answer(await answer(f, { approved: true })); await boot();
 assert.equal((await saved(f.runId)).status, 'completed'); assert.equal(legacyDispatches, 0);
 assert.deepEqual((await queue.getRunSnapshot(f.runId))!.output!.content, { projectName: 'Default boot answer' });
});
async function waitFixture() {
 const f = await fixture(d => { d.steps = d.steps.filter(s => s.type === 'userInput' || s.type === 'confirmation');
 d.steps[0].inputMapping = [path('projectName', '$.input.projectName')]; });
 await worker({ models: 0 }); assert.equal((await saved(f.runId)).status, 'waiting'); return f;
}
for (const changed of ['role', 'epoch'] as const) test(`first answer rechecks ${changed} in its write transaction after an earlier real authority check`, async () => {
 const f = await waitFixture();
 if (changed === 'epoch') { await createBusinessSkillsWaitService(database).answer(await answer(f, { projectName: 'Answered' })); await worker({ models: 0 }); }
 const run = await saved(f.runId), manifest = (run.executionConfig as any).executionManifest;
 const request = await answer(f, changed === 'role' ? { projectName: 'No longer authorized' } : { approved: true });
 await createExecutionAuthority(database, inventory).check({ runId: f.runId, ownerUserId: user.id, manifestHash: manifest.manifestHash, phase: 'resume' });
 const before = { checkpoints: (await checkpoints(f.runId)).length, events: (await events(f.runId)).length };
 if (changed === 'role') await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
 else await database.update(schema.workflowDefinitions).set({ emergencyEpoch: 1 }).where(eq(schema.workflowDefinitions.workflowId, f.root.workflowId));
 try {
  const outcome = await createBusinessSkillsWaitService(database).answer(request).then(() => 'accepted', () => 'rejected');
  assert.deepEqual({ outcome, status: (await saved(f.runId)).status,
   newCheckpoints: (await checkpoints(f.runId)).length - before.checkpoints, newEvents: (await events(f.runId)).length - before.events },
  { outcome: 'rejected', status: 'waiting', newCheckpoints: 0, newEvents: 0 });
 } finally {
  await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id));
  // Isolate the following case even when the RED implementation wrongly queued this answer.
  await database.update(schema.harnessRuns).set({ status: 'cancelled' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 }
});
test('a previously recorded exact answer remains historical and idempotent after terminal permission revocation', async () => {
 const f = await waitFixture(), first = await answer(f, { projectName: 'Historical answer' });
 const accepted = await createBusinessSkillsWaitService(database).answer(first); await worker({ models: 0 });
 await createBusinessSkillsWaitService(database).answer(await answer(f, { approved: true })); await worker({ models: 0 });
 assert.equal((await saved(f.runId)).status, 'completed');
 const before = { checkpoints: (await checkpoints(f.runId)).length, events: (await events(f.runId)).length };
 await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
 await database.update(schema.workflowDefinitions).set({ emergencyEpoch: 1 }).where(eq(schema.workflowDefinitions.workflowId, f.root.workflowId));
 try {
  const duplicate = await createBusinessSkillsWaitService(database).answer(first); assert.equal(duplicate.created, false);
  assert.equal(duplicate.event.harnessRunEventId, accepted.event.harnessRunEventId); assert.equal(duplicate.run.status, 'completed');
  assert.equal((await checkpoints(f.runId)).length, before.checkpoints); assert.equal((await events(f.runId)).length, before.events);
 } finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
});
const oneCommand = (kind: 'child' | 'direct') => fixture(d => { d.steps = [d.steps[kind === 'child' ? 0 : 3]];
 d.steps[0].onFailure = 'wait'; d.steps[0].inputMapping = [path('projectName', '$.input.projectName')]; d.outputMapping = [path('projectName', '$.input.projectName')]; });
const hostState = async (runId: string) => ((await checkpoints(runId))[0].state as any).businessSkills.state;
for (const kind of ['child', 'direct'] as const) test(`${kind} invalid typed native output checkpoints one failure and waits before later I/O`, async () => {
 const typedSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
 Object.assign(read, { outputSchema: typedSchema });
 try {
  const f = await oneCommand(kind), counter = { models: 0 }, beforeReads = reads;
  currentTools = tools.map(t => t.name === read.name ? { ...t, async execute() { reads++; return { text: 9 }; } } : t) as any;
  await worker(counter);
  const state = await hostState(f.runId);
  assert.deepEqual({ status: (await saved(f.runId)).status, receipts: state.workflow.receipts.map((r: any) => ({ status: r.status, code: r.code })) },
   { status: 'waiting', receipts: [{ status: 'failed', code: 'invalid_output' }] });
  assert.equal(state.skill, undefined); assert.equal(state.pendingOperation, undefined);
  assert.equal((await awaiting(f.runId)).kind, 'failure');
  assert.equal(reads, beforeReads + 1); assert.equal(counter.models, kind === 'child' ? 1 : 0);
  await worker(counter);
  assert.equal((await saved(f.runId)).status, 'waiting'); assert.deepEqual(await hostState(f.runId), state);
  assert.equal(reads, beforeReads + 1); assert.equal(counter.models, kind === 'child' ? 1 : 0);
 } finally { delete (read as any).outputSchema; currentTools = tools; }
});
const stallModel = (before?: () => Promise<void>) => async (_skill: any, _signal: any, ports: any) => ({ transportProvider: 'kimi', async complete(request: any) {
 await before?.(); await ports.beforeDispatch(); return new Promise<never>((_resolve, reject) => {
  const abort = () => reject(Error('Interrupted fixture provider'));
  if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
 }); } });
for (const kind of ['child', 'direct'] as const) test(`${kind} real dispatch timeout records failure and honors onFailure wait`, async () => {
 const f = await oneCommand(kind), budget = createExecutionBudgetService({ database }), beforeReads = reads;
 if (kind === 'direct') {
  // A genuine failed reservation conservatively consumes its bound time. The next real
  // direct-tool reservation is clipped to 1000ms; no ledger, timer or error is fabricated.
  await assert.rejects(budget.runWithBudget({ runId: f.runId, ownerUserId: user.id, kind: 'tool', timeoutMs: 299000 }, async () => { throw Error('Prior failed segment'); }));
  assert.equal((await budget.readBudget(user.id, f.runId)).remaining.activeMs, 1000);
  const delayed = { ...read, async execute() { reads++; return new Promise<{ found: boolean }>(resolve => setTimeout(() => resolve({ found: true }), 1500)); } };
  currentTools = tools.map(t => t.name === read.name ? delayed : t);
 }
 try {
  await worker({ models: 0 }, { hostOptions: kind === 'child' ? { prepareModel: stallModel() } : {} });
  const audit = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
  assert.equal(audit.filter(r => r.eventType === 'business_budget_reservation' && r.errorMessage === 'EXECUTION_BUDGET_TIMEOUT').length, 1);
  assert.equal(reads, beforeReads + (kind === 'direct' ? 1 : 0));
  const state = await hostState(f.runId);
  assert.deepEqual({ status: (await saved(f.runId)).status, receipts: state.workflow.receipts.map((r: any) => ({ status: r.status, code: r.code })) },
   { status: 'waiting', receipts: [{ status: 'failed', code: 'execution_failed' }] });
  assert.equal(state.skill, undefined); assert.equal((await awaiting(f.runId)).kind, 'failure');
 } finally { currentTools = tools; }
});
for (const kind of ['child', 'direct'] as const) test(`${kind} late DB authority revocation stays a host denial instead of a recoverable Workflow failure`, async () => {
 const f = await oneCommand(kind); let revoked = false;
 const revoke = async () => { revoked = true; await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id)); };
 const lateInventory = async () => {
  const current = await inventory();
  const audit = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
  if (!revoked && audit.some(r => r.eventType === 'business_budget_reservation' && r.status === 'reserved')) await revoke();
  return current;
 };
 try {
  await worker({ models: 0 }, { hostOptions: kind === 'child' ? { prepareModel: stallModel(revoke) } : { inventory: lateInventory } });
  assert.equal(revoked, true); assert.equal((await saved(f.runId)).status, 'failed');
  assert.deepEqual((await hostState(f.runId)).workflow.receipts, []);
 } finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
});
test('exhausted durable budget remains a host failure even when the Workflow asks to wait on execution failure', async () => {
 const f = await oneCommand('child');
 await assert.rejects(createExecutionBudgetService({ database }).runWithBudget({ runId: f.runId, ownerUserId: user.id, kind: 'tool', timeoutMs: 300000 }, async () => { throw Error('Consumed prior budget'); }));
 await worker({ models: 0 }); assert.equal((await saved(f.runId)).status, 'failed'); assert.deepEqual((await hostState(f.runId)).workflow.receipts, []);
});
test('cancellation during a real model reservation stays cancelled without a Workflow failure receipt', async () => {
 const f = await oneCommand('child');
 await worker({ models: 0 }, { timing: { heartbeatIntervalMs: 20 }, hostOptions: { prepareModel: stallModel(async () => {
  await queue.requestRunCancel({ runId: f.runId, requestedBy: user.id });
 }) } });
 assert.equal((await saved(f.runId)).status, 'cancelled'); assert.deepEqual((await hostState(f.runId)).workflow.receipts, []);
});
for (const changed of ['role', 'epoch', 'stop'] as const) test(`approved create_project ${changed} revocation inside consumer inventory remains a host denial with full budget charge`, async () => {
 const f = await fixture(d => { const step = d.steps[3]; if (step.type !== 'tool') throw Error();
  step.toolName = write.name; step.requiresConfirmation = true; step.onFailure = 'wait'; step.inputMapping = [path('projectName', '$.input.projectName')];
  d.steps = [step]; d.outputMapping = [path('projectName', '$.input.projectName')]; });
 const records = () => database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
 const before = (await records()).length; await worker({ models: 0 }); assert.equal((await saved(f.runId)).status, 'waiting');
 const waits = createBusinessSkillOperationWaitService({ database, inventory }), view = await waits.read(user, f.runId);
 await waits.answer(user, { runId: f.runId, actionId: view.actionId, confirmationHash: view.confirmationHash, decision: 'approve' });
 let revoked = false;
 const lateInventory = async () => {
  const current = await inventory();
  const audit = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
  if (!revoked && audit.some(r => r.eventType === 'business_budget_reservation' && r.status === 'reserved')) {
   revoked = true;
   if (changed === 'role') await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
   else await database.update(schema.workflowDefinitions).set(changed === 'stop' ? { emergencyStopped: true } : { emergencyEpoch: 1 })
    .where(eq(schema.workflowDefinitions.workflowId, f.root.workflowId));
  }
  return current;
 };
 try {
  await worker({ models: 0 }, { hostOptions: { inventory: lateInventory } }); assert.equal(revoked, true);
  assert.equal((await saved(f.runId)).status, 'failed'); assert.deepEqual((await hostState(f.runId)).workflow.receipts, []);
  assert.equal((await records()).length, before);
  const audit = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
  assert.equal(audit.filter(r => r.eventType === 'business_operation_executed').length, 0);
  const budget = await createExecutionBudgetService({ database }).readBudget(user.id, f.runId);
  assert.equal(budget.toolCalls, 1); assert.equal(budget.activeMs, 30000);
 } finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
});

async function projectionFixture(count = 1) {
 const f = await fixture(d => {
  const direct = d.steps[3]; if (direct.type !== 'tool') assert.fail();
  d.steps = Array.from({ length: count }, (_, i) => ({ ...direct, id: `write${i}`, toolName: write.name, requiresConfirmation: true,
   inputMapping: [path('projectName', '$.input.projectName')] }));
  d.outputMapping = [path('projectName', '$.input.projectName')];
 });
 await worker({ models: 0 }); const run = await saved(f.runId); assert.equal(run.status, 'waiting', run.errorCode ?? undefined);
 assert.ok((await hostState(f.runId)).pendingOperation);
 return f;
}
async function approveProjectionStep(f: Awaited<ReturnType<typeof fixture>>) {
 const wait = createBusinessSkillOperationWaitService({ database, inventory }), view = await wait.read(user, f.runId);
 await wait.answer(user, { runId: f.runId, actionId: view.actionId, confirmationHash: view.confirmationHash, decision: 'approve' });
 await worker({ models: 0 });
}
/** Gate only after COMMIT, so the real Worker can advance even with max:1. Never replace query results. */
function projectionGate(kind: 'snapshot' | 'owned', advance: (n: number) => Promise<void>) {
 const wrapped = Object.create(database); let gates = 0;
 wrapped.transaction = async (callback: any, config: any) => {
  const value: any = await database.transaction(callback, config);
  if (kind === 'snapshot'
   ? value?.run && value?.manifest && value?.chain && Object.prototype.hasOwnProperty.call(value, 'history')
   : value?.run && value?.descriptor && value?.prepared)
   await advance(++gates);
  return value;
 };
 return { database: wrapped, gates: () => gates };
}
const projectionAudit = (runId: string) => database.select().from(schema.harnessToolEvents)
 .where(eq(schema.harnessToolEvents.harnessRunId, runId)).orderBy(schema.harnessToolEvents.harnessToolEventId);
for (const window of ['snapshot', 'owned'] as const) test(`projection race ${window} returns the new completed checkpoint without stale actions`, { timeout: 20000 }, async () => {
 const f = await projectionFixture(), before = (await database.select({ id: schema.versionRecords.recordId }).from(schema.versionRecords)
  .where(eq(schema.versionRecords.ownerUserId, user.id))).length, captured = (await saved(f.runId)).lastCheckpointId;
 let committedAudit: unknown, committedRun: unknown;
 const gated = projectionGate(window, async n => {
  if (n !== 1) return;
  await approveProjectionStep(f);
  assert.equal((await saved(f.runId)).status, 'completed');
  assert.notEqual((await saved(f.runId)).lastCheckpointId, captured);
  assert.equal((await hostState(f.runId)).pendingOperation, undefined);
  committedAudit = await projectionAudit(f.runId); committedRun = await saved(f.runId);
 });
 const result = await createBusinessExecutionProjectionService({ database: gated.database, inventory }).read(user, f.runId);
 assert.ok(gated.gates() > 0, 'Projection race gate must fire');
 assert.deepEqual(result.results.output, { projectName: 'Original project' });
 assert.equal(result.pendingOperation, undefined); assert.equal(result.pendingInput, undefined);
 assert.equal((await database.select({ id: schema.versionRecords.recordId }).from(schema.versionRecords)
  .where(eq(schema.versionRecords.ownerUserId, user.id))).length, before + 1); assert.ok(gated.gates() <= 3);
 const audit = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
 assert.equal(audit.filter(e => e.eventType === 'business_operation_executed').length, 1);
 assert.equal(audit.filter(e => e.eventType === 'business_operation_decision').length, 1);
 assert.deepEqual(await projectionAudit(f.runId), committedAudit); assert.deepEqual(await saved(f.runId), committedRun);
});
test('projection race refuses two consecutive normal checkpoint movements', { timeout: 20000 }, async () => {
 const f = await projectionFixture(3); let committedAudit: unknown;
 const gated = projectionGate('snapshot', async n => { if (n <= 2) { await approveProjectionStep(f); committedAudit = await projectionAudit(f.runId); } });
 await assert.rejects(createBusinessExecutionProjectionService({ database: gated.database, inventory }).read(user, f.runId),
  (e: any) => e.code === 'BUSINESS_SKILLS_PROJECTION_UNAVAILABLE' && e.status === 409);
 assert.equal(gated.gates(), 3); assert.equal((await saved(f.runId)).status, 'waiting');
 assert.equal((await hostState(f.runId)).workflow.receipts.length, 2);
 assert.deepEqual(await projectionAudit(f.runId), committedAudit);
});
test('projection race does not retry an unchanged corrupt prepared ledger', { timeout: 20000 }, async () => {
 const f = await projectionFixture(), operationId = (await hostState(f.runId)).pendingOperation.operationId;
 const gated = projectionGate('snapshot', async n => { if (n === 1) await database.update(schema.harnessToolEvents)
  .set({ actionId: 'corrupt' }).where(eq(schema.harnessToolEvents.harnessToolEventId, operationId)); });
 await assert.rejects(createBusinessExecutionProjectionService({ database: gated.database, inventory }).read(user, f.runId),
  (e: any) => e.code === 'OPERATION_INTENT_CONFLICT' && e.status === 409);
 assert.equal(gated.gates(), 1); assert.equal((await hostState(f.runId)).workflow.receipts.length, 0);
});
for (const denial of ['role', 'owner', 'inventory'] as const) test(`projection race preserves ${denial} denial`, { timeout: 20000 }, async () => {
 const f = await projectionFixture(), otherId = randomUUID();
 if (denial === 'owner') await database.insert(schema.users).values({ userId: otherId, username: `projection-other-${otherId}`,
  role: 'user', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() });
 const gated = projectionGate('snapshot', async n => {
  if (n !== 1) return;
  if (denial !== 'inventory') await approveProjectionStep(f);
  if (denial === 'role') await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
  if (denial === 'owner') await database.update(schema.aiSessions).set({ ownerUserId: otherId }).where(eq(schema.aiSessions.sessionId, f.sessionId));
 });
 try {
  await assert.rejects(createBusinessExecutionProjectionService({ database: gated.database, inventory: denial === 'inventory'
   ? async () => { throw new SkillError('OPERATION_DECISION_UNAVAILABLE', 'Fixture inventory unavailable', 503); } : inventory }).read(user, f.runId),
   (e: any) => e.status === (denial === 'role' ? 403 : denial === 'owner' ? 404 : 503));
  assert.ok(gated.gates() > 0, 'Projection race gate must fire');
  assert.ok(gated.gates() <= 2);
 } finally {
  await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id));
  if (denial === 'owner') {
   await database.update(schema.aiSessions).set({ ownerUserId: user.id }).where(eq(schema.aiSessions.sessionId, f.sessionId));
   await database.delete(schema.users).where(eq(schema.users.userId, otherId));
  }
 }
});
test('projection race returns no action after normal cancellation without dispatching the operation', { timeout: 20000 }, async () => {
 const f = await projectionFixture(), before = reads, gated = projectionGate('snapshot', async n => {
  if (n === 1) await queue.requestRunCancel({ runId: f.runId, requestedBy: user.id });
 });
 const result = await createBusinessExecutionProjectionService({ database: gated.database, inventory }).read(user, f.runId);
 assert.ok(gated.gates() > 0, 'Projection race gate must fire');
 assert.equal(result.pendingOperation, undefined); assert.equal(result.pendingInput, undefined);
 assert.equal((await saved(f.runId)).status, 'cancelled'); assert.equal(reads, before);
 const audit = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessRunId, f.runId));
 assert.equal(audit.filter(e => ['business_operation_executed', 'business_operation_decision'].includes(e.eventType)).length, 0);
});
