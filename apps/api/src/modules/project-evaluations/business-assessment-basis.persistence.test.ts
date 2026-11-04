import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createBusinessAssessmentBasisService } from './business-assessment-basis.usecase';
import { createBusinessAssessmentBasisRepository } from './business-assessment-basis.repository';
import { buildMvpAssessmentDraftTools } from '../../agent/tools/mvp-assessment-draft.tools';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createExecutionManifestService } from '../skills/execution-manifest';
import { createSkillInvocationService } from '../skills/skills.invocation';
import { createInvocationPgRepository } from '../skills/skills.invocation-pg.repository';
import { readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { hashHarnessCheckpointState } from '../harness/harness-runtime.worker';
import { HARNESS_WORKER_VALIDATOR_VERSION } from '../harness/harness-runtime.types';
import { createSkillOperationService } from '../skills/skills.operations';
import { createSkillOperationDecisionService } from '../skills/skills.operation-decisions';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { assessmentCatalogDigest } from '../skills/mvp/assessment-matching';
import { normalizeRequirementCandidates, confirmRequirements, requirementReportDigest, mvpObject } from '../skills/mvp/requirements';
import type { AuthUser, RuleSet, Template } from '../../types';

const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const owner = { id: randomUUID(), username: `basis-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const foreign = { ...owner, id: randomUUID(), username: `basis-other-${randomUUID()}` };
const template: Template = { templateId: 'basis-test', templateVersion: 'test-1', templateName: 'TEST ONLY 2 + 3', groups: [{ groupId: 'g', groupName: 'G' }],
 items: [{ templateItemId: 'one', groupId: 'g', itemName: 'One', standardDays: 2 }, { templateItemId: 'two', groupId: 'g', itemName: 'Two', standardDays: 3 }] };
const ruleSet: RuleSet = { ruleSetId: 'basis-rules', ruleVersion: 'test-1', pipelineVersion: 'test-1', pipeline: ['itemRule', 'grouping', 'baseRule'],
 baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 0 }], difficultyFactorList: [0, 0.5] }, orgIncrementRule: { enabled: false } };
const snapshotDigest = assessmentCatalogDigest({ template, ruleSet });
const params = { userCount: 50, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 };
const body = { templateId: template.templateId, ruleSetId: ruleSet.ruleSetId, ...params,
 items: template.items.map(i => ({ templateItemId: i.templateItemId, included: true })) };
const native = buildMvpAssessmentDraftTools(owner.id)[0];
const { execute: _execute, category: _category, discoverable: _discoverable, ...contract } = native;
const tools = [{ ...contract, source: 'code' as const, exfiltrates: false, simulationOnly: false, sandboxReadSafe: false,
 requiresConfirmation: true, allowedRoles: ['pre_sales'], policy: DEFAULT_TOOL_POLICY_ENTRY }];
const inventory = async () => ({ tools, registry: { get: () => tools[0] }, policy: { schemaVersion: 1, policies: {} } }) as any;
const service = createBusinessAssessmentBasisService(createBusinessAssessmentBasisRepository(database));
before(async () => { for (const user of [owner, foreign]) await database.insert(schema.users).values({ userId: user.id, username: user.username,
 role: user.role, businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { try {
 await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, owner.id));
 await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, owner.id));
 await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, owner.id));
 // Keep append-only TEST ONLY history while removing these fixtures from authorized catalogs.
 const roots = await database.select().from(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.name, 'TEST ONLY frozen basis'));
 const workflows = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, getTools: async () => tools as any }), owner);
 for (const root of roots) if (root.enabled || !root.archived) await workflows.status(root.workflowId, root.revision, { enabled: false, archived: true });
 const retained = await database.select().from(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.name, 'TEST ONLY frozen basis'));
 assert.equal(retained.every(r => !r.enabled && r.archived), true);
 const ids = roots.map(r => r.workflowId);
 const versions = ids.length ? await database.select({ id: schema.workflowVersions.workflowVersionId }).from(schema.workflowVersions).where(inArray(schema.workflowVersions.workflowId, ids)) : [];
 const revisions = ids.length ? await database.select({ id: schema.workflowRevisions.id }).from(schema.workflowRevisions).where(inArray(schema.workflowRevisions.workflowId, ids)) : [];
 console.info(`TEST ONLY retained archived workflows=${roots.length} versions=${versions.length} revisions=${revisions.length}`);
 // Also remove accounts retained by this file's earlier failed after-hook, identified by its unique fixture naming contract.
 const fixtureUsers = await database.select({ id: schema.users.userId }).from(schema.users).where(sql`${schema.users.username} ~ '^basis-(other-)?[a-f0-9-]{36}$'`);
 if (fixtureUsers.length) await database.delete(schema.users).where(inArray(schema.users.userId, fixtureUsers.map(u => u.id)));
 assert.equal((await database.select({ id: schema.users.userId }).from(schema.users).where(sql`${schema.users.username} ~ '^basis-(other-)?[a-f0-9-]{36}$'`)).length, 0);
 } finally { await pool.end(); await closeDb(); } });
async function record(payload: Record<string, unknown> = {}, type = 'assessment') {
 const recordId = randomUUID(); await database.insert(schema.versionRecords).values({ recordId, type, ownerUserId: owner.id,
 versionCode: 'TEST-A0', baseCode: 'TEST-A0', templateId: template.templateId, status: 'draft', payload, createdAt: new Date(), updatedAt: new Date(),
 createdByUserId: owner.id, updatedByUserId: owner.id, createdByUsername: owner.username, updatedByUsername: owner.username }); return recordId;
}
/** Real native preparation and explicit approval, followed by a TEST-ONLY success ledger fixture.
 * This tests historical provenance/HTTP behavior, never LLM or end-user acceptance. */
async function fixture() {
 const report = normalizeRequirementCandidates({ sources: [{ id: 's', kind: 'conversation', text: 'Orders' }] }, { requirements: [
 { title: 'Orders', description: 'Orders', role: 'Sales', action: 'Process', object: 'Order', constraints: [], openQuestions: [], assumptions: [], sources: [{ sourceId: 's', quote: 'Orders', start: 0, end: 6 }] } ], relations: [] });
 const requirements = confirmRequirements(report, { reportDigest: requirementReportDigest(report), requirementIds: ['REQ-001'], actorId: owner.id, decisionId: randomUUID() });
 const matching = { requirementReportDigest: requirementReportDigest(report), templateId: template.templateId, templateVersion: template.templateVersion,
 ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion, snapshotDigest, matches: [{ reqId: 'REQ-001', templateItemIds: ['one', 'two'], scope: 'include', rationale: 'Test' }], unmatched: [], params, aiAdjustments: [] };
 const parameters = { projectName: 'TEST ONLY', requirements, matching, selectedItemIds: ['one', 'two'], params };
 const workflows = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, getTools: async () => tools as any }), owner);
 let workflow = await workflows.create({ name: 'TEST ONLY frozen basis', description: '', category: 'fixture', roles: ['pre_sales'], inputSchema: mvpObject({}), outputSchema: mvpObject({}),
 steps: [{ id: 'draft', name: 'Draft', type: 'tool', toolName: native.name, requiresConfirmation: true, onFailure: 'fail',
 inputMapping: Object.entries(parameters).map(([target, value]) => ({ target, source: { kind: 'literal', value } })) }], outputMapping: [] });
 workflow = await workflows.validate(workflow.workflowId, workflow.revision); workflow = await workflows.review(workflow.workflowId, workflow.revision, 'Test'); workflow = await workflows.publish(workflow.workflowId, workflow.revision);
 const sessionId = randomUUID(), now = new Date();
 await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: owner.id, ownerUsername: owner.username, title: 'Basis fixture', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: now, updatedAt: now });
 const manifests = createExecutionManifestService({ database, loadWorkflowTools: async () => tools as any, assetRepository: { read: async () => [{ kind: 'assessment-catalog', templateId: template.templateId,
 templateVersion: template.templateVersion, ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion, pipelineVersion: ruleSet.pipelineVersion, template, ruleSet, snapshotDigest }] } });
 const accepted = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution }).submitInvocation(owner, sessionId,
 { submissionKey: randomUUID(), content: 'Synthetic provenance fixture', execution: { kind: 'workflow', workflowId: workflow.workflowId, input: {}, assets: [{ kind: 'assessment-catalog', templateId: template.templateId }] } });
 const runId = accepted.data.runId, run = (await queue.findRunForOwner(runId, owner.id))!, manifest = readBusinessSkillsRun(run);
 const runtime = createWorkflowRuntime(manifest, runId), workflowState = runtime.next().state;
 const state = { businessSkills: { schemaVersion: 1, runId, manifestHash: manifest.manifestHash, state: { schemaVersion: 1, kind: 'workflow', workflow: workflowState } }, nextStepKey: 'execute' };
 await queue.commitCheckpoint({ runId, checkpointKey: randomUUID(), checkpointKind: 'structural', workflowId: run.workflowId!, workflowVersion: run.workflowVersion!, stepKey: 'execute', resumePolicy: 'restart_step', state, stateHash: hashHarnessCheckpointState(state),
 runtimeValidation: { validatedAt: now.toISOString(), validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION, checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } } });
 await database.update(schema.harnessRuns).set({ status: 'running' }).where(eq(schema.harnessRuns.harnessRunId, runId));
 const pending = await createSkillOperationService({ database, inventory }).prepareOperation(owner, { runId, stepId: 'draft', ordinal: 0, toolName: native.name, parameters });
 const decisions = createSkillOperationDecisionService({ database, inventory });
 const decisionRequest = { runId, operationId: pending.operationId };
 const confirmation = await decisions.readForConfirmation(owner, decisionRequest);
 const approval = await decisions.decideOperation(owner, { ...decisionRequest, confirmationHash: confirmation.confirmationHash, decision: 'approve' });
 assert.ok(approval.decisionId);
 const projectId = await record({}, 'global'), recordId = await record({ draftSource: 'business_skill', projectEvaluationId: projectId, creationBasis: { untrusted: true } });
 const executionId = randomUUID(), key = `business-op-execution:v1:${hash({ operationId: pending.operationId })}`;
 const input = { schemaVersion: 1, operationId: pending.operationId, rootRunId: pending.rootRunId, operationKey: pending.operationKey, payloadHash: pending.payloadHash,
 manifestHash: manifest.manifestHash, ownerId: owner.id, sessionId, toolName: native.name, sourceRunId: runId, decisionId: approval.decisionId!, confirmationHash: approval.confirmationHash };
 const result = { assessmentId: recordId, versionCode: 'TEST-A0', projectId, projectVersionCode: 'TEST-A0', totalDays: 5, templateId: template.templateId, ruleSetId: ruleSet.ruleSetId,
 templateVersion: template.templateVersion, ruleVersion: ruleSet.ruleVersion, snapshotDigest, operationId: pending.operationId, runId };
 await database.insert(schema.harnessToolEvents).values({ harnessToolEventId: executionId, harnessRunId: pending.rootRunId, effectKey: key, actionId: key,
 eventType: 'business_operation_executed', status: 'succeeded', toolName: native.name, input, output: { schemaVersion: 1, result }, createdAt: now, resolvedAt: new Date() });
 await database.update(schema.harnessRuns).set({ status: 'completed' }).where(eq(schema.harnessRuns.harnessRunId, runId));
 return { recordId, projectId, executionId, runId, input, result, manifest, pending };
}
const rejected = (promise: Promise<unknown>, status = 409) => assert.rejects(promise, (e: any) => e.status === status);

test('immutable original catalog gives five days after completion, minor checkin and removal/tampering of editable basis', async () => {
 const f = await fixture(), read = await service.read(owner, f.recordId); assert.equal(read.kind, 'frozen');
 if (read.kind !== 'frozen') assert.fail(); assert.equal(read.template.items[0].standardDays, 2); assert.equal(read.basis.operationId, f.pending.operationId);
 assert.equal(read.basis.runId, f.runId); assert.equal(read.basis.snapshotDigest, snapshotDigest);
 assert.equal((await service.calculate(owner, f.recordId, body)).totalDays, 5);
 await database.update(schema.versionRecords).set({ versionCode: 'TEST-A1', checkoutStatus: 'checked_in', payload: { projectEvaluationId: f.projectId } }).where(eq(schema.versionRecords.recordId, f.recordId));
 assert.equal((await service.read(owner, f.recordId)).kind, 'frozen'); assert.equal((await service.calculate(owner, f.recordId, body)).totalDays, 5);
 assert.equal(JSON.stringify(read).includes('executionManifest'), false); assert.equal(JSON.stringify(read).includes('Synthetic provenance'), false);
 const before = await database.select().from(schema.versionRecords).where(eq(schema.versionRecords.recordId, f.recordId));
 assert.equal((await service.calculate(owner, f.recordId, { ...body, items: [{ templateItemId: 'one', included: true, customStandardDays: 4 }, body.items[1]] })).totalDays, 7);
 assert.deepEqual(await database.select().from(schema.versionRecords).where(eq(schema.versionRecords.recordId, f.recordId)), before);
});
test('owner, actual assessment type, active current user and malformed ID boundaries', async () => {
 const f = await fixture(); await rejected(service.read(foreign, f.recordId), 404); await rejected(service.read(owner, randomUUID()), 404);
 await rejected(service.read(owner, f.projectId), 404); await rejected(service.read(owner, 'not-an-id'), 400);
 await database.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, owner.id));
 try { await rejected(service.read(owner, f.recordId), 403); } finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, owner.id)); }
});
test('legacy records are explicit, claimed basis and borrowed receipt cannot fall back to latest', async () => {
 const legacy = await record(); assert.deepEqual(await service.read(owner, legacy), { kind: 'legacy' }); await rejected(service.calculate(owner, legacy, body));
 for (const payload of [{ creationBasis: {} }, { draftSource: 'business_skill' }]) await rejected(service.read(owner, await record(payload)));
 const f = await fixture(); await rejected(service.read(owner, await record({ projectEvaluationId: f.projectId, creationBasis: { operationId: f.pending.operationId, runId: f.runId } })));
});
test('tampered native receipt, project binding, source run, root, manifest and operation hash fail closed', async () => {
 for (const patch of [{ output: (f: Awaited<ReturnType<typeof fixture>>) => ({ schemaVersion: 1, result: { ...f.result, snapshotDigest: 'b'.repeat(64) } }) },
 { input: (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, sourceRunId: randomUUID() }) },
 { input: (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, rootRunId: randomUUID() }) },
 { input: (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, manifestHash: 'b'.repeat(64) }) },
 { input: (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.input, payloadHash: 'b'.repeat(64) }) }]) {
  const f = await fixture(); const values = Object.fromEntries(Object.entries(patch).map(([k, make]) => [k, make(f)]));
  await database.update(schema.harnessToolEvents).set(values).where(eq(schema.harnessToolEvents.harnessToolEventId, f.executionId)); await rejected(service.read(owner, f.recordId));
 }
 const f = await fixture(); await database.update(schema.versionRecords).set({ payload: { projectEvaluationId: randomUUID() } }).where(eq(schema.versionRecords.recordId, f.recordId)); await rejected(service.read(owner, f.recordId));
});
test('strict bounded calculate body rejects client catalog, unexpected fields, wrong IDs, duplicate/unknown/missing items and invalid params', async () => {
 const f = await fixture();
 for (const invalid of [{ ...body, template: template }, { ...body, totalDays: 999 }, { ...body, templateId: 'latest' }, { ...body, ruleSetId: 'latest' },
 { ...body, items: [body.items[0], body.items[0], body.items[1]] }, { ...body, items: [body.items[0]] }, { ...body, items: [{ templateItemId: 'foreign', included: true }] },
 { ...body, items: [{ ...body.items[0], customStandardDays: -1 }, body.items[1]] }, { ...body, difficultyFactor: 9 }, { ...body, userCount: '50' },
 { ...body, items: [{ ...body.items[0], included: 'yes' }, body.items[1]] }, { ...body, exportProjectName: 'x'.repeat(1024 * 1024) }]) await rejected(service.calculate(owner, f.recordId, invalid), 400);
 assert.equal((await service.calculate(owner, f.recordId, { ...params, items: body.items, selectedCloudNames: [], exportProjectName: 'P', exportAssessmentVersionCode: 'A1' })).totalDays, 5);
});
test('duplicate native successes and mutated original operation or persisted manifest cannot claim authority', async () => {
 const duplicate = await fixture();
 const [receipt] = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessToolEventId, duplicate.executionId));
 await database.insert(schema.harnessToolEvents).values({ ...receipt, harnessToolEventId: randomUUID(), effectKey: `test-duplicate:${randomUUID()}` });
 await rejected(service.read(owner, duplicate.recordId));
 const prepared = await fixture();
 const [operation] = await database.select().from(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessToolEventId, prepared.pending.operationId));
 await database.update(schema.harnessToolEvents).set({ input: { ...(operation.input as any), parameters: { ...(operation.input as any).parameters, selectedItemIds: ['one'] } } }).where(eq(schema.harnessToolEvents.harnessToolEventId, prepared.pending.operationId));
 await rejected(service.read(owner, prepared.recordId));
 const corrupt = await fixture();
 const [run] = await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.harnessRunId, corrupt.runId));
 const config = run.executionConfig as any;
 await database.update(schema.harnessRuns).set({ executionConfig: { ...config, executionManifest: { ...config.executionManifest, manifestHash: 'c'.repeat(64) } } }).where(eq(schema.harnessRuns.harnessRunId, corrupt.runId));
 await rejected(service.read(owner, corrupt.recordId));
});

test('real aggregate HTTP reads and recalculates frozen catalog, rejects foreign JWT and client replacement', async () => {
 const f = await fixture();
 const api = express(); api.use(express.json({ limit: '2mb' })); api.use('/api/v1', (await import('../../routes/index')).default);
 const { signAuthToken } = await import('../../middleware/auth');
 const token = signAuthToken(owner), foreignToken = signAuthToken(foreign), path = `/api/v1/business-assessments/${f.recordId}`;
 const read = await request(api).get(`${path}/basis`).set('Authorization', `Bearer ${token}`);
 assert.equal(read.status, 200, JSON.stringify(read.body)); assert.equal(read.body.data.kind, 'frozen'); assert.equal(read.body.data.basis.snapshotDigest, snapshotDigest);
 const calculate = await request(api).post(`${path}/calculate`).set('Authorization', `Bearer ${token}`).send(body);
 assert.equal(calculate.status, 200, JSON.stringify(calculate.body)); assert.equal(calculate.body.data.totalDays, 5);
 assert.equal((await request(api).get(`${path}/basis`).set('Authorization', `Bearer ${foreignToken}`)).status, 404);
 const replaced = await request(api).post(`${path}/calculate`).set('Authorization', `Bearer ${token}`).send({ ...body, template, result: { totalDays: 99 } });
 assert.equal(replaced.status, 400);
});

for (const mutation of ['decisionId', 'confirmationHash', 'missingApproval']) test(`historical approval ${mutation} corruption rejects GET and POST`, async () => {
 const api = express(); api.use(express.json()); api.use('/api/v1', (await import('../../routes/index')).default);
 const { signAuthToken } = await import('../../middleware/auth'); const token = signAuthToken(owner);
  const f = await fixture();
  if (mutation === 'missingApproval') await database.delete(schema.harnessToolEvents).where(eq(schema.harnessToolEvents.harnessToolEventId, f.input.decisionId));
  else await database.update(schema.harnessToolEvents).set({ input: { ...f.input, [mutation]: mutation === 'decisionId' ? randomUUID() : 'b'.repeat(64) } }).where(eq(schema.harnessToolEvents.harnessToolEventId, f.executionId));
  const path = `/api/v1/business-assessments/${f.recordId}`;
  for (const response of [await request(api).get(`${path}/basis`).set('Authorization', `Bearer ${token}`),
   await request(api).post(`${path}/calculate`).set('Authorization', `Bearer ${token}`).send(body)]) {
   assert.equal(response.status, 409, `${mutation}: ${JSON.stringify(response.body)}`);
   assert.equal(response.body.errorCode, 'BUSINESS_ASSESSMENT_BASIS_INVALID'); assert.equal(response.body.data, null);
  }
});
