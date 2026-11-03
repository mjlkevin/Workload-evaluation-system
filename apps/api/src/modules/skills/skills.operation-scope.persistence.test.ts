import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { hashHarnessCheckpointState } from '../harness/harness-runtime.worker';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createSkillReleaseRepository } from './skills-release.repository';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillRetryService } from './skills.retry';
import { createSkillOperationService, readPreparedOperationInTransaction } from './skills.operations';
import { createSkillOperationDecisionService } from './skills.operation-decisions';
import { createSkillOperationExecutionService } from './skills.operation-execution';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { SkillDefinition } from './skills.types';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import type { AuthUser } from '../../types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 2 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `scope-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username };
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const native = { name: 'scope_write', description: 'Write scoped fixture', parameters: payload, mutates: true, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
const definition: SkillDefinition = { name: 'Scoped child', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
 tools: [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: true }], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const frozenContext = { schemaVersion: 1, references: [], tools: [{ native, policy: DEFAULT_TOOL_POLICY_ENTRY }], roles: ['ADMIN'], model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'fixture', baseUrlDigest: hash('endpoint'), params: definition.model, capabilities: [], supportedParams: [] } } as any;
const inventory = async () => ({ registry: { get: (name: string) => name === native.name ? native : undefined }, tools: [], policy: { schemaVersion: 1, policies: {} } }) as any;
const contract = { ...native, requiresConfirmation: true, policy: DEFAULT_TOOL_POLICY_ENTRY }; delete (contract as any).sandboxReadSafe;
const manifests = createExecutionManifestService({ database, loadSkillContext: async () => ({ snapshot: frozenContext, tools: [native] }) as any,
 loadWorkflowTools: async () => [{ ...contract, sandboxReadSafe: true, allowedRoles: ['pre_sales'] }] as any });
const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
const prepare = createSkillOperationService({ database, inventory });
const decisions = createSkillOperationDecisionService({ database, inventory });
const execution = createSkillOperationExecutionService({ database, inventory, adapters: new Map([[native.name, { kind: 'local-transaction' as const, async execute(tx: any, input: any) {
 const id = randomUUID(), now = new Date();
 await tx.insert(schema.versionRecords).values({ recordId: id, type: 'assessment', versionCode: id, templateId: 'scope', baseCode: id, ownerUserId: input.ownerId, status: 'draft', payload: { operationId: input.operationId, parameters: input.parameters }, createdAt: now, updatedAt: now,
 createdByUserId: input.ownerId, updatedByUserId: input.ownerId, createdByUsername: user.username, updatedByUsername: user.username, checkoutStatus: 'checked_in', versionDocStatus: 'drafting', majorLetter: 'A', minorNumber: 0, isHistoricalArchive: false, lastCheckinPayload: {} }); return { recordId: id };
 } }]]) });
async function fixture(kind: 'skill' | 'tool', repeat = false) {
 const skills = createSkillsPgRepository(database); let child = await skills.create(definition, actor);
 child = await skills.mutate(child.skillId, child.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const step: any = { id: 'selected', name: 'Selected', type: kind, ...(kind === 'skill' ? { skillId: child.skillId, skillVersionId: child.currentVersionId } : { toolName: native.name, requiresConfirmation: true }),
 inputMapping: [{ target: 'text', source: { kind: 'literal', value: 'mapped command' } }], onFailure: 'fail', ...(repeat ? { repeat: { while: [{ path: '$.input.text', op: 'eq', value: 'original' }], maxIterations: 2, onLimit: 'fail' } } : {}) };
 const d: WorkflowDefinition = { name: 'Scope workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: payload, outputSchema: { type: 'object' }, steps: [step], outputMapping: [] };
 const workflows = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, releases: createSkillReleaseRepository(database), getTools: async () => [{ ...contract, sandboxReadSafe: true, allowedRoles: ['pre_sales'] }] as any, loadSkillContext: async () => ({ snapshot: frozenContext, tools: [native] }) as any }), user);
 let root = await workflows.create(d); root = await workflows.validate(root.workflowId, root.revision); root = await workflows.review(root.workflowId, root.revision, 'Fixture review'); root = await workflows.publish(root.workflowId, root.revision);
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Scoped operations', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Original command', execution: { kind: 'workflow', workflowId: root.workflowId, input: { text: 'original' } } });
 const run = (await queue.findRunForOwner(accepted.data.runId, user.id))!, manifest = (run.executionConfig as any).executionManifest;
 const runtime = createWorkflowRuntime(manifest, run.harnessRunId), ready = runtime.next(); assert.equal(ready.kind, 'ready'); if (ready.kind !== 'ready') throw Error();
 const host: any = { schemaVersion: 1, kind: 'workflow', workflow: ready.state };
 if (kind === 'skill') host.skill = { schemaVersion: 1, runId: run.harnessRunId, ownerUserId: user.id, manifestHash: manifest.manifestHash, stepId: ready.command.stepId, operationId: ready.command.operationId, iteration: ready.command.iteration, inputHash: hash(ready.command.input),
 phase: 'tools', toolResults: [], seenCallIds: ['call-1'], pendingBatch: [{ ordinal: 0, callId: 'call-1', name: native.name, arguments: ready.command.input }], nextToolIndex: 0, usage: { modelAttempts: 1, outputTokens: 1 }, model: { providerId: 'fixture', model: 'fixed', transportProvider: 'fixture' } };
 const body = { runId: run.harnessRunId, stepId: 'selected', ordinal: 0, toolName: native.name, parameters: ready.command.input };
 return { run, manifest, runtime, ready, host, body };
}
async function checkpoint(f: Awaited<ReturnType<typeof fixture>>, host = f.host, runId = f.run.harnessRunId) {
 const previous = await database.select().from(schema.harnessRunCheckpoints).where(eq(schema.harnessRunCheckpoints.harnessRunId, runId));
 const state = { businessSkills: { schemaVersion: 1, runId, manifestHash: f.manifest.manifestHash, state: host }, nextStepKey: 'execute' };
 const [row] = await database.insert(schema.harnessRunCheckpoints).values({ harnessRunCheckpointId: randomUUID(), harnessRunId: runId, sequence: previous.length + 1, checkpointKey: randomUUID(), checkpointKind: 'structural', workflowId: f.run.workflowId, workflowVersion: f.run.workflowVersion, stepKey: 'execute', resumePolicy: 'restart_step', state, stateHash: hashHarnessCheckpointState(state), effectKeys: [], runtimeValidation: {} }).returning();
 await database.update(schema.harnessRuns).set({ lastCheckpointId: row.harnessRunCheckpointId }).where(eq(schema.harnessRuns.harnessRunId, runId)); return row;
}
async function approved(f: Awaited<ReturnType<typeof fixture>>) {
 const op = await prepare.prepareOperation(user, f.body), request = { runId: f.body.runId, operationId: op.operationId };
 const view = await decisions.readForConfirmation(user, request); await decisions.decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
 return { op, request, command: { ...request, confirmationHash: view.confirmationHash } };
}
const denied = (e: any) => e.status >= 400;
const records = async (id: string) => (await database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id))).filter(r => (r.payload as any).operationId === id);
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id)); await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 for (const [table, column] of [['version_records', 'owner_user_id'], ['harness_runs', 'owner_user_id'], ['ai_sessions', 'owner_user_id'], ['users', 'user_id']]) assert.equal(Number((await pool.query(`SELECT count(*) n FROM ${table} WHERE ${column}=$1`, [user.id])).rows[0].n), 0); await pool.end(); });
for (const kind of ['skill', 'tool'] as const) test(`${kind}: durable Workflow command can prepare, approve and execute once`, async () => {
 const f = await fixture(kind); await checkpoint(f); const a = await approved(f), first = await execution.executeOperation(user, a.command);
 assert.deepEqual(await execution.executeOperation(user, a.command), first); assert.equal((await records(a.op.operationId)).length, 1);
 assert.match(a.op.operationKey, /^business-op:v2:/); const [row] = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessToolEventId, a.op.operationId));
 assert.equal((row.input as any).schemaVersion, 2); assert.ok((row.input as any).sourceCheckpointId); assert.equal((row.input as any).parameters.text, 'mapped command');
 if (kind === 'tool') assert.equal('skillId' in (row.input as any), false);
});
for (const kind of ['skill', 'tool'] as const) test(`${kind}: caller guesses cannot replace durable command, cursor or input`, async () => {
 const f = await fixture(kind); await assert.rejects(prepare.prepareOperation(user, f.body), denied);
 const cp = await checkpoint(f);
 for (const patch of [{ stepId: 'other' }, { ordinal: 1 }, { parameters: { text: 'original' } }, { parameters: { text: 'changed' } }, { toolName: 'unknown' }]) await assert.rejects(prepare.prepareOperation(user, { ...f.body, ...patch }), denied);
 await database.update(schema.harnessRunCheckpoints).set({ stateHash: hash('corrupt') }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
 await assert.rejects(prepare.prepareOperation(user, f.body), denied);
 await database.update(schema.harnessRunCheckpoints).set({ stateHash: cp.stateHash }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
 await database.update(schema.harnessRuns).set({ lastCheckpointId: randomUUID() }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
 await assert.rejects(prepare.prepareOperation(user, f.body), denied);
});
test('child Skill requires its server cursor at the selected unconsumed tool ordinal', async () => {
 const f = await fixture('skill'); const host = structuredClone(f.host); delete host.skill;
 await checkpoint(f, host); await assert.rejects(prepare.prepareOperation(user, f.body), denied);
 const bad = structuredClone(f.host); bad.skill.pendingBatch[0].arguments.text = 'forged'; await checkpoint(f, bad);
 await assert.rejects(prepare.prepareOperation(user, f.body), denied);
});
for (const kind of ['skill', 'tool'] as const) test(`${kind}: node advance blocks old approval/execute while historical anchor remains valid`, async () => {
 const f = await fixture(kind); const anchor = await checkpoint(f), a = await approved(f); await execution.executeOperation(user, a.command);
 const done = f.runtime.settle(f.ready.state, { operationId: f.ready.command.operationId, output: { text: 'done' } });
 await checkpoint(f, { schemaVersion: 1, kind: 'workflow', workflow: done.state });
 await assert.rejects(decisions.readForConfirmation(user, a.request), denied);
 await assert.rejects(decisions.decideOperation(user, { ...a.command, decision: 'approve' }), denied);
 await assert.rejects(execution.executeOperation(user, a.command), denied);
 await database.transaction(async tx => { const historical = await readPreparedOperationInTransaction(tx, f.body.runId, a.op.operationId, user.id, f.manifest); assert.equal((historical.input as any).sourceCheckpointId, anchor.harnessRunCheckpointId); });
 // A retry must re-confirm against its own Run but consumes the original receipt once.
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
 const retry = await createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { throw Error('NO MODEL'); } }) }).retryInvocation(user, f.body.runId, { submissionKey: randomUUID(), reason: 'Explicit retry after progress' });
 const retryId = retry.data.runId; await checkpoint(f, f.host, retryId);
 const again = await prepare.prepareOperation(user, { ...f.body, runId: retryId }); assert.equal(again.operationId, a.op.operationId); assert.equal(again.payloadHash, a.op.payloadHash);
 const request = { runId: retryId, operationId: again.operationId }, view = await decisions.readForConfirmation(user, request);
 assert.notEqual(view.confirmationHash, a.command.confirmationHash);
 await assert.rejects(execution.executeOperation(user, { ...request, confirmationHash: a.command.confirmationHash }), denied);
 await decisions.decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
 await execution.executeOperation(user, { ...request, confirmationHash: view.confirmationHash }); assert.equal((await records(a.op.operationId)).length, 1);
});
for (const kind of ['skill', 'tool'] as const) test(`${kind}: repeat iterations use separate durable logical operation keys`, async () => {
 const f = await fixture(kind, true); await checkpoint(f); const first = await prepare.prepareOperation(user, f.body);
 const next = f.runtime.settle(f.ready.state, { operationId: f.ready.command.operationId, output: { text: 'one' } }); assert.equal(next.kind, 'ready'); if (next.kind !== 'ready') throw Error();
 const host = structuredClone(f.host); host.workflow = next.state;
 if (host.skill) { host.skill.operationId = next.command.operationId; host.skill.iteration = next.command.iteration; host.skill.inputHash = hash(next.command.input); }
 await checkpoint(f, host); const second = await prepare.prepareOperation(user, { ...f.body, parameters: next.command.input });
 assert.notEqual(first.operationId, second.operationId); assert.notEqual(first.operationKey, second.operationKey);
 assert.deepEqual(await prepare.prepareOperation(user, { ...f.body, parameters: next.command.input }), second);
});
test('tampering the original checkpoint or its provenance cannot silently replace an existing operation', async () => {
 const f = await fixture('tool'), cp = await checkpoint(f), a = await approved(f);
 await checkpoint(f); assert.equal((await prepare.prepareOperation(user, f.body)).operationId, a.op.operationId);
 const bad = structuredClone(cp.state) as any; bad.businessSkills.runId = randomUUID();
 await database.update(schema.harnessRunCheckpoints).set({ state: bad, stateHash: hashHarnessCheckpointState(bad) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
 await assert.rejects(prepare.prepareOperation(user, f.body), denied); await assert.rejects(decisions.readForConfirmation(user, a.request), denied);
});
test('logical Workflow executionId must be the original root; legacy bare Workflow cursors remain supported', async () => {
 const f = await fixture('tool'), wrong = structuredClone(f.host); wrong.workflow.executionId = randomUUID();
 await checkpoint(f, wrong); await assert.rejects(prepare.prepareOperation(user, f.body), denied);
 await checkpoint(f, f.ready.state); assert.ok((await prepare.prepareOperation(user, f.body)).operationId);
});
test('Workflow confirmation is refreshed when current tool policy changes and old approval is unusable', async () => {
 const f = await fixture('tool'); await checkpoint(f); const a = await approved(f);
 const changedInventory = async () => ({ ...await inventory(), policy: { schemaVersion: 1, policies: { [native.name]: { ...DEFAULT_TOOL_POLICY_ENTRY, approvalStrategy: 'user-confirm' } } } }) as any;
 const changed = createSkillOperationDecisionService({ database, inventory: changedInventory }), view = await changed.readForConfirmation(user, a.request);
 assert.notEqual(view.confirmationHash, a.command.confirmationHash); assert.equal(view.status, 'pending');
 const consumer = createSkillOperationExecutionService({ database, inventory: changedInventory });
 await assert.rejects(consumer.executeOperation(user, a.command), denied); assert.equal((await records(a.op.operationId)).length, 0);
});
