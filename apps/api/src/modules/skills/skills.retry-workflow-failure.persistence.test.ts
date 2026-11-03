import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import express from 'express';
import request from 'supertest';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { signAuthToken } from '../../middleware/auth';
import { createAiRunsRouter } from '../../routes/ai-runs.routes';
import { createBusinessSkillsWorkbenchService } from './skills.workbench-actions';
import { createSkillRetryService } from './skills.retry';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry, hashHarnessCheckpointState } from '../harness/harness-runtime.worker';
import { createBusinessSkillsWorkflow, readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { createBusinessSkillsWorkflowExecutor } from '../harness/business-skills.workflow-host';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { createExecutionAuthority } from './execution-authority';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { skillDefinitionHash as hash } from './skills.hash';
import { HARNESS_WORKER_VALIDATOR_VERSION } from '../harness/harness-runtime.types';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from './skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 }), database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `retry-workflow-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const inventory = async () => ({ tools: [], registry: { get: () => undefined }, policy: { schemaVersion: 1, policies: {} } }) as any;
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const definition: SkillDefinition = { name: 'Retry child', description: '', category: 'fixture', instructions: 'Frozen', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
 references: [], tools: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const loadSkillContext = async (d: SkillDefinition): Promise<any> => ({ tools: [], snapshot: { schemaVersion: 1, references: [], tools: [], roles: ['ADMIN'], model: {
 providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } });
let repaired = false, firstCalls = 0, secondCalls = 0;
const prepareModel = async (skill: any, _signal: AbortSignal, ports: any) => ({ transportProvider: 'fixture', async complete() {
 await ports.beforeDispatch(); if (skill.stepId === 'first') firstCalls++; else secondCalls++;
 return { provider: 'fixture', model: 'fixed', usage: { outputTokens: 2 }, output: skill.stepId === 'first' ? { text: 'first' } : repaired ? { text: 'repaired' } : { wrong: true } };
} });
async function tick() {
 const executor = createBusinessSkillsWorkflowExecutor({ database, inventory, prepareModel });
 await createHarnessRuntimeWorker({ repository: queue, registry: createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor, createAuthority: () => createExecutionAuthority(database, inventory) })]), workerId: randomUUID() }).runNextAttempt();
}
async function fixture(repeatLimit = false) {
 const roots = createSkillsPgRepository(database), children = [];
 for (const name of ['first', 'second']) { let root = await roots.create({ ...definition, name }, { id: user.id, username: user.username }); root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; }); children.push(root); }
 const workflows = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, getTools: async () => [], loadSkillContext }), user);
 let workflow = await workflows.create({ name: 'Failed child recovery', description: '', category: 'fixture', roles: ['pre_sales'], inputSchema: { type: 'object' }, outputSchema: payload,
 steps: children.map((child, index) => ({ id: index === 0 ? 'first' : 'second', name: index === 0 ? 'First' : 'Second', type: 'skill' as const, skillId: child.skillId, skillVersionId: child.currentVersionId,
  inputMapping: [{ target: 'text', source: index === 0 ? { kind: 'literal' as const, value: 'input' } : { kind: 'path' as const, path: '$.steps.first.output.text' } }], onFailure: 'fail' as const,
  ...(repeatLimit && index === 0 ? { repeat: { while: [{ path: '$.steps.first.output.text', op: 'eq' as const, value: 'first' }], maxIterations: 1, onLimit: 'fail' as const } } : {}) })),
 outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.second.output.text' } }] });
 workflow = await workflows.validate(workflow.workflowId, workflow.revision); workflow = await workflows.review(workflow.workflowId, workflow.revision, 'Retry workflow fixture'); workflow = await workflows.publish(workflow.workflowId, workflow.revision);
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Failed child', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const manifests = createExecutionManifestService({ database, loadSkillContext, loadWorkflowTools: async () => [] });
 const accepted = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), authority: createExecutionEmergencyRepository(database), prepareExecution: manifests.prepareExecution }).submitInvocation(user, sessionId,
  { submissionKey: randomUUID(), content: 'Recover failed child', execution: { kind: 'workflow', workflowId: workflow.workflowId, input: {} } });
 await tick(); return accepted.data.runId;
}
const retryService = createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => assert.fail('Preparation cannot dispatch') }) });
const api = express(); api.use(express.json()); api.use('/ai-runs', createAiRunsRouter({ repo: queue, enabled: true, business: createBusinessSkillsWorkbenchService({ database, repo: queue, inventory, retryService }) }));
const retry = (runId: string) => request(api).post(`/ai-runs/${runId}/retry`).set('Authorization', `Bearer ${signAuthToken(user)}`).send({ submissionKey: randomUUID(), reason: 'Retry failed child' });
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
afterEach(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); repaired = false; firstCalls = 0; secondCalls = 0; });
after(async () => { await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id)); assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, 0); await pool.end(); await closeDb(); });
test('public retry reopens only the failed child receipt, preserving the successful prefix and immutable source checkpoint', async () => {
 const runId = await fixture(), source = (await queue.getRunSnapshot(runId))!; assert.equal(source.run.status, 'failed'); assert.equal(firstCalls, 1); assert.equal(secondCalls, 1);
 const manifest = readBusinessSkillsRun(source.run), oldState: any = source.checkpoint!.state, receipts = oldState.businessSkills.state.workflow.receipts;
 assert.equal(receipts.length, 2); assert.equal(receipts[0].status, 'succeeded'); assert.equal(receipts[1].status, 'failed');
 const sourceHash = hash(source.checkpoint), response = await retry(runId); assert.equal(response.status, 202); const newRunId = response.body.data.runId;
 const copied = (await queue.getRunSnapshot(newRunId))!, nextState: any = copied.checkpoint!.state;
 assert.deepEqual(nextState.businessSkills.state.workflow.receipts, receipts.slice(0, 1));
 assert.equal(nextState.businessSkills.runId, newRunId); assert.equal(nextState.businessSkills.state.workflow.executionId, runId);
 assert.deepEqual(readBusinessSkillsRun(copied.run), manifest); assert.equal((copied.run.metadata as any).retrySourceCheckpoint.stateHash, source.checkpoint!.stateHash);
 repaired = true; await tick(); const finished = (await queue.getRunSnapshot(newRunId))!;
 assert.equal(finished.run.status, 'completed'); assert.deepEqual(finished.output!.content, { text: 'repaired' }); assert.equal(firstCalls, 1); assert.equal(secondCalls, 2);
 assert.equal(hash((await queue.getRunSnapshot(runId))!.checkpoint), sourceHash);
});
test('retry cannot reset a repeat-limit failure', async () => {
 const limited = await fixture(true), source = (await queue.getRunSnapshot(limited))!; assert.equal(source.run.status, 'failed'); assert.equal(firstCalls, 1); assert.equal(secondCalls, 0);
 const count = (await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length;
 assert.equal((await retry(limited)).status, 409); assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, count);
 assert.deepEqual((await queue.getRunSnapshot(limited))!.checkpoint, source.checkpoint); assert.equal(firstCalls, 1); assert.equal(secondCalls, 0);
});
test('retry cannot silently remove an explicit rejected receipt', async () => {
 const rejected = await fixture(), saved = (await queue.getRunSnapshot(rejected))!, manifest = readBusinessSkillsRun(saved.run), raw: any = saved.checkpoint!.state;
 const runtime = createWorkflowRuntime(manifest, rejected), workflow = raw.businessSkills.state.workflow;
 const prefix = { ...workflow, receipts: workflow.receipts.slice(0, -1) }, command = runtime.next(prefix); assert.equal(command.kind, 'ready'); if (command.kind !== 'ready') assert.fail('Missing failed command');
 const state = { businessSkills: { ...raw.businessSkills, state: { schemaVersion: 1, kind: 'workflow', workflow: runtime.fail(prefix, { operationId: command.command.operationId, code: 'rejected' }).state } }, nextStepKey: 'execute' };
 await queue.commitCheckpoint({ runId: rejected, checkpointKey: 'explicit-rejected', checkpointKind: 'structural', workflowId: saved.run.workflowId!, workflowVersion: saved.run.workflowVersion!, stepKey: 'execute', resumePolicy: 'restart_step', state, stateHash: hashHarnessCheckpointState(state), runtimeValidation: { validatedAt: new Date().toISOString(), validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION, checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } } });
 const checkpoint = (await queue.getRunSnapshot(rejected))!.checkpoint; const count = (await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length;
 assert.equal((await retry(rejected)).status, 409); assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, count);
 assert.deepEqual((await queue.getRunSnapshot(rejected))!.checkpoint, checkpoint);
});
