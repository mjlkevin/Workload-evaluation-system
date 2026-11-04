import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { closeDb } from '../../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../../harness/harness-runtime.repository';
import type { QueueDbExecutor } from '../../harness/harness-runtime.repository';
import { hashHarnessCheckpointState } from '../../harness/harness-runtime.worker';
import { HARNESS_WORKER_VALIDATOR_VERSION } from '../../harness/harness-runtime.types';
import { readBusinessSkillsRun } from '../../harness/business-skills.workflow';
import { createWorkflowRuntime } from '../../harness/workflows.runtime-adapter';
import { businessSkillsWaitDescriptor, createBusinessSkillsWaitService } from '../../harness/business-skills.wait';
import { createWorkflowService } from '../../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../../workflows/workflows.context';
import { createWorkflowsPgRepository } from '../../workflows/workflows-pg.repository';
import { createExecutionManifestService } from '../execution-manifest';
import { createSkillInvocationService } from '../skills.invocation';
import { createInvocationPgRepository } from '../skills.invocation-pg.repository';
import { createSkillRetryService } from '../skills.retry';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../../agent/tool-policy';
import { skillDefinitionHash as hash } from '../skills.hash';
import { createMvpExecutionProofRepository, readCurrentMvpExecutionInTransaction } from './execution-proof.repository';
import type { AuthUser } from '../../../types';
import type { RuntimeContext } from '../../../agent/context/context.types';
import type { WorkflowDefinition } from '../../workflows/workflows.types';
import type { WorkflowRuntimeState } from '../../harness/workflows.runtime-adapter';

const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 1500 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `proof-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const other = { ...user, id: randomUUID(), username: `proof-other-${randomUUID()}` };
const report = { requirements: [{ id: 'REQ-001', title: 'Read', description: 'Actual description', role: 'Buyer', action: 'Read', object: 'Order',
 constraints: [], openQuestions: [], assumptions: [], sources: [] }], relations: [] };
const selection = { report, selectedRequirementIds: ['REQ-001'], resolvedConflicts: [] };
const finalInput = { ...selection };
const toolNames = ['requirement_normalize', 'requirement_confirm'];
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const reportSchema = object({ requirements: { type: 'array', items: { type: 'object' } }, relations: { type: 'array', items: { type: 'object' } } });
const selectionSchema = object({ report: reportSchema, selectedRequirementIds: { type: 'array', items: { type: 'string' } }, resolvedConflicts: { type: 'array', items: { type: 'object' } } });
const descriptionSchema = object({ description: { type: 'string' } });
const tools = toolNames.map((name, index) => ({ name, description: 'Proof fixture', parameters: index ? selectionSchema : descriptionSchema, outputSchema: object({ report: reportSchema }),
 source: 'code' as const, capability: 'estimates:read' as const, mutates: false, exfiltrates: false, simulationOnly: false, sandboxReadSafe: true,
 requiresConfirmation: false, allowedRoles: ['pre_sales'], policy: DEFAULT_TOOL_POLICY_ENTRY }));
const inventory = async () => ({ tools, registry: { get: (name: string) => tools.find(t => t.name === name) }, policy: { schemaVersion: 1, policies: {} } }) as any;
const path = (target: string, source: string) => ({ target, source: { kind: 'path' as const, path: source } });
const literal = (target: string, value: unknown) => ({ target, source: { kind: 'literal' as const, value } });
const proofRepo = createMvpExecutionProofRepository(database);
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(edit: (definition: WorkflowDefinition) => void = () => {}) {
 const service = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, getTools: async () => tools as any }), user);
 const definition: WorkflowDefinition = { name: 'Proof without business implementation', description: '', category: 'fixture', roles: ['pre_sales'],
 inputSchema: descriptionSchema, outputSchema: object({ report: reportSchema }), steps: [
  { id: 'normalize', name: 'Normalize', type: 'tool', toolName: toolNames[0], requiresConfirmation: false, inputMapping: [path('description', '$.input.description')], onFailure: 'fail' },
  { id: 'answer', name: 'Answer', type: 'userInput', prompt: 'Actual question', inputSchema: object({ report: reportSchema }), outputSchema: object({ answer: { type: 'string' } }),
   inputMapping: [path('report', '$.steps.normalize.output.report')], onFailure: 'fail' },
  { id: 'confirm', name: 'Confirm', type: 'confirmation', prompt: 'Approve exact report', inputSchema: selectionSchema,
   inputMapping: [path('report', '$.steps.normalize.output.report'), literal('selectedRequirementIds', ['REQ-001']), literal('resolvedConflicts', [])], onFailure: 'fail' },
  { id: 'consume', name: 'Consume', type: 'tool', toolName: toolNames[1], requiresConfirmation: false,
   inputMapping: [path('report', '$.steps.normalize.output.report'), literal('selectedRequirementIds', ['REQ-001']), literal('resolvedConflicts', [])], onFailure: 'fail' },
 ], outputMapping: [path('report', '$.steps.normalize.output.report')] }; edit(definition);
 let workflow = await service.create(definition);
 workflow = await service.validate(workflow.workflowId, workflow.revision); workflow = await service.review(workflow.workflowId, workflow.revision, 'Proof fixture');
 workflow = await service.publish(workflow.workflowId, workflow.revision);
 const sessionId = randomUUID(), messageId = randomUUID(), now = new Date();
 await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Proof', domain: 'business_evaluation',
  workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', messages: [{ messageId, role: 'user', content: 'Original source', createdAt: now.toISOString() }], createdAt: now, updatedAt: now });
 const manifests = createExecutionManifestService({ database, loadWorkflowTools: async () => tools as any });
 const accepted = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution })
  .submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Proof fixture', execution: { kind: 'workflow', workflowId: workflow.workflowId,
   input: { description: 'Actual initial description' }, sources: [{ kind: 'conversation', id: messageId }] } });
 const run = (await queue.findRunForOwner(accepted.data.runId, user.id))!, manifest = readBusinessSkillsRun(run), runtime = createWorkflowRuntime(manifest, run.harnessRunId);
 const start = runtime.next(); assert.equal(start.kind, 'ready'); if (start.kind !== 'ready') assert.fail();
 const normalized = runtime.settle(start.state, { operationId: start.command.operationId, output: { report } });
 assert.equal(normalized.kind, 'ready');
 return { runId: run.harnessRunId, sessionId, messageId, manifest, runtime, normalized: normalized.state };
}
function context(f: Pick<Fixture, 'runId' | 'sessionId'>): RuntimeContext {
 return { requestId: randomUUID(), traceId: randomUUID(), channel: 'api', workflowKey: 'managed', harnessRunId: f.runId,
  aiSessionId: f.sessionId, actor: { userId: user.id, roles: ['ADMIN'], capabilities: ['estimates:read'] } };
}
async function checkpoint(f: Fixture, workflow: WorkflowRuntimeState, key: string = randomUUID()) {
 const state = { businessSkills: { schemaVersion: 1, runId: f.runId, manifestHash: f.manifest.manifestHash,
  state: { schemaVersion: 1, kind: 'workflow', workflow } }, nextStepKey: 'execute' };
 const run = (await queue.findRunForOwner(f.runId, user.id))!;
 return queue.commitCheckpoint({ runId: f.runId, checkpointKey: key, checkpointKind: 'structural', workflowId: run.workflowId!, workflowVersion: run.workflowVersion!,
  stepKey: 'execute', resumePolicy: 'restart_step', state, stateHash: hashHarnessCheckpointState(state), runtimeValidation: {
   validatedAt: new Date().toISOString(), validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION,
   checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } } });
}
async function running(f: Pick<Fixture, 'runId'>) { await database.update(schema.harnessRuns).set({ status: 'running' }).where(eq(schema.harnessRuns.harnessRunId, f.runId)); }
async function recordAnswer(f: Fixture, state: WorkflowRuntimeState, value: unknown) {
 const decision = f.runtime.next(state); if (decision.kind !== 'ready' || !['confirmation', 'userInput'].includes(decision.command.type)) assert.fail();
 const run = (await queue.findRunForOwner(f.runId, user.id))!, descriptor = businessSkillsWaitDescriptor(run, decision.command as any);
 await checkpoint(f, state, `wait:${descriptor.actionId}`);
 await database.update(schema.harnessRuns).set({ status: 'waiting' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await createBusinessSkillsWaitService(database).answer({ runId: f.runId, sessionId: f.sessionId, requestedBy: user.id,
  actionId: descriptor.actionId, kind: descriptor.kind, stepId: descriptor.stepId, contentHash: descriptor.contentHash, value });
 return { state: f.runtime.settle(state, { operationId: decision.command.operationId, output: value }).state, descriptor };
}
async function confirmed(f: Fixture) {
 const answer = await recordAnswer(f, f.normalized, { answer: 'Actual human clarification' });
 const confirmation = await recordAnswer(f, answer.state, { approved: true }); await running(f);
 return { ...confirmation, answer };
}
async function read(f: Pick<Fixture, 'runId' | 'sessionId'>, input: unknown = finalInput) {
 return proofRepo.readCurrentExecution(user.id, context(f), toolNames[1], input);
}
before(async () => { for (const actor of [user, other]) await database.insert(schema.users).values({ userId: actor.id, username: actor.username,
 role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
afterEach(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); });
after(async () => {
 await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
 for (const actor of [user, other]) await database.delete(schema.users).where(eq(schema.users.userId, actor.id));
 assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, 0);
 await pool.end(); await closeDb();
});

test('current locked command binds owner, session, name, parameters, current admission and server checkpoint', async () => {
 const f = await fixture(); await confirmed(f); const proof = await read(f);
 assert.equal(proof.rootRunId, f.runId); assert.equal(proof.command.toolName, toolNames[1]);
 assert.deepEqual(proof.sources.map(s => s.text), ['Original source', 'Actual initial description', '{"answer":"Actual human clarification"}']);
 assert.equal(proof.sources[1].id, `input:${f.runId}`);
 assert.equal(proof.readConfirmation(selection).actorId, user.id);
 proof.assertPreviousOutput([toolNames[0]], { report });
 await assert.rejects(proofRepo.readCurrentExecution(user.id, undefined, toolNames[1], finalInput));
 await assert.rejects(proofRepo.readCurrentExecution(user.id, { ...context(f), actor: { ...context(f).actor, userId: other.id } }, toolNames[1], finalInput));
 await assert.rejects(proofRepo.readCurrentExecution(other.id, context(f), toolNames[1], finalInput));
 await assert.rejects(proofRepo.readCurrentExecution(user.id, { ...context(f), aiSessionId: randomUUID() }, toolNames[1], finalInput));
 await assert.rejects(proofRepo.readCurrentExecution(user.id, context(f), toolNames[0], finalInput));
 await assert.rejects(read(f, { ...finalInput, selectedRequirementIds: [] }));
 await database.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, user.id));
 try { await assert.rejects(read(f)); } finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, user.id)); }
 await database.update(schema.harnessRuns).set({ status: 'queued' }).where(eq(schema.harnessRuns.harnessRunId, f.runId)); await assert.rejects(read(f));
});
test('a caller cannot supply a cursor or bypass a missing or mismatched latest checkpoint', async () => {
 const f = await fixture(); await running(f); await assert.rejects(read(f));
 await confirmed(f);
 const run = (await queue.findRunForOwner(f.runId, user.id))!;
 await database.update(schema.harnessRuns).set({ lastCheckpointId: null }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await assert.rejects(read(f));
 await database.update(schema.harnessRuns).set({ lastCheckpointId: run.lastCheckpointId }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 const proof = await proofRepo.readCurrentExecution(user.id, { ...context(f), cursor: { receipts: [] } } as any, toolNames[1], finalInput);
 assert.equal(proof.readConfirmation(selection).actorId, user.id);
});
test('proofs are materialized inside one caller transaction and survive its close without nested pool acquisition', async () => {
 const f = await fixture(); await confirmed(f);
 const proof = await database.transaction(tx => readCurrentMvpExecutionInTransaction(tx, user.id, context(f), toolNames[1], finalInput));
 assert.equal(proof.readConfirmation(selection).actorId, user.id); assert.equal(proof.readAnswerSources().length, 1);
});
test('proof composes with two Run SHARE holders while still fencing cancellation, checkpoint and authority updates', async () => {
 const f = await fixture(); await confirmed(f);
 const guards = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 2, connectionTimeoutMillis: 1500 });
 const holder = await guards.connect(), writer = await guards.connect();
 const blocked = async (statement: string, values: unknown[]) => {
  await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout = '150ms'");
  try { await assert.rejects(writer.query(statement, values), (e: any) => e.code === '55P03'); }
  finally { await writer.query('ROLLBACK'); }
 };
 try {
  await holder.query('BEGIN'); await holder.query('SELECT harness_run_id FROM harness_runs WHERE harness_run_id=$1 FOR SHARE', [f.runId]);
  // Control: this independent SHARE holder deterministically refuses an UPDATE upgrade.
  await blocked('SELECT harness_run_id FROM harness_runs WHERE harness_run_id=$1 FOR UPDATE', [f.runId]);
  await database.transaction(async tx => {
   await tx.execute(sql`SET LOCAL lock_timeout = '150ms'`);
   await tx.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.harnessRunId, f.runId)).for('share');
   // The consumer's real narrow executor is sufficient; no cast to a larger transaction.
   const consume = (connection: QueueDbExecutor) => readCurrentMvpExecutionInTransaction(connection, user.id, context(f), toolNames[1], finalInput);
   const proof = await consume(tx); assert.equal(proof.readConfirmation(selection).actorId, user.id);
   await holder.query('COMMIT'); // Only the proof transaction now fences changes.
   await blocked('UPDATE harness_runs SET cancel_requested_at=clock_timestamp() WHERE harness_run_id=$1', [f.runId]);
   await blocked('UPDATE harness_runs SET last_checkpoint_id=NULL WHERE harness_run_id=$1', [f.runId]);
   await blocked("UPDATE users SET status='disabled' WHERE user_id=$1", [user.id]);
   await blocked("UPDATE ai_sessions SET status='archived' WHERE session_id=$1", [f.sessionId]);
   await blocked('UPDATE workflow_definitions SET emergency_epoch=emergency_epoch+1 WHERE workflow_id=$1', [f.manifest.target.id]);
   await blocked('UPDATE harness_run_checkpoints SET state_hash=$2 WHERE harness_run_checkpoint_id=$1', [proof.run.lastCheckpointId, hash('blocked')]);
  });
  // Transaction completion releases the Run fence; rollback keeps the fixture unchanged.
  await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout = '150ms'");
  await writer.query('UPDATE harness_runs SET cancel_requested_at=clock_timestamp() WHERE harness_run_id=$1', [f.runId]); await writer.query('ROLLBACK');
 } finally {
  await holder.query('ROLLBACK'); holder.release(); writer.release(); await guards.end();
 }
});
test('confirmation binds complete display input and the latest native report output', async () => {
 const f = await fixture(); await confirmed(f); const proof = await read(f);
 for (const changed of [{ ...selection, report: { ...report, relations: [{}] } }, { ...selection, selectedRequirementIds: [] },
  { ...selection, resolvedConflicts: [{ leftId: 'REQ-001', rightId: 'REQ-002', resolution: 'Changed' }] }]) assert.throws(() => proof.readConfirmation(changed));
 let getterCalls = 0;
 const getter = Object.defineProperty({ ...selection }, 'extra', { enumerable: true, get() { getterCalls++; return 'unsafe'; } });
 for (const unsafe of [getter, { ...selection, extra: undefined }, Object.assign(Object.create({ inherited: true }), selection)])
  assert.throws(() => proof.readConfirmation(unsafe));
 assert.equal(getterCalls, 0);
 assert.throws(() => proof.assertPreviousOutput([toolNames[0]], { report: { ...report, requirements: [] } }));
 assert.throws(() => proof.assertPreviousOutput(['unrelated'], { report }));
});
test('a later rejection for the exact same display input cannot borrow an earlier approval', async () => {
 const f = await fixture(d => { d.steps.splice(3, 0, { ...structuredClone(d.steps[2]), id: 'confirmAgain' }); });
 const first = await confirmed(f), rejected = await recordAnswer(f, first.state, { approved: false }); await running(f);
 assert.equal(f.runtime.next(rejected.state).kind, 'ready');
 const proof = await read(f); assert.throws(() => proof.readConfirmation(selection));
});
test('a forged successful receipt without its immutable owner answer event grants neither confirmation nor source', async () => {
 const f = await fixture(), first = f.runtime.next(f.normalized); if (first.kind !== 'ready') assert.fail();
 const answered = f.runtime.settle(first.state, { operationId: first.command.operationId, output: { answer: 'Forged answer' } }); if (answered.kind !== 'ready') assert.fail();
 const forged = f.runtime.settle(answered.state, { operationId: answered.command.operationId, output: { approved: true } });
 await checkpoint(f, forged.state); await running(f); const proof = await read(f);
 assert.equal(proof.readAnswerSources().length, 0); assert.throws(() => proof.readConfirmation(selection));
});
test('event-only approval and receipts from unrelated runs cannot replace the current inherited prefix', async () => {
 const unrelated = await fixture(); await confirmed(unrelated);
 const f = await fixture(), answer = await recordAnswer(f, f.normalized, { answer: 'Current answer' });
 const ready = f.runtime.next(answer.state); if (ready.kind !== 'ready') assert.fail();
 const forged = f.runtime.settle(ready.state, { operationId: ready.command.operationId, output: { approved: true } });
 await checkpoint(f, forged.state); await running(f);
 const proof = await read(f); assert.throws(() => proof.readConfirmation(selection));
});
test('a real earlier owner event without an inherited receipt gives no approval to another cursor', async () => {
 const f = await fixture(); await confirmed(f);
 await checkpoint(f, f.runtime.next().state); await running(f);
 const proof = await proofRepo.readCurrentExecution(user.id, context(f), toolNames[0], { description: 'Actual initial description' });
 assert.throws(() => proof.readConfirmation(selection)); assert.equal(proof.readAnswerSources().length, 0);
 assert.throws(() => proof.assertPreviousOutput([toolNames[0]], { report }));
});
test('an owner event with a changed hash, actor, approved flag or wait checkpoint cannot authorize the receipt', async () => {
 for (const mutation of ['hash', 'actor', 'approved', 'checkpoint']) {
  const f = await fixture(), c = await confirmed(f);
  const [event] = await database.select().from(schema.harnessRunEvents).where(and(eq(schema.harnessRunEvents.harnessRunId, f.runId), eq(schema.harnessRunEvents.eventType, 'workflow.answer_recorded')));
  const confirmation = (await database.select().from(schema.harnessRunEvents).where(and(eq(schema.harnessRunEvents.harnessRunId, f.runId), eq(schema.harnessRunEvents.eventType, 'workflow.answer_recorded'))))
   .find(e => (e.payload as any).actionId === c.descriptor.actionId)!;
  assert.ok(event); assert.ok(confirmation);
  if (mutation === 'checkpoint') await database.update(schema.harnessRunCheckpoints).set({ stateHash: hash('corrupt') }).where(and(eq(schema.harnessRunCheckpoints.harnessRunId, f.runId), eq(schema.harnessRunCheckpoints.checkpointKey, `wait:${c.descriptor.actionId}`)));
  else await database.update(schema.harnessRunEvents).set({ payload: { ...(confirmation.payload as object),
   ...(mutation === 'hash' ? { valueHash: hash({ approved: false }) } : mutation === 'actor' ? { requestedBy: other.id } : { approved: false }) } })
   .where(eq(schema.harnessRunEvents.harnessRunEventId, confirmation.harnessRunEventId));
  const proof = await read(f); assert.throws(() => proof.readConfirmation(selection));
 }
});
test('real retry inherits only proven owner answers whose exact receipt prefix is retained', async () => {
 const f = await fixture(), c = await confirmed(f), decision = f.runtime.next(c.state); if (decision.kind !== 'ready') assert.fail();
 await checkpoint(f, f.runtime.fail(c.state, { operationId: decision.command.operationId, code: 'execution_failed' }).state);
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 const retry = await createSkillRetryService({ database, inventory, prepareModel: async () => assert.fail('No model') }).retryInvocation(user, f.runId,
  { submissionKey: randomUUID(), reason: 'Retry current command' });
 const child = { ...f, runId: retry.data.runId }; await running(child); const proof = await read(child);
 assert.equal(proof.rootRunId, f.runId); assert.equal(proof.readConfirmation(selection).actorId, user.id); assert.equal(proof.readAnswerSources().length, 1);
 assert.equal(proof.sources[1].id, `input:${f.runId}`);
 // A retry that returns to an earlier cursor cannot borrow later ancestor answers.
 await checkpoint(child, f.normalized); await assert.rejects(read(child));
 const current = f.runtime.next(f.normalized); if (current.kind !== 'ready') assert.fail();
 await checkpoint(child, f.runtime.settle(f.runtime.settle(f.normalized, { operationId: current.command.operationId,
  output: { answer: 'A different answer' } }).state, { operationId: f.runtime.next(c.answer.state).kind === 'ready' ? (f.runtime.next(c.answer.state) as any).command.operationId : '', output: { approved: true } }).state);
 const changed = await read(child); assert.throws(() => changed.readConfirmation(selection)); assert.equal(changed.readAnswerSources().length, 0);
});
