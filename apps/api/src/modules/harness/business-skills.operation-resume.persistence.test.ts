import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import express from 'express';
import request from 'supertest';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { signAuthToken } from '../../middleware/auth';
import { createAiRunsRouter } from '../../routes/ai-runs.routes';
import { createBusinessSkillsWorkbenchService } from '../skills/skills.workbench-actions';
import { createHarnessRuntimeRepository } from './harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry } from './harness-runtime.worker';
import { createBusinessSkillsWorkflow } from './business-skills.workflow';
import { createBusinessSkillHost } from './business-skills.host';
import { createBusinessSkillOperationWaitService } from './business-skills.operation-wait';
import { createExecutionAuthority } from '../skills/execution-authority';
import { createExecutionManifestService } from '../skills/execution-manifest';
import { createSkillsPgRepository } from '../skills/skills-pg.repository';
import { createSkillInvocationService } from '../skills/skills.invocation';
import { createInvocationPgRepository } from '../skills/skills.invocation-pg.repository';
import { createExecutionEmergencyRepository } from '../skills/execution-emergency';
import { skillToolContract } from '../skills/skills.context';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { buildCreateProjectTool } from '../../agent/tools/mutation.tools';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from '../skills/skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 }), database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `resume-fence-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const tool = { ...buildCreateProjectTool(async () => assert.fail('Native write must never run')), source: 'code' as const };
const inventory = async () => ({ tools: [tool], registry: { get: (name: string) => name === tool.name ? tool : undefined }, policy: { schemaVersion: 1, policies: {} } }) as any;
const input = { projectName: 'Resume fence' };
const definition: SkillDefinition = { name: 'Resume fence', description: '', category: 'fixture', instructions: 'Frozen', roles: ['pre_sales'], inputSchema: tool.parameters,
 outputSchema: { type: 'object' }, references: [], tools: [{ toolName: tool.name, requiresConfirmation: true, inputMapping: { projectName: '$.projectName' } }], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: [skillToolContract(tool)], snapshot: { schemaVersion: 1, references: [], tools: [{ native: { ...skillToolContract(tool), source: 'code', sandboxReadSafe: false, capability: tool.capability }, policy: DEFAULT_TOOL_POLICY_ENTRY }], roles: ['ADMIN'],
 model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture() {
 const roots = createSkillsPgRepository(database); let root = await roots.create(definition, { id: user.id, username: user.username });
 root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Resume fence', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const accepted = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), authority: createExecutionEmergencyRepository(database), prepareExecution: manifests.prepareExecution })
  .submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Prepare confirmation', execution: { kind: 'skill', skillId: root.skillId, input } });
 const executor = createBusinessSkillHost({ database, inventory, prepareModel: async (_skill, _signal, ports) => ({ transportProvider: 'fixture', async complete() {
  await ports!.beforeDispatch!(); return { provider: 'fixture', model: 'fixed', usage: { outputTokens: 2 }, toolCalls: [{ id: 'call', name: tool.name, arguments: input }] };
 } }) });
 await createHarnessRuntimeWorker({ repository: queue, registry: createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor, createAuthority: () => createExecutionAuthority(database, inventory) })]), workerId: randomUUID() }).runNextAttempt();
 const view = await createBusinessSkillOperationWaitService({ database, inventory }).read(user, accepted.data.runId);
 return { root, runId: accepted.data.runId, view };
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
afterEach(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.update(schema.users).set({ role: 'admin', businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); });
after(async () => { await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id)); assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, 0); await pool.end(); await closeDb(); });
for (const revoke of ['role', 'businessRole', 'epoch'] as const) test(`public operation confirmation preserves the committed decision but cannot queue after ${revoke} is revoked`, { timeout: 15000 }, async () => {
 const f = await fixture(), committed = deferred(), release = deferred();
 const wrapped = Object.create(database); let gated = false;
 wrapped.transaction = async (callback: any, config: any) => {
  const value = await database.transaction(callback, config);
  if (!gated && (value as any)?.operationId === f.view.operationId && (value as any)?.status === 'approved') { gated = true; committed.resolve(); await release.promise; }
  return value;
 };
 const api = express(); api.use(express.json()); api.use('/ai-runs', createAiRunsRouter({ repo: queue, enabled: true, business: createBusinessSkillsWorkbenchService({ database: wrapped, repo: queue, inventory }) }));
 const pending = request(api).post(`/ai-runs/${f.runId}/actions/${f.view.actionId}/confirm`).set('Authorization', `Bearer ${signAuthToken(user)}`).send({ confirmationHash: f.view.confirmationHash }).then(value => value);
 try {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('decision commit gate was not reached')), 5000); committed.promise.then(() => { clearTimeout(timer); resolve(); }); });
  const decisions = await database.select().from(schema.harnessToolEvents).where(and(eq(schema.harnessToolEvents.harnessRunId, f.runId), eq(schema.harnessToolEvents.eventType, 'business_operation_decision')));
  assert.equal(decisions.length, 1); assert.equal(decisions[0].status, 'approved'); assert.equal((await queue.findRunForOwner(f.runId, user.id))!.status, 'waiting');
  if (revoke === 'role') await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
  else if (revoke === 'businessRole') await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
  else await database.update(schema.skillDefinitions).set({ emergencyEpoch: 1 }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
 } finally { release.resolve(); }
 const response = await pending;
 assert.ok([403, 409].includes(response.status), JSON.stringify({ status: response.status, code: response.body.code }));
 assert.equal((await queue.findRunForOwner(f.runId, user.id))!.status, 'waiting');
 assert.equal((await database.select().from(schema.harnessToolEvents).where(and(eq(schema.harnessToolEvents.harnessRunId, f.runId), eq(schema.harnessToolEvents.eventType, 'business_operation_decision'))))[0].status, 'approved');
 assert.equal((await database.select().from(schema.harnessToolEvents).where(and(eq(schema.harnessToolEvents.harnessRunId, f.runId), eq(schema.harnessToolEvents.eventType, 'business_operation_executed')))).length, 0);
});
