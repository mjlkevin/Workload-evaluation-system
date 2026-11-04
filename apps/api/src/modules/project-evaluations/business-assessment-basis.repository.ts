import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { aiSessions, harnessRuns, harnessToolEvents, users, versionRecords } from '../../db/schema';
import { calculateEstimate } from '../../engine';
import { anyRoleHasCapability } from '../../rbac/permissions';
import { legacyRoleToV2Roles } from '../../rbac/roles';
import type { AuthUser, Template, RuleSet } from '../../types';
import { MVP_ASSESSMENT_DRAFT_PARAMETERS, MVP_ASSESSMENT_DRAFT_OUTPUT, type MvpAssessmentDraftParameters } from '../../agent/tools/mvp-assessment-draft.tools';
import { readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { readPreparedOperationInTransaction } from '../skills/skills.operations';
import { readHistoricalOperationApprovalInTransaction } from '../skills/skills.operation-execution';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { SkillError } from '../skills/skills.types';
import { validateFrozenExecutionAssets } from '../skills/mvp/execution-assets';
import { assessmentMatchingDigest, buildAssessmentItems } from '../skills/mvp/assessment-matching';
import { mvpObject, parseMvpContract } from '../skills/mvp/requirements';

const toolName = 'create_assessment_draft';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function businessAssessmentError(code = 'BUSINESS_ASSESSMENT_BASIS_INVALID', status = 409): never {
 throw new SkillError(code, status === 404 ? '评估不存在或无权访问' : status === 400 ? '评估计算参数无效' : '评估原始计算依据不可用，请核对来源', status);
}
export type BusinessAssessmentBasis = { kind: 'legacy' } | { kind: 'frozen'; template: Template; ruleSet: RuleSet; basis: {
 operationId: string; executionId: string; runId: string; rootRunId: string; manifestHash: string;
 workflowId: string; workflowVersionId: string; workflowHash: string; templateId: string; templateVersion: string;
 ruleSetId: string; ruleVersion: string; pipelineVersion: string; snapshotDigest: string;
} };
export type BusinessAssessmentBasisRepository = { read(user: AuthUser, recordId: string): Promise<BusinessAssessmentBasis> };
/** Native success ledger rows are authority; editable assessment payloads can only signal a missing proof.
 * Historical readers validate immutable provenance without current-run admission or a latest catalog read. */
export function createBusinessAssessmentBasisRepository(database: Database = db): BusinessAssessmentBasisRepository {
 return { async read(user, rawRecordId) {
  if (!uuid(rawRecordId)) return businessAssessmentError('BUSINESS_ASSESSMENT_INVALID_REQUEST', 400);
  const recordId = rawRecordId.toLowerCase();
  return database.transaction(async tx => {
   // Hold the current account and record locks through all provenance reads. Historical roles grant nothing.
   const [current] = await tx.select().from(users).where(eq(users.userId, user.id)).for('share');
   if (!current || current.status !== 'active' || !['admin', 'user', 'sub_admin'].includes(current.role) || !anyRoleHasCapability(legacyRoleToV2Roles(current.role), 'estimates:read'))
    return businessAssessmentError('BUSINESS_ASSESSMENT_FORBIDDEN', 403);
   const [record] = await tx.select().from(versionRecords).where(and(eq(versionRecords.recordId, recordId), eq(versionRecords.ownerUserId, user.id), eq(versionRecords.type, 'assessment'))).for('share');
   if (!record) return businessAssessmentError('BUSINESS_ASSESSMENT_NOT_FOUND', 404);
   // Bind to the actual route record ID before reading any client-editable marker. LIMIT 2 rejects ambiguity.
   const receipts = await tx.select({ receipt: harnessToolEvents }).from(harnessToolEvents)
    .innerJoin(harnessRuns, eq(harnessRuns.harnessRunId, harnessToolEvents.harnessRunId))
    .where(and(eq(harnessRuns.ownerUserId, user.id), eq(harnessToolEvents.eventType, 'business_operation_executed'),
     eq(harnessToolEvents.toolName, toolName), eq(harnessToolEvents.status, 'succeeded'),
     sql`${harnessToolEvents.output}->'result'->>'assessmentId' = ${recordId}`)).limit(2).for('share');
   const payload = record.payload as Record<string, unknown> | null;
   if (!receipts.length) {
    if (payload && (Object.prototype.hasOwnProperty.call(payload, 'creationBasis') || payload.draftSource === 'business_skill')) return businessAssessmentError();
    return { kind: 'legacy' as const };
   }
   try {
    if (receipts.length !== 1) return businessAssessmentError();
    const row = receipts[0].receipt;
    const input = parseMvpContract<Record<string, unknown>>({}, row.input);
    const output = parseMvpContract<{ schemaVersion: number; result: Record<string, unknown> }>(mvpObject({ schemaVersion: { const: 1 }, result: MVP_ASSESSMENT_DRAFT_OUTPUT }), row.output);
    const result = output.result;
    if (!uuid(input.sourceRunId) || !uuid(input.operationId) || !uuid(input.decisionId) || !digest(input.confirmationHash)
     || input.ownerId !== user.id || !uuid(input.sessionId) || row.errorMessage !== null || row.riskLevel !== null
     || !Number.isFinite(row.createdAt?.getTime()) || !Number.isFinite(row.resolvedAt?.getTime())
     || row.resolvedAt!.getTime() < row.createdAt.getTime()) return businessAssessmentError();
    const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, input.sourceRunId), eq(harnessRuns.ownerUserId, user.id))).for('share');
    const [session] = await tx.select({ id: aiSessions.sessionId }).from(aiSessions).where(and(eq(aiSessions.sessionId, input.sessionId), eq(aiSessions.ownerUserId, user.id))).for('share');
    if (!run || !session || run.aiSessionId !== session.id) return businessAssessmentError();
    const manifest = readBusinessSkillsRun(run);
    if (manifest.kind !== 'workflow') return businessAssessmentError();
    const pending = await readPreparedOperationInTransaction(tx, run.harnessRunId, input.operationId, user.id, manifest);
    const key = `business-op-execution:v1:${hash({ operationId: pending.operationId })}`;
    if (row.harnessRunId !== pending.rootRunId || row.actionId !== key || row.effectKey !== key
     || !isDeepStrictEqual(input, { schemaVersion: 1, operationId: pending.operationId, rootRunId: pending.rootRunId,
      operationKey: pending.operationKey, payloadHash: pending.payloadHash, manifestHash: manifest.manifestHash,
      ownerId: user.id, sessionId: pending.sessionId, toolName, sourceRunId: run.harnessRunId,
      decisionId: input.decisionId, confirmationHash: input.confirmationHash })) return businessAssessmentError();
    await readHistoricalOperationApprovalInTransaction(tx, { pending, admission: { manifest, identity: {
     id: current.userId, role: current.role, businessRole: current.businessRole, status: current.status } } }, {
     schemaVersion: 1, ownerId: user.id, sessionId: pending.sessionId, operationId: pending.operationId,
     rootRunId: pending.rootRunId, operationKey: pending.operationKey, manifestHash: manifest.manifestHash, payloadHash: pending.payloadHash,
    }, input);
    const native = pending.snapshot.native;
    if (pending.request.toolName !== toolName || (native.source ?? 'code') !== 'code' || native.mutates !== true
     || native.exfiltrates || native.simulationOnly || !native.outputSchema) return businessAssessmentError();
    const parameters = parseMvpContract<MvpAssessmentDraftParameters>(MVP_ASSESSMENT_DRAFT_PARAMETERS, pending.request.parameters);
    parseMvpContract(native.parameters, parameters); parseMvpContract(native.outputSchema, result);
    validateFrozenExecutionAssets(manifest.assetBindings);
    const assets = manifest.assetBindings.filter(a => a.templateId === parameters.matching.templateId);
    if (assets.length !== 1) return businessAssessmentError();
    const asset = assets[0], { template, ruleSet, snapshotDigest } = asset;
    if (result.assessmentId !== recordId || !uuid(result.projectId) || payload?.projectEvaluationId !== result.projectId
     || record.templateId !== template.templateId || result.templateId !== template.templateId || result.ruleSetId !== ruleSet.ruleSetId
     || result.templateVersion !== template.templateVersion || result.ruleVersion !== ruleSet.ruleVersion || result.snapshotDigest !== snapshotDigest
     || result.operationId !== pending.operationId || result.runId !== run.harnessRunId) return businessAssessmentError();
    const [project] = await tx.select({ id: versionRecords.recordId }).from(versionRecords).where(and(eq(versionRecords.recordId, result.projectId), eq(versionRecords.ownerUserId, user.id), eq(versionRecords.type, 'global'))).for('share');
    if (!project) return businessAssessmentError();
    const originalRequest = buildAssessmentItems(parameters.requirements, { template, ruleSet, snapshotDigest }, parameters.matching, { matchingDigest: assessmentMatchingDigest(parameters.matching),
     actorId: user.id, decisionId: input.decisionId, selectedItemIds: parameters.selectedItemIds, params: parameters.params });
    if (calculateEstimate(originalRequest, template, ruleSet).totalDays !== result.totalDays) return businessAssessmentError();
    return { kind: 'frozen' as const, template, ruleSet, basis: { operationId: pending.operationId, executionId: row.harnessToolEventId,
     runId: run.harnessRunId, rootRunId: pending.rootRunId, manifestHash: manifest.manifestHash,
     workflowId: manifest.target.id, workflowVersionId: manifest.target.versionId, workflowHash: manifest.target.hash,
     templateId: template.templateId, templateVersion: template.templateVersion, ruleSetId: ruleSet.ruleSetId,
     ruleVersion: ruleSet.ruleVersion, pipelineVersion: ruleSet.pipelineVersion, snapshotDigest } };
   } catch { return businessAssessmentError(); }
  });
 } };
}
