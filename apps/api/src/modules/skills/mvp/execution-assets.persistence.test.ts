import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../../test-helpers/execution-database-guard';
import { createExecutionAssetPgRepository } from './execution-assets-pg.repository';
import { createExecutionManifestService } from '../execution-manifest';
import { createSkillsPgRepository } from '../skills-pg.repository';
import { createSkillInvocationService } from '../skills.invocation';
import { createInvocationPgRepository } from '../skills.invocation-pg.repository';
import { createHarnessRuntimeRepository } from '../../harness/harness-runtime.repository';
import { createExecutionEmergencyRepository } from '../execution-emergency';
import { createExecutionAuthority } from '../execution-authority';
import { createSkillRetryService } from '../skills.retry';
import { createBusinessSkillHost } from '../../harness/business-skills.host';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry } from '../../harness/harness-runtime.worker';
import { readBusinessSkillsRun, createBusinessSkillsWorkflow } from '../../harness/business-skills.workflow';
import { skillDefinitionHash as hash } from '../skills.hash';
import type { AuthUser } from '../../../types';
import type { SkillDefinition } from '../skills.types';
const url = resolveExecutionTestDatabaseUrl(process.env);
test('real queued run freezes selected product rows/rules and owned conversation; later changes never replace its catalog', async t => {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 1000 }); const database = drizzle(pool, { schema });
  const id = randomUUID(), other = randomUUID(), user = { id: randomUUID(), username: `assets-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
  const now = new Date(), sessionId = randomUUID(), messageId = randomUUID();
  const originalTables = ['product_templates', 'product_lines', 'product_skus', 'product_sku_module_assignments', 'rule_sets'];
  const baseline: Record<string, string> = {};
  for (const table of originalTables) baseline[table] = hash((await pool.query(`SELECT row_to_json(t) row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows);
  const definition: SkillDefinition = { name: 'Real asset freeze', description: '', category: 'test', instructions: 'Use frozen source data', roles: ['pre_sales'],
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 }, tools: [], references: [], examples: [] };
  const service = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: [], snapshot: { schemaVersion: 1, tools: [], references: [], roles: ['ADMIN'],
    model: { providerId: 'fixture', model: 'fixture', modelSource: 'binding', credentialScope: 'fixture', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as never });
  try {
    await database.insert(schema.users).values({ userId: user.id, username: user.username, role: user.role, businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: now });
    await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Owned asset fixture', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat',
      messages: [{ messageId, role: 'user', content: '  actual owned original\nline 2  ', createdAt: now.toISOString() }], createdAt: now, updatedAt: now });
    // Own rows only: do not deactivate, rewrite or borrow the current global catalog.
    for (const templateId of [id, other]) await database.insert(schema.productTemplates).values({ templateId, templateVersion: 'v1', templateName: templateId, isActive: true, groupsSnapshot: [], sheetsSnapshot: [], createdAt: now, updatedAt: now });
    for (const table of [schema.productLines, schema.productSkus]) await database.insert(table).values({ id, name: `Fixture ${id}`, createdAt: now, updatedAt: now });
    await database.insert(schema.productSkuModuleAssignments).values([id, other].map((templateId, i) => ({ id: templateId, templateId, productId: id, skuId: id, moduleId: null,
      templateItemId: `item-${i}`, groupId: 'g', groupName: 'Group', itemName: 'Actual product point', standardDays: i ? 17 : 3,
      status: 'active' as const, createdAt: now, updatedAt: now })));
    await database.insert(schema.ruleSets).values({ ruleSetId: id, ruleVersion: 'v1', pipelineVersion: 'v1', pipeline: ['base'], baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 1 }], difficultyFactorList: [1] }, orgIncrementRule: { enabled: false }, updatedAt: new Date(now.getTime() + 86400000) });
    const roots = createSkillsPgRepository(database), actor = { id: user.id, username: user.username };
    let root = await roots.create(definition, actor); root = await roots.mutate(root.skillId, root.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
    const request = { kind: 'skill', skillId: root.skillId, input: { text: 'original direct description' }, sources: [{ kind: 'conversation', id: messageId }], assets: [{ kind: 'assessment-catalog', templateId: id }] };
    const queue = createHarnessRuntimeRepository(database);
    const result = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: service.prepareExecution }).submitInvocation(user, sessionId,
      { submissionKey: randomUUID(), content: 'Freeze selected catalog', execution: request });
    const run = (await queue.findRunForOwner(result.data.runId, user.id))!, frozen = readBusinessSkillsRun(run);
    assert.equal(frozen.assetBindings[0].templateId, id); assert.equal(frozen.assetBindings[0].template.items[0].standardDays, 3);
    assert.equal(frozen.assetBindings[0].ruleSet.ruleSetId, id); assert.equal(frozen.sourceMaterials![0].text, '  actual owned original\nline 2  ');
    const prepared = await service.prepareExecution({ ...request, sources: [] }, user);
    await database.update(schema.productSkuModuleAssignments).set({ standardDays: 9 }).where(eq(schema.productSkuModuleAssignments.id, id));
    await database.update(schema.ruleSets).set({ ruleVersion: 'v2', pipeline: ['changed'] }).where(eq(schema.ruleSets.ruleSetId, id));
    await assert.rejects(database.transaction(tx => prepared.resolveInTransaction(tx)), (e: any) => e.code === 'EXECUTION_CONTEXT_CHANGED');
    const restored = readBusinessSkillsRun((await queue.findRunForOwner(result.data.runId, user.id))!);
    assert.deepEqual(restored, frozen); assert.equal(restored.assetBindings[0].ruleSet.ruleVersion, 'v1');
    const noPoolAcquisition = await database.transaction(async tx => createExecutionAssetPgRepository().read(tx, [{ kind: 'assessment-catalog', templateId: id }]));
    assert.equal(noPoolAcquisition[0].template.items[0].standardDays, 9); // pool max=1: nested pool acquisition would hang.
    const inventory = async () => ({ tools: [], registry: { get: () => undefined }, policy: { schemaVersion: 1, policies: {} } }) as any;
    let modelCalls = 0, modelFails = false;
    const prepareModel = async (_skill: any, _signal: AbortSignal, ports: any = {}) => ({ transportProvider: 'fixture', async complete() {
      await ports.beforeDispatch(); modelCalls++; if (modelFails) throw new Error('FIXTURE_MODEL_FAIL');
      return { provider: 'fixture', model: 'fixture', usage: { outputTokens: 2 }, output: { ok: true } };
    } });
    const tick = () => createHarnessRuntimeWorker({ repository: queue, workerId: randomUUID(), registry: createHarnessWorkflowRegistry([
      createBusinessSkillsWorkflow({ executor: createBusinessSkillHost({ database, inventory, prepareModel }), createAuthority: () => createExecutionAuthority(database, inventory) }),
    ]) }).runNextAttempt();
    await t.test('asset Run passes real emergency admission and current execution authority', async () => {
      assert.equal((await createExecutionEmergencyRepository(database).assertRunAdmission(run.harnessRunId, user.id)).manifest.manifestHash, frozen.manifestHash);
      await createExecutionAuthority(database, inventory).check({ runId: run.harnessRunId, ownerUserId: user.id, manifestHash: frozen.manifestHash, phase: 'resume' });
    });
    await t.test('production Worker dispatches asset Run through real authority and durable budget', async () => {
      await tick(); const saved = (await queue.getRunSnapshot(run.harnessRunId))!;
      assert.equal(saved.run.status, 'completed'); assert.deepEqual(saved.output!.content, { ok: true }); assert.equal(modelCalls, 1);
      assert.deepEqual(readBusinessSkillsRun(saved.run), frozen);
      const budget = await pool.query("SELECT status FROM harness_tool_events WHERE harness_run_id=$1 AND event_type='business_budget_reservation'", [run.harnessRunId]);
      assert.deepEqual(budget.rows, [{ status: 'succeeded' }]);
    });
    await t.test('failed asset execution retries with its frozen manifest and shared real budget', async () => {
      modelFails = true;
      const failed = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: service.prepareExecution })
        .submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Fail then retry selected catalog', execution: request });
      await tick(); assert.equal((await queue.findRunForOwner(failed.data.runId, user.id))!.status, 'failed');
      const original = readBusinessSkillsRun((await queue.findRunForOwner(failed.data.runId, user.id))!);
      const retried = await createSkillRetryService({ database, inventory, prepareModel }).retryInvocation(user, failed.data.runId, { submissionKey: randomUUID(), reason: 'Retry actual model failure' });
      assert.equal(modelCalls, 2); modelFails = false; await tick();
      const saved = (await queue.getRunSnapshot(retried.data.runId))!; assert.equal(saved.run.status, 'completed'); assert.equal(modelCalls, 3);
      assert.deepEqual(readBusinessSkillsRun(saved.run), original); assert.deepEqual(saved.output!.content, { ok: true });
      const reservations = await pool.query("SELECT status FROM harness_tool_events WHERE harness_run_id=$1 AND event_type='business_budget_reservation' ORDER BY created_at", [failed.data.runId]);
      assert.deepEqual(reservations.rows, [{ status: 'failed' }, { status: 'succeeded' }]);
    });
  } finally {
    try {
    await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
    await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
    await database.delete(schema.users).where(eq(schema.users.userId, user.id));
    await database.delete(schema.productSkuModuleAssignments).where(inArray(schema.productSkuModuleAssignments.templateId, [id, other]));
    await database.delete(schema.productTemplates).where(inArray(schema.productTemplates.templateId, [id, other]));
    await database.delete(schema.ruleSets).where(eq(schema.ruleSets.ruleSetId, id));
    for (const table of [schema.productLines, schema.productSkus]) await database.delete(table).where(eq(table.id, id));
    for (const table of originalTables) assert.equal(hash((await pool.query(`SELECT row_to_json(t) row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows), baseline[table]);
    for (const [table, column, values] of [['harness_runs', 'owner_user_id', [user.id]], ['ai_sessions', 'owner_user_id', [user.id]], ['users', 'user_id', [user.id]],
      ['product_templates', 'template_id', [id, other]], ['product_sku_module_assignments', 'template_id', [id, other]], ['rule_sets', 'rule_set_id', [id]]] as Array<[string, string, string[]]>)
      assert.equal(Number((await pool.query(`SELECT count(*) n FROM ${table} WHERE ${column}=ANY($1)`, [values])).rows[0].n), 0);
    // Published root/revision rows remain immutable audit evidence, as in the other execution suites.
    } finally { await pool.end(); }
  }
});
