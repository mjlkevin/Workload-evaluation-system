import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { harnessRuns, harnessToolEvents, users, versionRecords } from '../../db/schema';
import { readDbNow } from '../../db/now';
import type { VersionRecord } from '../../types';
import { calculateEstimate, type EstimateResult } from '../../engine';
import { MVP_ASSESSMENT_DRAFT_PARAMETERS, MVP_ASSESSMENT_DRAFT_OUTPUT, type MvpAssessmentDraftParameters } from '../../agent/tools/mvp-assessment-draft.tools';
import { requirementReportEnvelope } from '../../agent/tools/mvp-requirements.tools';
import type { QueueDbExecutor } from '../harness/harness-runtime.repository';
import { readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { SkillError } from '../skills/skills.types';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import type { SkillLocalTransactionAdapter } from '../skills/skills.operation-execution';
import { readPreparedOperationInTransaction } from '../skills/skills.operations';
import { readCurrentMvpExecutionInTransaction } from '../skills/mvp/execution-proof.repository';
import { validateFrozenExecutionAssets } from '../skills/mvp/execution-assets';
import { assessmentMatchingDigest, buildAssessmentItems } from '../skills/mvp/assessment-matching';
import { confirmRequirements, parseMvpContract } from '../skills/mvp/requirements';
import { allocateAssessmentCodeInTransaction } from '../versions/assessment-code-transaction';
import { toRowValues } from '../versions/versions-pg.repository';
import { createProjectEvaluationInTransaction } from './project-evaluation-transaction';

const toolName = 'create_assessment_draft';
const invalid = (code = 'MVP_DRAFT_PROOF_INVALID'): never => { throw new SkillError(code, '草稿依据已变化，请重新核对需求、匹配和范围', 409); };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
type AdapterInput = Parameters<SkillLocalTransactionAdapter['execute']>[1];
/** Resolve the current physical Run from this consumer's executing receipt, never from a model parameter.
 * A retry can reuse the prepared operation while its original source Run is already failed. */
async function currentProof(tx: QueueDbExecutor, input: AdapterInput, parameters: MvpAssessmentDraftParameters) {
 const [preparedRow] = await tx.select().from(harnessToolEvents).where(eq(harnessToolEvents.harnessToolEventId, input.operationId)).for('share');
 if (!preparedRow || preparedRow.eventType !== 'business_operation_prepared' || preparedRow.status !== 'pending' || preparedRow.toolName !== toolName) return invalid();
 const effectKey = `business-op-execution:v1:${hash({ operationId: input.operationId })}`;
 const [receipt] = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, preparedRow.harnessRunId), eq(harnessToolEvents.effectKey, effectKey))).for('share');
 const executing = receipt?.input as Record<string, unknown> | null;
 if (!receipt || receipt.eventType !== 'business_operation_executed' || receipt.status !== 'executing' || receipt.toolName !== toolName
  || receipt.actionId !== effectKey || receipt.output !== null || !executing || !uuid(executing.sourceRunId)
  || executing.ownerId !== input.ownerId || executing.sessionId !== input.sessionId || executing.operationId !== input.operationId) return invalid();
 const runId = executing.sourceRunId;
 const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, runId), eq(harnessRuns.ownerUserId, input.ownerId))).for('share');
 if (!run || run.aiSessionId !== input.sessionId) return invalid();
 const manifest = readBusinessSkillsRun(run);
 const pending = await readPreparedOperationInTransaction(tx, runId, input.operationId, input.ownerId, manifest);
 if (pending.sessionId !== input.sessionId || pending.rootRunId !== preparedRow.harnessRunId || pending.request.toolName !== toolName
  || !isDeepStrictEqual(pending.request.parameters, parameters) || executing.payloadHash !== pending.payloadHash
  || executing.rootRunId !== pending.rootRunId || executing.manifestHash !== manifest.manifestHash || executing.toolName !== toolName) return invalid();
 const proof = await readCurrentMvpExecutionInTransaction(tx, input.ownerId, { requestId: input.operationId, traceId: pending.rootRunId,
  channel: 'api', workflowKey: 'business_skills', harnessRunId: runId, aiSessionId: input.sessionId,
  actor: { userId: input.ownerId, roles: [], capabilities: [] } }, toolName, parameters);
 return { proof, executionId: receipt.harnessToolEventId };
}
/** Every read and write uses the consumer's passed transaction; its success receipt commits with both records. */
export function createMvpAssessmentDraftTransactionAdapter(): SkillLocalTransactionAdapter {
 return { kind: 'local-transaction', async execute(tx, input) {
  const parameters = parseMvpContract<MvpAssessmentDraftParameters>(MVP_ASSESSMENT_DRAFT_PARAMETERS, input.parameters);
  if (!parameters.projectName.trim()) return invalid('MVP_DRAFT_PARAMETERS_INVALID');
  const { proof, executionId } = await currentProof(tx, input, parameters);
  const { report, confirmation } = parameters.requirements;
  proof.assertPreviousOutput(['requirement_normalize', 'requirement_clarify'], requirementReportEnvelope(report));
  proof.assertPreviousOutput(['requirement_confirm'], parameters.requirements);
  const requirementDecision = proof.readConfirmation({ report, requirementIds: confirmation.requirementIds,
   ...(confirmation.resolvedConflicts !== undefined ? { resolvedConflicts: confirmation.resolvedConflicts } : {}) });
  const requirements = confirmRequirements(report, { ...confirmation, actorId: requirementDecision.actorId, decisionId: requirementDecision.decisionId });
  proof.assertPreviousOutput(['requirement_confirm'], requirements);
  const matchingDigest = assessmentMatchingDigest(parameters.matching);
  proof.assertPreviousOutput(['assessment_match_validate'], { matching: parameters.matching, matchingDigest });
  const scopeDecision = proof.readConfirmation({ matching: parameters.matching, selectedItemIds: parameters.selectedItemIds, params: parameters.params });
  const assets = proof.manifest.assetBindings; validateFrozenExecutionAssets(assets);
  const candidates = assets.filter(a => a.kind === 'assessment-catalog' && a.templateId === parameters.matching.templateId);
  if (candidates.length !== 1) return invalid('MVP_CATALOG_CHANGED');
  const { template, ruleSet, snapshotDigest } = candidates[0];
  const request = buildAssessmentItems(requirements, { template, ruleSet, snapshotDigest }, parameters.matching,
   { matchingDigest, actorId: scopeDecision.actorId, decisionId: scopeDecision.decisionId,
    selectedItemIds: parameters.selectedItemIds, params: parameters.params });
  const result = parseMvpContract<EstimateResult>({}, calculateEstimate(request, template, ruleSet));
  const [owner] = await tx.select({ username: users.username, status: users.status }).from(users).where(eq(users.userId, input.ownerId)).for('share');
  if (!owner || owner.status !== 'active') return invalid();
  const project = await createProjectEvaluationInTransaction(tx, input.ownerId, { projectName: parameters.projectName.trim(),
   customerName: parameters.customerName?.trim() || '', createdFromSessionId: input.sessionId, currentStage: 'assessment_draft', totalDays: result.totalDays });
  const now = await readDbNow(tx), nowIso = now.toISOString();
  const allocated = await allocateAssessmentCodeInTransaction(tx, { ownerUserId: input.ownerId, templateId: template.templateId,
   versionCode: '', payload: { globalVersionCode: project.versionCode } }, now);
  if ('errorCode' in allocated) return invalid(allocated.errorCode === 40901 ? 'MVP_ASSESSMENT_CODE_CONFLICT' : 'MVP_ASSESSMENT_CODE_RULE_UNAVAILABLE');
  const versionCode = allocated.versionCode, assessmentId = randomUUID();
  const creationBasis = { schemaVersion: 1, operationId: input.operationId, executionId, runId: proof.run.harnessRunId,
   rootRunId: proof.rootRunId, manifestHash: proof.manifest.manifestHash, workflowId: proof.manifest.target.id,
   workflowVersionId: proof.manifest.target.versionId, workflowHash: proof.manifest.target.hash,
   skills: proof.manifest.skills.map(s => ({ stepId: s.stepId, skillId: s.skillId, versionId: s.versionId, hash: s.hash })),
   templateId: template.templateId, templateVersion: template.templateVersion, ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion,
   pipelineVersion: ruleSet.pipelineVersion, snapshotDigest, matchingDigest,
   requirementDecision: { decisionId: requirementDecision.decisionId, physicalRunId: requirementDecision.physicalRunId, stepId: requirementDecision.stepId },
   scopeDecision: { decisionId: scopeDecision.decisionId, physicalRunId: scopeDecision.physicalRunId, stepId: scopeDecision.stepId } };
  const record: VersionRecord = { id: assessmentId, type: 'assessment', versionCode, templateId: template.templateId, ownerUserId: input.ownerId, status: 'draft',
   payload: { draftSource: 'business_skill', projectEvaluationId: project.projectId, globalVersionCode: project.versionCode,
    projectName: project.projectName, customerName: project.customerName, templateId: template.templateId, ruleSetId: ruleSet.ruleSetId,
    items: request.items, params: parameters.params, result, requirements, matching: parameters.matching, sources: proof.sources, creationBasis },
   createdAt: nowIso, updatedAt: nowIso, createdByUserId: input.ownerId, updatedByUserId: input.ownerId,
   createdByUsername: owner.username, updatedByUsername: owner.username, checkoutStatus: 'checked_in', versionDocStatus: 'drafting',
   majorLetter: 'A', minorNumber: 0, baseCode: versionCode, isHistoricalArchive: false, lastCheckinPayload: {} };
  await tx.insert(versionRecords).values(toRowValues(record));
  const [projectRow] = await tx.select().from(versionRecords).where(and(eq(versionRecords.recordId, project.projectId), eq(versionRecords.ownerUserId, input.ownerId)));
  if (!projectRow) return invalid();
  await tx.update(versionRecords).set({ payload: { ...projectRow.payload as Record<string, unknown>,
   currentAssessmentVersionId: assessmentId, assessmentVersionCode: versionCode, creationBasis }, updatedAt: now })
   .where(and(eq(versionRecords.recordId, project.projectId), eq(versionRecords.ownerUserId, input.ownerId)));
  return parseMvpContract(MVP_ASSESSMENT_DRAFT_OUTPUT, { assessmentId, versionCode, projectId: project.projectId,
   projectVersionCode: project.versionCode, totalDays: result.totalDays, templateId: template.templateId, ruleSetId: ruleSet.ruleSetId,
   templateVersion: template.templateVersion, ruleVersion: ruleSet.ruleVersion, snapshotDigest, operationId: input.operationId, runId: proof.run.harnessRunId });
 } };
}
