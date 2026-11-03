import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import express from 'express';
import supertest from 'supertest';
import versionsRoutes from '../../routes/versions.routes';
import { signAuthToken } from '../../middleware/auth';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { buildMvpRequirementTools, requirementReportEnvelope } from '../../agent/tools/mvp-requirements.tools';
import { buildMvpAssessmentTools } from '../../agent/tools/mvp-assessment.tools';
import { buildMvpAssessmentDraftTools } from '../../agent/tools/mvp-assessment-draft.tools';
import { createMvpAssessmentDraftTransactionAdapter } from './assessment-draft-transaction';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { hashHarnessCheckpointState } from '../harness/harness-runtime.worker';
import { HARNESS_WORKER_VALIDATOR_VERSION } from '../harness/harness-runtime.types';
import { readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { createWorkflowRuntime, type WorkflowRuntimeState } from '../harness/workflows.runtime-adapter';
import { businessSkillsWaitDescriptor, createBusinessSkillsWaitService } from '../harness/business-skills.wait';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createExecutionManifestService } from '../skills/execution-manifest';
import { createSkillInvocationService } from '../skills/skills.invocation';
import { createInvocationPgRepository } from '../skills/skills.invocation-pg.repository';
import { createSkillRetryService } from '../skills/skills.retry';
import { createSkillOperationService } from '../skills/skills.operations';
import { createSkillOperationDecisionService } from '../skills/skills.operation-decisions';
import { createSkillOperationExecutionService, type SkillLocalTransactionAdapter } from '../skills/skills.operation-execution';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { assessmentCatalogDigest, assessmentMatchingDigest, type AssessmentMatching } from '../skills/mvp/assessment-matching';
import { confirmRequirements, mvpObject, normalizeRequirementCandidates } from '../skills/mvp/requirements';
import type { AuthUser } from '../../types';
import type { WorkflowDefinition } from '../workflows/workflows.types';

// Synthetic TEST-ONLY catalog: the real user baseline is separately exercised through the UI.
const template = { templateId: 'draft-test-catalog', templateVersion: 'test-1', templateName: 'TEST ONLY 2 + 3',
 groups: [{ groupId: 'sales', groupName: 'Sales' }], items: [
  { templateItemId: 'setup', groupId: 'sales', itemName: 'Setup', standardDays: 2 },
  { templateItemId: 'orders', groupId: 'sales', itemName: 'Orders', standardDays: 3 } ] };
const ruleSet = { ruleSetId: 'draft-test-rule', ruleVersion: 'test-1', pipelineVersion: 'test-1', pipeline: ['itemRule', 'grouping', 'baseRule'],
 baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 0 }], difficultyFactorList: [0, 0.5] }, orgIncrementRule: { enabled: false } };
const catalog = { template, ruleSet, snapshotDigest: assessmentCatalogDigest({ template, ruleSet }) };
const asset = { kind: 'assessment-catalog' as const, templateId: template.templateId, templateVersion: template.templateVersion,
 ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion, pipelineVersion: ruleSet.pipelineVersion, ...catalog };
const params = { userCount: 50, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 };
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 1500 });
const concurrentPool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 2, connectionTimeoutMillis: 1500 });
const database = drizzle(pool, { schema }), concurrentDb = drizzle(concurrentPool, { schema });
const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `draft-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const other = { ...user, id: randomUUID(), username: `draft-other-${randomUUID()}` };
const fixtureId = `draft-rule-${randomUUID()}`;
const fixtureWorkflowIds = new Set<string>();
let originalRules: Array<typeof schema.versionCodeRules.$inferSelect> = [];
const nativeTools = [...buildMvpRequirementTools(user.id), ...buildMvpAssessmentTools(user.id), ...buildMvpAssessmentDraftTools(user.id)];
const tools = nativeTools.map(({ execute: _execute, category: _category, discoverable: _discoverable, ...tool }) => ({ ...tool,
 source: 'code' as const, exfiltrates: false, simulationOnly: false, sandboxReadSafe: tool.sandboxReadSafe === true,
 requiresConfirmation: tool.mutates, allowedRoles: ['pre_sales'], policy: DEFAULT_TOOL_POLICY_ENTRY }));
const inventory = async () => ({ tools, registry: { get: (name: string) => tools.find(t => t.name === name) }, policy: { schemaVersion: 1, policies: {} } }) as any;
const path = (target: string, source: string) => ({ target, source: { kind: 'path' as const, path: source } });
const literal = (target: string, value: unknown) => ({ target, source: { kind: 'literal' as const, value } });
const sourceId = randomUUID();
const sourceText = 'Set up sales and process orders. Query export remains unmatched.';
const report = normalizeRequirementCandidates({ sources: [{ id: sourceId, kind: 'conversation', text: sourceText }] }, {
 requirements: ['Setup', 'Orders', 'Query export'].map(title => ({ title, description: title, role: 'Sales', action: title, object: 'Orders',
  constraints: [], openQuestions: [], assumptions: [], sources: [{ sourceId, quote: sourceText, start: 0, end: sourceText.length }] })), relations: [] });
const requirementSelection = { report, requirementIds: report.requirements.map(r => r.id) };
const matching: AssessmentMatching = { requirementReportDigest: requirementReportEnvelope(report).reportDigest,
 templateId: template.templateId, templateVersion: template.templateVersion, ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion,
 snapshotDigest: catalog.snapshotDigest, matches: [ { reqId: report.requirements[0].id, templateItemIds: ['setup'], scope: 'include', rationale: 'Setup' },
  { reqId: report.requirements[1].id, templateItemIds: ['orders'], scope: 'include', rationale: 'Orders' } ],
 unmatched: [{ reqId: report.requirements[2].id, reason: 'No catalog item' }], params,
 aiAdjustments: [{ reqId: report.requirements[0].id, proposedDays: 999, basis: 'Proposal is never applied to standard days' }] };
const scope = { matching, selectedItemIds: ['setup', 'orders'], params };
type Variant = 'normal' | 'forged-confirmation' | 'old-matching' | 'wrong-catalog' | 'changed-params' | 'forged-scope';
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function checkpoint(f: Pick<Fixture, 'runId' | 'manifest'>, workflow: WorkflowRuntimeState, key: string = randomUUID()) {
 const state = { businessSkills: { schemaVersion: 1, runId: f.runId, manifestHash: f.manifest.manifestHash,
  state: { schemaVersion: 1, kind: 'workflow', workflow } }, nextStepKey: 'execute' };
 const run = (await queue.findRunForOwner(f.runId, user.id))!;
 return queue.commitCheckpoint({ runId: f.runId, checkpointKey: key, checkpointKind: 'structural', workflowId: run.workflowId!, workflowVersion: run.workflowVersion!,
  stepKey: 'execute', resumePolicy: 'restart_step', state, stateHash: hashHarnessCheckpointState(state), runtimeValidation: {
   validatedAt: new Date().toISOString(), validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION,
   checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } } });
}
async function fixture(variant: Variant = 'normal') {
 const fixtureMatching = { ...structuredClone(matching), ...(variant === 'wrong-catalog' ? { templateId: 'foreign-catalog' } : {}) };
 const fixtureScope = { ...scope, matching: fixtureMatching };
 const definition: WorkflowDefinition = { name: `TEST ONLY draft ${variant}`, description: '', category: 'fixture', roles: ['pre_sales'],
 inputSchema: mvpObject({}), outputSchema: mvpObject({}), steps: [
  { id: 'normalize', name: 'Normalize', type: 'tool', toolName: 'requirement_normalize', requiresConfirmation: false,
   inputMapping: [literal('candidates', { requirements: report.requirements.map(({ id: _id, ...r }) => r), relations: [] })], onFailure: 'fail' },
  { id: 'requirementReview', name: 'Review exact report', type: 'confirmation', prompt: 'Approve requirements',
   inputSchema: tools.find(t => t.name === 'requirement_confirm')!.parameters, inputMapping: Object.entries(requirementSelection).map(([k,v]) => literal(k,v)), onFailure: 'fail' },
  { id: 'confirm', name: 'Confirm', type: 'tool', toolName: 'requirement_confirm', requiresConfirmation: false,
   inputMapping: Object.entries(requirementSelection).map(([k,v]) => literal(k,v)), onFailure: 'fail' },
  { id: 'match', name: 'Match validate', type: 'tool', toolName: 'assessment_match_validate', requiresConfirmation: false,
   inputMapping: [path('requirements', '$.steps.confirm.output'), literal('matching', fixtureMatching)], onFailure: 'fail' },
  { id: 'scope', name: 'Review scope', type: 'confirmation', prompt: 'Approve complete matching, selection and calculation parameters',
   inputSchema: mvpObject(Object.fromEntries(['matching', 'selectedItemIds', 'params'].map(k => [k, (tools.find(t => t.name === 'create_assessment_draft')!.parameters as any).properties[k]]))),
   inputMapping: Object.entries(fixtureScope).map(([k,v]) => literal(k,v)), onFailure: 'fail' },
  { id: 'draft', name: 'Draft', type: 'tool', toolName: 'create_assessment_draft', requiresConfirmation: true,
   inputMapping: [literal('projectName', 'Synthetic draft project'), literal('customerName', 'Synthetic customer'), path('requirements', '$.steps.confirm.output'),
    ...Object.entries({ ...fixtureScope, ...(variant === 'changed-params' ? { params: { ...params, difficultyFactor: 0.5 } } : {}) }).map(([k,v]) => literal(k,v))], onFailure: 'fail' },
 ], outputMapping: [] };
 const service = createWorkflowService(createWorkflowsPgRepository(database), createWorkflowContextLoader({ database, getTools: async () => tools as any }), user);
 let workflow = await service.create(definition); fixtureWorkflowIds.add(workflow.workflowId);
 workflow = await service.validate(workflow.workflowId, workflow.revision);
 workflow = await service.review(workflow.workflowId, workflow.revision, 'Synthetic transaction test'); workflow = await service.publish(workflow.workflowId, workflow.revision);
 const sessionId = randomUUID(), now = new Date();
 await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Draft transaction fixture', domain: 'business_evaluation',
  workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat',
  messages: [{ messageId: sourceId, role: 'user', content: sourceText, createdAt: now.toISOString() }], createdAt: now, updatedAt: now });
 const manifests = createExecutionManifestService({ database, loadWorkflowTools: async () => tools as any, assetRepository: { read: async () => structuredClone([asset]) } });
 const accepted = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution }).submitInvocation(user, sessionId,
  { submissionKey: randomUUID(), content: 'Synthetic fixture only', execution: { kind: 'workflow', workflowId: workflow.workflowId, input: {}, sources: [{ kind: 'conversation', id: sourceId }], assets: [{ kind: 'assessment-catalog', templateId: template.templateId }] } });
 const runId = accepted.data.runId, run = (await queue.findRunForOwner(runId, user.id))!, manifest = readBusinessSkillsRun(run);
 const runtime = createWorkflowRuntime(manifest, runId), f = { runId, sessionId, manifest };
 let state = runtime.next().state;
 const settle = (output: unknown) => { const decision = runtime.next(state); if (decision.kind !== 'ready') assert.fail();
  state = runtime.settle(state, { operationId: decision.command.operationId, output }).state; };
 const answer = async (forged = false) => {
  const decision = runtime.next(state); if (decision.kind !== 'ready' || decision.command.type !== 'confirmation') assert.fail();
  const actual = (await queue.findRunForOwner(runId, user.id))!, descriptor = businessSkillsWaitDescriptor(actual, decision.command);
  if (!forged) { await checkpoint(f, state, `wait:${descriptor.actionId}`);
   await database.update(schema.harnessRuns).set({ status: 'waiting' }).where(eq(schema.harnessRuns.harnessRunId, runId));
   await createBusinessSkillsWaitService(database).answer({ runId, sessionId, requestedBy: user.id, actionId: descriptor.actionId,
    kind: descriptor.kind, stepId: descriptor.stepId, contentHash: descriptor.contentHash, value: { approved: true } }); }
  settle({ approved: true }); return descriptor;
 };
 settle(requirementReportEnvelope(report)); const confirmation = await answer();
 const requirements = confirmRequirements(report, { reportDigest: matching.requirementReportDigest, requirementIds: requirementSelection.requirementIds,
  actorId: variant === 'forged-confirmation' ? other.id : user.id, decisionId: confirmation.actionId });
 settle(requirements);
 const producer = structuredClone(fixtureMatching);
 if (variant === 'old-matching') producer.matches[0].rationale = 'Latest matching differs';
 settle({ matching: producer, matchingDigest: assessmentMatchingDigest(producer) }); await answer(variant === 'forged-scope');
 await checkpoint(f, state); await database.update(schema.harnessRuns).set({ status: 'running' }).where(eq(schema.harnessRuns.harnessRunId, runId));
 const decision = runtime.next(state); if (decision.kind !== 'ready' || decision.command.type !== 'tool') assert.fail();
 const prepared = await createSkillOperationService({ database, inventory }).prepareOperation(user, { runId, stepId: 'draft', ordinal: 0,
  toolName: 'create_assessment_draft', parameters: decision.command.input });
 const request = { runId, operationId: prepared.operationId }, decisions = createSkillOperationDecisionService({ database, inventory });
 const view = await decisions.readForConfirmation(user, request);
 await decisions.decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
 return { ...f, runtime, state, prepared, parameters: decision.command.input, command: { ...request, confirmationHash: view.confirmationHash } };
}
const adapter = () => createMvpAssessmentDraftTransactionAdapter();
const execute = (extra: any = {}) => createSkillOperationExecutionService({ database, inventory,
 adapters: new Map([['create_assessment_draft', adapter()]]), ...extra });
const business = () => database.select().from(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
const receipts = (root: string) => database.select().from(schema.harnessToolEvents).where(and(eq(schema.harnessToolEvents.harnessRunId, root), eq(schema.harnessToolEvents.eventType, 'business_operation_executed')));
before(async () => {
 originalRules = await database.select().from(schema.versionCodeRules).orderBy(schema.versionCodeRules.ruleId);
 for (const owner of [user, other]) await database.insert(schema.users).values({ userId: owner.id, username: owner.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() });
 await database.insert(schema.versionCodeRules).values({ ruleId: fixtureId, moduleKey: 'implementation', moduleName: 'TEST ONLY implementation', moduleCode: 'IA', prefix: 'TESTIA',
  format: '{PREFIX}-{GL}-{NNN}', status: 'active', sortOrder: -2147483648, updatedAt: new Date() });
});
after(async () => {
 // Preserve immutable workflow history while removing only this process's fixtures from authorized catalogs.
 const workflowRepository = createWorkflowsPgRepository(database);
 const workflows = createWorkflowService(workflowRepository, createWorkflowContextLoader({ database, getTools: async () => tools as any }), user);
 for (const id of fixtureWorkflowIds) {
  const workflow = await workflowRepository.get(id); assert.ok(workflow);
  if (workflow.enabled || !workflow.archived) await workflows.status(id, workflow.revision, { enabled: false, archived: true });
  const retained = await workflowRepository.get(id); assert.ok(retained); assert.equal(retained.enabled, false); assert.equal(retained.archived, true);
 }
 console.info(`TEST ONLY retained archived D3 workflows=${fixtureWorkflowIds.size}`);
 await database.delete(schema.versionRecords).where(eq(schema.versionRecords.ownerUserId, user.id));
 await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id));
 await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
 await database.delete(schema.users).where(inArray(schema.users.userId, [user.id, other.id]));
 await database.delete(schema.versionCodeRules).where(eq(schema.versionCodeRules.ruleId, fixtureId));
 assert.deepEqual(await database.select().from(schema.versionCodeRules).orderBy(schema.versionCodeRules.ruleId), originalRules);
 assert.equal((await business()).length, 0); await closeDb(); await pool.end(); await concurrentPool.end();
});

test('native tool is strict, typed, code-owned, mutating and fails closed outside confirmed local consumer', async () => {
 const tool = nativeTools.find(t => t.name === 'create_assessment_draft')!;
 assert.equal(tool.source, 'code'); assert.equal(tool.mutates, true); assert.equal(tool.exfiltrates, false);
 assert.equal(tool.simulationOnly, false); assert.equal(tool.sandboxReadSafe, false); assert.equal(tool.capability, 'estimates:create'); assert.ok(tool.outputSchema);
 await assert.rejects(tool.execute({}, { id: user.id, capabilities: ['estimates:create'] }), (error: any) => error.code === 'confirmedlocaladapterrequired');
});
test('real consumer persists one linked project and normal assessment, computes 2 + 3 = 5, preserves proposals and trusted basis references', async () => {
 const f = await fixture(); const currentUsername = `${user.username}-current`;
 await database.update(schema.users).set({ username: currentUsername }).where(eq(schema.users.userId, user.id));
 try {
  const first = await execute().executeOperation(user, f.command), output = first.result as any;
  assert.equal(output.totalDays, 5); assert.equal(output.templateId, template.templateId); assert.equal(output.ruleSetId, ruleSet.ruleSetId);
  const rows = await business(), assessment = rows.find(r => r.recordId === output.assessmentId)!, project = rows.find(r => r.recordId === output.projectId)!;
  assert.ok(assessment); assert.ok(project); assert.equal(assessment.type, 'assessment'); assert.equal(project.type, 'global');
  assert.equal(assessment.templateId, template.templateId); assert.equal(assessment.createdByUsername, currentUsername);
  assert.equal(assessment.checkoutStatus, 'checked_in'); assert.equal(assessment.versionDocStatus, 'drafting'); assert.equal(assessment.baseCode, output.versionCode);
  assert.ok(output.versionCode.startsWith(`TESTIA-${output.projectVersionCode}-`)); assert.equal(assessment.majorLetter, 'A'); assert.equal(assessment.minorNumber, 0);
  const payload = assessment.payload as any;
  assert.equal(payload.projectEvaluationId, project.recordId); assert.equal(payload.result.totalDays, 5); assert.deepEqual(payload.params, params);
  assert.deepEqual(payload.items, [{ templateItemId: 'setup', included: true }, { templateItemId: 'orders', included: true }]);
  assert.deepEqual(payload.matching.aiAdjustments, matching.aiAdjustments); assert.deepEqual(payload.matching.unmatched, matching.unmatched);
  assert.equal(payload.creationBasis.operationId, f.prepared.operationId); assert.equal(payload.creationBasis.runId, f.runId);
  assert.equal(payload.creationBasis.rootRunId, f.prepared.rootRunId); assert.equal(payload.creationBasis.workflowVersionId, f.manifest.target.versionId);
  assert.equal(payload.creationBasis.snapshotDigest, catalog.snapshotDigest); assert.equal(payload.creationBasis.matchingDigest, assessmentMatchingDigest(matching));
  assert.ok(!JSON.stringify(payload).includes('executionAuthority')); assert.ok(!JSON.stringify(payload).includes('credentialScope'));
  const p = project.payload as any; assert.equal(p.currentAssessmentVersionId, assessment.recordId); assert.equal(p.assessmentVersionCode, assessment.versionCode);
  assert.equal(p.totalDays, 5); assert.equal(p.createdFromSessionId, f.sessionId); assert.ok(Array.isArray(p.productMasterSnapshot.assignments));
  assert.deepEqual(await execute().executeOperation(user, f.command), first); assert.equal((await receipts(f.prepared.rootRunId)).length, 1);

  // This receipt was produced by the real D3 consumer above, never inserted as a fixture.
  const app = express(); app.use(express.json()); app.use('/api/v1', (await import('../../routes/index')).default);
  const authorization = `Bearer ${signAuthToken({ ...user, username: currentUsername })}`, basisPath = `/api/v1/business-assessments/${assessment.recordId}`;
  const originalBasis = await supertest(app).get(`${basisPath}/basis`).set('Authorization', authorization);
  assert.equal(originalBasis.status, 200, JSON.stringify(originalBasis.body)); assert.equal(originalBasis.body.data.kind, 'frozen');
  assert.equal(originalBasis.body.data.basis.operationId, f.prepared.operationId);
  assert.equal(originalBasis.body.data.basis.snapshotDigest, catalog.snapshotDigest);
  const calculationRequest = { templateId: template.templateId, ruleSetId: ruleSet.ruleSetId, ...params, items: payload.items };
  const calculated = await supertest(app).post(`${basisPath}/calculate`).set('Authorization', authorization).send(calculationRequest);
  assert.equal(calculated.status, 200, JSON.stringify(calculated.body)); assert.equal(calculated.body.data.totalDays, 5);
  const versionPath = `/api/v1/versions/${assessment.recordId}`;
  const checkedOut = await supertest(app).post(`${versionPath}/checkout`).set('Authorization', authorization).send({});
  assert.equal(checkedOut.status, 200); assert.equal(checkedOut.body.code, 0, JSON.stringify(checkedOut.body));
  assert.equal(checkedOut.body.data.record.checkoutStatus, 'checked_out');
  const savedPayload = { ...payload, result: calculated.body.data, reviewNote: 'D3 to D4 real version lifecycle' };
  const saved = await supertest(app).patch(`${versionPath}/save-draft`).set('Authorization', authorization).send({ payload: savedPayload });
  assert.equal(saved.status, 200); assert.equal(saved.body.code, 0, JSON.stringify(saved.body));
  assert.equal(saved.body.data.record.payload.result.totalDays, 5);
  const checkedIn = await supertest(app).post(`${versionPath}/checkin`).set('Authorization', authorization).send({});
  assert.equal(checkedIn.status, 200); assert.equal(checkedIn.body.code, 0, JSON.stringify(checkedIn.body));
  assert.equal(checkedIn.body.data.record.id, assessment.recordId); assert.equal(checkedIn.body.data.record.checkoutStatus, 'checked_in');
  assert.equal(checkedIn.body.data.record.minorNumber, 1); assert.notEqual(checkedIn.body.data.record.versionCode, output.versionCode);
  const refreshed = await supertest(app).get(versionPath).set('Authorization', authorization);
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.code, 0, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.data.record.id, assessment.recordId); assert.equal(refreshed.body.data.record.payload.result.totalDays, 5);
  assert.equal(refreshed.body.data.record.payload.reviewNote, savedPayload.reviewNote);
  const refreshedBasis = await supertest(app).get(`${basisPath}/basis`).set('Authorization', authorization);
  assert.equal(refreshedBasis.status, 200, JSON.stringify(refreshedBasis.body)); assert.deepEqual(refreshedBasis.body.data, originalBasis.body.data);
  const recalculated = await supertest(app).post(`${basisPath}/calculate`).set('Authorization', authorization).send(calculationRequest);
  assert.equal(recalculated.status, 200, JSON.stringify(recalculated.body)); assert.equal(recalculated.body.data.totalDays, 5);
 } finally { await database.update(schema.users).set({ username: user.username }).where(eq(schema.users.userId, user.id)); }
});
test('two concurrent consumers and reconstruction create exactly one project, one assessment and one receipt', async () => {
 const f = await fixture(), count = (await business()).length;
 const values = await Promise.all([execute().executeOperation(user, f.command), execute({ database: concurrentDb }).executeOperation(user, f.command)]);
 assert.deepEqual(values[0], values[1]); assert.equal((await business()).length, count + 2); assert.equal((await receipts(f.prepared.rootRunId)).length, 1);
});
for (const mode of ['invalid-output', 'throw-after-insert', 'receipt-failure']) test(`${mode} rolls back both real business records and the success receipt`, async () => {
 const f = await fixture(), count = (await business()).length, real = adapter(); let inserted = false;
 const failure: SkillLocalTransactionAdapter = { kind: 'local-transaction', async execute(tx, input) {
  const result = await real.execute(tx, input) as any;
  assert.equal((await tx.select().from(schema.versionRecords).where(inArray(schema.versionRecords.recordId, [result.assessmentId, result.projectId]))).length, 2); inserted = true;
  if (mode === 'throw-after-insert') throw new Error('TEST_ONLY_BUSINESS_FAILURE');
  return mode === 'invalid-output' ? { ...result, totalDays: 'five' } : result;
 } };
 const wrapped = Object.create(database);
 wrapped.transaction = (callback: any, settings: any) => database.transaction(tx => callback(new Proxy(tx, { get(target, key) {
  if (key === 'update' && mode === 'receipt-failure') return (table: any) => {
   const builder = target.update(table); return new Proxy(builder, { get(b, prop) {
    if (prop === 'set') return (values: any) => { if (table === schema.harnessToolEvents && values.status === 'succeeded') throw new Error('TEST_ONLY_RECEIPT_FAILURE'); return b.set(values); };
    const value = (b as any)[prop]; return typeof value === 'function' ? value.bind(b) : value;
   } });
  };
  const value = (target as any)[key]; return typeof value === 'function' ? value.bind(target) : value;
 } })), settings);
 await assert.rejects(execute({ database: wrapped, adapters: new Map([['create_assessment_draft', failure]]) }).executeOperation(user, f.command));
 assert.ok(inserted); assert.equal((await business()).length, count); assert.equal((await receipts(f.prepared.rootRunId)).length, 0);
});
for (const variant of ['forged-confirmation', 'old-matching', 'wrong-catalog', 'changed-params', 'forged-scope'] as Variant[]) test(`${variant} cannot authorize calculation or writes`, async () => {
 const f = await fixture(variant), count = (await business()).length;
 await assert.rejects(execute().executeOperation(user, f.command)); assert.equal((await business()).length, count); assert.equal((await receipts(f.prepared.rootRunId)).length, 0);
});
test('foreign owner cannot consume a genuine approved operation', async () => {
 const f = await fixture(), count = (await business()).length;
 await assert.rejects(execute().executeOperation(other, f.command)); assert.equal((await business()).length, count); assert.equal((await receipts(f.prepared.rootRunId)).length, 0);
});
test('transaction adapter rejects injected authority, catalog, effort overrides, unknown fields and getters before writes', async () => {
 const f = await fixture(), count = (await business()).length;
 const bad = ['manifest', 'actorId', 'runId', 'grants', 'customStandardDays'].map(k => ({ ...(f.parameters as any), [k]: 'forged' }));
 let reads = 0; bad.push(Object.defineProperty({ ...(f.parameters as any) }, 'authority', { enumerable: true, get() { reads++; return 'forged'; } }));
 for (const parameters of bad) await assert.rejects(database.transaction(tx => adapter().execute(tx, { operationId: f.prepared.operationId, ownerId: user.id, sessionId: f.sessionId, parameters })));
 assert.equal(reads, 0); assert.equal((await business()).length, count);
});
test('a prepared and approved operation alone cannot invoke the adapter without the real consumer executing receipt', async () => {
 const f = await fixture(), count = (await business()).length;
 await assert.rejects(database.transaction(tx => adapter().execute(tx, { operationId: f.prepared.operationId, ownerId: user.id, sessionId: f.sessionId, parameters: f.parameters })));
 assert.equal((await business()).length, count); assert.equal((await receipts(f.prepared.rootRunId)).length, 0);
});
test('inactive normal implementation encoding rule rejects atomically instead of inventing a version code', async () => {
 const f = await fixture(), count = (await business()).length;
 await database.update(schema.versionCodeRules).set({ status: 'draft' }).where(eq(schema.versionCodeRules.ruleId, fixtureId));
 try {
  await assert.rejects(execute().executeOperation(user, f.command)); assert.equal((await business()).length, count); assert.equal((await receipts(f.prepared.rootRunId)).length, 0);
 } finally { await database.update(schema.versionCodeRules).set({ status: 'active' }).where(eq(schema.versionCodeRules.ruleId, fixtureId)); }
});

test('failed physical run retries through its actual current consumer receipt without borrowing the old run identity', async () => {
 const f = await fixture(), decision = f.runtime.next(f.state); if (decision.kind !== 'ready') assert.fail();
 await checkpoint(f, f.runtime.fail(f.state, { operationId: decision.command.operationId, code: 'execution_failed' }).state);
 await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 const retry = await createSkillRetryService({ database, inventory, prepareModel: async () => assert.fail('No model dispatch') }).retryInvocation(user, f.runId,
  { submissionKey: randomUUID(), reason: 'Retry creation after test-only failure' });
 const runId = retry.data.runId;
 await database.update(schema.harnessRuns).set({ status: 'running' }).where(eq(schema.harnessRuns.harnessRunId, runId));
 const pending = await createSkillOperationService({ database, inventory }).prepareOperation(user, { runId, stepId: 'draft', ordinal: 0,
  toolName: 'create_assessment_draft', parameters: f.parameters });
 assert.equal(pending.operationId, f.prepared.operationId);
 const request = { runId, operationId: pending.operationId }, decisions = createSkillOperationDecisionService({ database, inventory });
 const view = await decisions.readForConfirmation(user, request);
 await decisions.decideOperation(user, { ...request, confirmationHash: view.confirmationHash, decision: 'approve' });
 const first = await execute().executeOperation(user, { ...request, confirmationHash: view.confirmationHash });
 const row = (await business()).find(r => r.recordId === (first.result as any).assessmentId)!;
 assert.equal((row.payload as any).creationBasis.runId, runId); assert.equal((row.payload as any).creationBasis.rootRunId, f.runId);
 assert.equal((first.result as any).totalDays, 5); assert.equal((await receipts(f.runId)).length, 1);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test('cross-entry: D3 and real ordinary createVersion serialize code allocation and insert under the same owner/template lock', async () => {
 const f = await fixture(), entered = deferred(), release = deferred(); let backendPid = 0, intercepted = false;
 const [rule] = await database.select().from(schema.versionCodeRules).where(eq(schema.versionCodeRules.ruleId, fixtureId));
 await database.update(schema.versionCodeRules).set({ format: '{PREFIX}-{YYYYMMDD}-{NNN}' }).where(eq(schema.versionCodeRules.ruleId, fixtureId));
 const wrapped = Object.create(database);
 wrapped.transaction = (callback: any, settings: any) => database.transaction(tx => callback(new Proxy(tx, { get(target, key) {
  if (key === 'select') return (fields: any) => {
   const builder = target.select(fields);
   if (fields?.code !== schema.versionRecords.versionCode || intercepted) return builder;
   const wrap = (value: any): any => new Proxy(value, { get(query, name) {
    if (name === 'then') return (yes: any, no: any) => Promise.resolve(query).then(async rows => {
     if (!intercepted) { intercepted = true; backendPid = Number((await target.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid); entered.resolve(); await release.promise; }
     return rows;
    }).then(yes, no);
    const property = query[name]; return typeof property === 'function' ? (...args: any[]) => wrap(property.apply(query, args)) : property;
   } });
   return wrap(builder);
  };
  const value = (target as any)[key]; return typeof value === 'function' ? value.bind(target) : value;
 } })), settings);
 const draft = execute({ database: wrapped }).executeOperation(user, f.command);
 let ordinary: Promise<any> | undefined, ordinaryDone = false, observedWait = false;
 try {
  await Promise.race([entered.promise, draft.then(() => assert.fail('D3 must pause after its real codes SELECT'))]);
  const app = express(); app.use(express.json()); app.use('/versions', versionsRoutes);
  ordinary = supertest(app).post('/versions').set('Authorization', `Bearer ${signAuthToken(user)}`)
   .send({ type: 'assessment', templateId: template.templateId, status: 'published', payload: { note: 'ordinary creation' } })
   .then(response => { ordinaryDone = true; return response; });
  for (let n = 0; n < 500 && !ordinaryDone; n++) {
   const waiters = await concurrentPool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))", [backendPid]);
   if (waiters.rowCount) { observedWait = true; break; } await new Promise(r => setTimeout(r, 10));
  }
 } finally { release.resolve(); }
 try {
  const [d3, response] = await Promise.all([draft, ordinary!]); assert.equal(response.status, 200); assert.equal(response.body.code, 0);
  const normal = response.body.data.record, result = d3.result as any;
  const rows = (await business()).filter(r => [normal.id, result.assessmentId].includes(r.recordId));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(r => r.versionCode)).size, 2, `cross-entry duplicate persisted codes: ${rows.map(r => r.versionCode).join(', ')}`);
  assert.ok(observedWait, 'the ordinary entry must actually wait behind the D3 transaction');
  assert.equal(normal.type, 'assessment'); assert.equal(normal.templateId, template.templateId); assert.equal(normal.status, 'published');
  assert.equal(normal.checkoutStatus, 'checked_in'); assert.equal(normal.versionDocStatus, 'drafting'); assert.equal(normal.baseCode, normal.versionCode);
  assert.equal(normal.createdByUserId, user.id); assert.equal(normal.createdByUsername, user.username); assert.ok(normal.reviewedAt); assert.equal(normal.reviewedByUserId, user.id);
  assert.deepEqual(normal.payload, { note: 'ordinary creation' });
 } finally { await database.update(schema.versionCodeRules).set(rule).where(eq(schema.versionCodeRules.ruleId, fixtureId)); }
});
test('ordinary assessment creation preserves explicit codes, defaults, duplicate errors and inactive-rule behavior', async () => {
 const app = express(); app.use(express.json()); app.use('/versions', versionsRoutes);
 const post = (body: Record<string, unknown>) => supertest(app).post('/versions').set('Authorization', `Bearer ${signAuthToken(user)}`).send(body);
 const [rule] = await database.select().from(schema.versionCodeRules).where(eq(schema.versionCodeRules.ruleId, fixtureId));
 const explicitCode = `EXPLICIT-${randomUUID()}`;
 const first = await post({ type: 'assessment', versionCode: explicitCode }); assert.equal(first.body.code, 0);
 const record = first.body.data.record;
 assert.equal(record.versionCode, explicitCode); assert.equal(record.baseCode, explicitCode); assert.equal(record.templateId, 'default');
 assert.equal(record.status, 'draft'); assert.deepEqual(record.payload, {}); assert.equal(record.checkoutStatus, 'checked_in');
 assert.equal(record.versionDocStatus, 'drafting'); assert.equal(record.majorLetter, 'A'); assert.equal(record.minorNumber, 0);
 assert.deepEqual(record.lastCheckinPayload, {}); assert.equal(record.isHistoricalArchive, false);
 const duplicate = await post({ type: 'assessment', versionCode: explicitCode });
 assert.equal(duplicate.body.code, 40901); assert.equal(duplicate.body.message, '版本号已存在，不可覆盖（不可变版本）');
 try {
  await database.update(schema.versionCodeRules).set({ status: 'draft' }).where(eq(schema.versionCodeRules.ruleId, fixtureId));
  const refused = await post({ type: 'assessment' }); assert.equal(refused.body.code, 40902);
  assert.equal(refused.body.message, '当前模块编码规则未生效，请先在系统管理中生效');
  assert.equal((await post({ type: 'assessment', versionCode: `INACTIVE-EXPLICIT-${randomUUID()}` })).body.code, 0);
  await database.update(schema.versionCodeRules).set({ status: 'active' }).where(eq(schema.versionCodeRules.ruleId, fixtureId));
  const templateId = `normal-${randomUUID()}`, payload = { globalVersionCode: 'GL-NORMAL-VB01' };
  const a = await post({ type: 'assessment', templateId, payload }), b = await post({ type: 'assessment', templateId, payload });
  assert.equal(a.body.code, 0); assert.equal(b.body.code, 0);
  assert.equal(a.body.data.record.versionCode, 'TESTIA-GL-NORMAL-001'); assert.equal(b.body.data.record.versionCode, 'TESTIA-GL-NORMAL-002');
  assert.deepEqual(b.body.data.record.payload, payload);
 } finally { await database.update(schema.versionCodeRules).set(rule).where(eq(schema.versionCodeRules.ruleId, fixtureId)); }
});
