import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
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
import { createBusinessSkillHost } from '../harness/business-skills.host';
import { createExecutionAuthority } from './execution-authority';
import { createSkillRetryService } from './skills.retry';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { skillToolContract } from './skills.context';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from './skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 }), database = drizzle(pool, { schema });
const queue = createHarnessRuntimeRepository(database), user = { id: randomUUID(), username: `retry-cp-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const input = { text: 'Owned' }, parameters = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
let reads = 0, models = 0;
const tool = { name: 'retry_checkpoint_read', description: 'Read fixture', parameters, mutates: false, exfiltrates: false, simulationOnly: false,
 source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const, async execute() { reads++; return { read: reads }; } };
const inventory = async () => ({ tools: [tool], registry: { get: (name: string) => name === tool.name ? tool : undefined }, policy: { schemaVersion: 1, policies: {} } }) as any;
const definition: SkillDefinition = { name: 'Retry saved ordinal', description: '', category: 'fixture', instructions: 'Frozen', roles: ['pre_sales'], inputSchema: parameters, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
 references: [], tools: [{ toolName: tool.name, requiresConfirmation: false, inputMapping: { text: '$.text' } }], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: [skillToolContract(tool)], snapshot: { schemaVersion: 1, references: [], tools: [{ native: { ...skillToolContract(tool), source: 'code', sandboxReadSafe: true, capability: tool.capability }, policy: DEFAULT_TOOL_POLICY_ENTRY }], roles: ['ADMIN'], model: {
 providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
const prepareModel = async (_skill: any, _signal: AbortSignal, ports: any) => ({ transportProvider: 'fixture', async complete(request: any) {
 await ports.beforeDispatch(); models++;
 return { provider: 'fixture', model: 'fixed', usage: { outputTokens: 2 }, ...(request.toolResults.length ? { output: { ok: true } }
  : { toolCalls: [{ id: 'call0', name: tool.name, arguments: input }, { id: 'call1', name: tool.name, arguments: input }] }) };
} });
async function fixture() {
 const roots = createSkillsPgRepository(database); let root = await roots.create(definition, { id: user.id, username: user.username });
 root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Retry CP', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const response = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution, authority: createExecutionEmergencyRepository(database) })
  .submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Retry frozen cursor', execution: { kind: 'skill', skillId: root.skillId, input } });
 return response.data.runId;
}
async function worker(stopAfterFirstRead = false) {
 const executor = createBusinessSkillHost({ database, inventory, prepareModel });
 const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor, createAuthority: () => createExecutionAuthority(database, inventory) })]);
 return createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID(), faultInjector: (_step, phase) => {
  if (stopAfterFirstRead && phase === 'beforeStep' && reads === 1) throw new HarnessFaultInjectedError('STOP AFTER FIRST SAVED TOOL');
 } }).runNextAttempt();
}
const retry = () => createSkillRetryService({ database, inventory, prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => assert.fail('Preparation cannot dispatch') }) });
async function failed(runId: string) {
 await database.update(schema.harnessRunAttempts).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(schema.harnessRunAttempts.harnessRunId, runId));
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, runId));
}
afterEach(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); });
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, 0); await pool.end(); await closeDb(); });
test('retry atomically binds the actual latest checkpoint to a new physical Run and keeps completed model/tool ordinals', async () => {
 reads = 0; models = 0; const runId = await fixture(); await worker(true); assert.equal(reads, 1); assert.equal(models, 1); await failed(runId);
 const source = (await queue.getRunSnapshot(runId))!, checkpoint = source.checkpoint!;
 assert.equal((checkpoint.state as any).businessSkills.state.skill.nextToolIndex, 1);
 const command = { submissionKey: randomUUID(), reason: 'Resume saved ordinal' }, response = await retry().retryInvocation(user, runId, command), newRunId = response.data.runId;
 const copied = (await queue.getRunSnapshot(newRunId))!; assert.ok(copied.checkpoint);
 assert.equal((copied.checkpoint.state as any).businessSkills.runId, newRunId);
 assert.equal((copied.checkpoint.state as any).businessSkills.state.skill.runId, runId);
 assert.equal((copied.checkpoint.state as any).businessSkills.state.skill.nextToolIndex, 1);
 assert.deepEqual((copied.run.metadata as any).retrySourceCheckpoint, { runId, checkpointId: checkpoint.harnessRunCheckpointId, sequence: checkpoint.sequence, stateHash: checkpoint.stateHash });
 assert.equal((await retry().retryInvocation(user, runId, command)).data.runId, newRunId);
 assert.equal((await queue.listCheckpointsForRun({ runId: newRunId })).length, 1);
 await worker(); assert.equal((await queue.findRunForOwner(newRunId, user.id))!.status, 'completed');
 assert.equal(reads, 2); assert.equal(models, 2); assert.deepEqual((await queue.getRunSnapshot(newRunId))!.output!.content, { ok: true });
});
test('a completed checkpoint resumes directly to final without replaying a completed model or tool', async () => {
 reads = 0; models = 0; const runId = await fixture(); await worker(); assert.equal(reads, 2); assert.equal(models, 2); await failed(runId);
 const response = await retry().retryInvocation(user, runId, { submissionKey: randomUUID(), reason: 'Recover completed checkpoint' });
 const cp = (await queue.getRunSnapshot(response.data.runId))!.checkpoint; assert.ok(cp); assert.equal((cp.state as any).businessSkills.state.skill.phase, 'completed');
 await worker(); assert.equal((await queue.findRunForOwner(response.data.runId, user.id))!.status, 'completed'); assert.equal(reads, 2); assert.equal(models, 2);
});
test('orphan and corrupt latest source checkpoints are rejected without creating a retry Run', async () => {
 reads = 0; models = 0; const runId = await fixture(); await worker(true); await failed(runId);
 const source = (await queue.getRunSnapshot(runId))!, before = (await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length;
 await database.update(schema.harnessRunCheckpoints).set({ stateHash: '0'.repeat(64) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, source.checkpoint!.harnessRunCheckpointId));
 await assert.rejects(retry().retryInvocation(user, runId, { submissionKey: randomUUID(), reason: 'Corrupt source' }), (e: any) => e.status === 409);
 await database.update(schema.harnessRuns).set({ lastCheckpointId: null }).where(eq(schema.harnessRuns.harnessRunId, runId));
 await assert.rejects(retry().retryInvocation(user, runId, { submissionKey: randomUUID(), reason: 'Orphan source' }), (e: any) => e.status === 409);
 assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, before);
});
