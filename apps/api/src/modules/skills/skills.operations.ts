import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { harnessRuns, harnessToolEvents } from '../../db/schema';
import type { AuthUser } from '../../types';
import { resolveToolPolicyEntry } from '../../agent/tool-policy';
import { readBusinessSkillsRun, type QueueDbExecutor } from '../harness/harness.module';
import { assertRunAdmissionInTransaction, createExecutionEmergencyRepository, readExecutionAuthorityBindings } from './execution-emergency';
import { validateFrozenExecutionTools } from './execution-authority';
import { prepareSkillAuthority } from './skills.authority';
import { resolveCurrentSkillTools } from './skills.context';
import { copyTrialJson, readSkillPath } from './skills.sandbox';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
import type { ExecutionManifest } from './execution-manifest.types';
import type { FrozenExecutionSkill } from './skills.execution-model';
type Request = { runId: string; stepId: string; ordinal: number; toolName: string; parameters: unknown };
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const fail = (code: string, status = 409): never => { throw new SkillError(code, '待确认操作暂不可用，请检查任务、内容和权限', status); };
const conflict = (): never => fail('OPERATION_INTENT_CONFLICT');
function ledgerJson<T>(value: T): T {
  try { return copyTrialJson(value, 'definition') as T; } catch { return fail('OPERATION_INTENT_INVALID'); }
}
function command(body: unknown): Request {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'ordinal,parameters,runId,stepId,toolName') fail('OPERATION_INVALID_REQUEST', 400);
    const value = copyTrialJson(body, 'definition') as Request;
    if (!uuid(value.runId) || !Number.isInteger(value.ordinal) || value.ordinal < 0 || value.ordinal > 59
      || [value.stepId, value.toolName].some(v => typeof v !== 'string' || !v.trim() || v.length > 160)) fail('OPERATION_INVALID_REQUEST', 400);
    return { ...value, runId: value.runId.toLowerCase() };
  } catch { return fail('OPERATION_INVALID_REQUEST', 400); }
}
/** All nodes are locked SHARE: never upgrade a root Run lock just to allocate an operation. */
async function lineage(tx: QueueDbExecutor, runId: string, ownerId: string, manifest: ExecutionManifest, fingerprint?: string, sessionId?: string) {
  const seen = new Set<string>(); let next: string | null = runId;
  let first: typeof harnessRuns.$inferSelect | undefined, root = runId;
  while (next) {
    if (seen.size >= 64 || seen.has(next)) return fail('OPERATION_LINEAGE_INVALID');
    seen.add(next);
    const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, next), eq(harnessRuns.ownerUserId, ownerId))).for('share');
    if (!run || run.ownerUserId !== ownerId || !run.submissionKey || first && run.status !== 'failed') return fail('OPERATION_LINEAGE_INVALID');
    let saved: ExecutionManifest;
    try {
      saved = readBusinessSkillsRun(run);
      readExecutionAuthorityBindings(saved, (run.executionConfig as Record<string, unknown>).executionAuthority);
    } catch { return fail('OPERATION_LINEAGE_INVALID'); }
    const metadata = run.metadata as Record<string, unknown>, mark = metadata.invocationFingerprint;
    if (run.retryOfRunId) {
      const reason = metadata.retryReason;
      if (metadata.retryActorId !== ownerId || typeof reason !== 'string' || !reason || reason.trim() !== reason || reason.length > 1000
        || metadata.retryRequestHash !== hash({ sourceRunId: run.retryOfRunId, sessionId: run.aiSessionId, fingerprint: mark, reason })) return fail('OPERATION_LINEAGE_INVALID');
    } else if (['retryRequestHash', 'retryActorId', 'retryReason'].some(key => Object.prototype.hasOwnProperty.call(metadata, key))) return fail('OPERATION_LINEAGE_INVALID');
    if (saved.manifestHash !== manifest.manifestHash || hash(saved) !== hash(manifest)
      || fingerprint !== undefined && mark !== fingerprint || sessionId !== undefined && run.aiSessionId !== sessionId) return fail('OPERATION_LINEAGE_INVALID');
    if (!first) { first = run; fingerprint = String(mark); sessionId = run.aiSessionId!; }
    root = run.harnessRunId; next = run.retryOfRunId;
  }
  return { root, first: first!, fingerprint: fingerprint!, sessionId: sessionId! };
}
function intent(manifest: ExecutionManifest, request: Request) {
  if (manifest.kind !== 'skill' || manifest.skills.length !== 1 || manifest.tools.length) fail('OPERATION_SCOPE_INVALID');
  const skill = manifest.skills[0] as FrozenExecutionSkill;
  if (request.stepId !== skill.stepId) fail('OPERATION_SCOPE_INVALID');
  const binding = skill.definition.tools.find(t => t.toolName === request.toolName);
  const snapshot = skill.context.tools.find(t => t.native.name === request.toolName);
  if (!binding || !snapshot) return fail('OPERATION_TOOL_DENIED', 403);
  const validator = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false }).compile(snapshot.native.parameters);
  if (!validator(request.parameters)) fail('OPERATION_PARAMETERS_INVALID', 400);
  const mapped: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(binding.inputMapping)) {
    const value = readSkillPath(manifest.initialInput, path); if (value !== undefined) mapped[key] = value;
  }
  if (!isDeepStrictEqual(request.parameters, mapped)) fail('OPERATION_PARAMETERS_MISMATCH');
  return { skill, binding, snapshot };
}
type Chain = Awaited<ReturnType<typeof lineage>>;
async function validatePreparedOperation(tx: QueueDbExecutor, row: typeof harnessToolEvents.$inferSelect | undefined,
  input: Record<string, unknown> & { sourceRunId: string }, operationKey: string, ownerId: string, manifest: ExecutionManifest, chain: Chain) {
  if (!row) return conflict();
  if (row.eventType !== 'business_operation_prepared' || row.status !== 'pending' || row.actionId !== operationKey
    || row.toolName !== input.toolName || row.output !== null || row.errorMessage !== null || row.resolvedAt !== null || row.riskLevel !== null) conflict();
  const stored = ledgerJson(row.input) as typeof input;
  if (!stored || !uuid(stored.sourceRunId) || stored.sourceRunId !== stored.sourceRunId.toLowerCase()
    || !isDeepStrictEqual(stored, { ...input, sourceRunId: stored.sourceRunId }) || hash(stored) !== hash({ ...input, sourceRunId: stored.sourceRunId })) conflict();
  const source = await lineage(tx, stored.sourceRunId, ownerId, manifest, chain.fingerprint, chain.sessionId);
  if (source.root !== chain.root) conflict();
}
/** Read-only internal seam: same full pending validation, never prepares or inserts an intent. */
export async function readPreparedOperationInTransaction(tx: QueueDbExecutor, runId: string, operationId: string, ownerId: string, manifest: ExecutionManifest) {
  const chain = await lineage(tx, runId, ownerId, manifest);
  const [row] = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessToolEventId, operationId), eq(harnessToolEvents.harnessRunId, chain.root))).for('share');
  if (!row) return fail('OPERATION_NOT_FOUND', 404);
  const stored = ledgerJson(row.input) as Record<string, unknown>;
  if (!stored || typeof stored !== 'object') conflict();
  const request = command({ runId, stepId: stored.stepId, ordinal: stored.ordinal, toolName: stored.toolName, parameters: stored.parameters });
  const selected = intent(manifest, request);
  const operationKey = `business-op:v1:${hash({ schemaVersion: 1, rootRunId: chain.root, stepId: request.stepId, ordinal: request.ordinal })}`;
  const content = { schemaVersion: 1, rootRunId: chain.root, manifestHash: manifest.manifestHash,
    skillId: selected.skill.skillId, versionId: selected.skill.versionId, definitionHash: selected.skill.hash,
    stepId: request.stepId, ordinal: request.ordinal, toolName: request.toolName, binding: selected.binding,
    native: selected.snapshot.native, policy: selected.snapshot.policy, parameters: request.parameters };
  const payloadHash = hash(content), input = ledgerJson({ ...content, sourceRunId: runId, payloadHash });
  if (row.effectKey !== operationKey) conflict();
  await validatePreparedOperation(tx, row, input, operationKey, ownerId, manifest, chain);
  return { operationId: row.harnessToolEventId, operationKey, payloadHash, rootRunId: chain.root, sessionId: chain.sessionId,
    executionAuthority: readExecutionAuthorityBindings(manifest, (chain.first.executionConfig as Record<string, unknown>).executionAuthority),
    input: ledgerJson(row.input), request, ...selected };
}
/** Shared confirmation condition; it cannot grant dispatch. */
export function assertOperationNeedsConfirmation(selected: ReturnType<typeof intent>, current: Awaited<ReturnType<typeof resolveCurrentSkillTools>>, toolName: string) {
  const { binding, snapshot } = selected;
  if (!(binding.requiresConfirmation || snapshot.policy.approvalStrategy === 'user-confirm' || snapshot.native.mutates
    || snapshot.native.exfiltrates || snapshot.native.source === 'mcp'
    || resolveToolPolicyEntry(current.policy, toolName).approvalStrategy === 'user-confirm')) fail('OPERATION_CONFIRMATION_NOT_REQUIRED');
}
/** Internal PREPARE ONLY. A durable pending intent is neither approval nor dispatch authority. */
export function createSkillOperationService(options: Options = {}) {
  const database = options.database ?? db, admission = createExecutionEmergencyRepository(database);
  return { async prepareOperation(initialUser: AuthUser, body: unknown) {
    try {
      const request = command(body), user = structuredClone(initialUser);
      const before = await admission.assertRunAdmission(request.runId, user.id);
      const { manifest, identity } = before;
      if (user.status !== 'active' || user.role !== identity.role) fail('EXECUTION_AUTHORITY_CHANGED', 403);
      const { skill, binding, snapshot } = intent(manifest, request);
      const prepared = await prepareSkillAuthority([], async () => {
        const current = await (options.inventory ?? resolveCurrentSkillTools)({ ...user, ...identity, businessRole: manifest.caller.businessRole } as AuthUser);
        validateFrozenExecutionTools(manifest, identity, current);
        assertOperationNeedsConfirmation({ skill, binding, snapshot }, current, request.toolName);
      }, database);
      return await database.transaction(async tx => {
        const after = await assertRunAdmissionInTransaction(tx, request.runId, user.id);
        if (hash(after) !== hash(before)) fail('EXECUTION_AUTHORITY_CHANGED', 403);
        await prepared.verify(tx);
        const chain = await lineage(tx, request.runId, user.id, manifest);
        const operationKey = `business-op:v1:${hash({ schemaVersion: 1, rootRunId: chain.root, stepId: request.stepId, ordinal: request.ordinal })}`;
        const content = { schemaVersion: 1, rootRunId: chain.root, manifestHash: manifest.manifestHash,
          skillId: skill.skillId, versionId: skill.versionId, definitionHash: skill.hash,
          stepId: request.stepId, ordinal: request.ordinal, toolName: request.toolName, binding, native: snapshot.native, policy: snapshot.policy, parameters: request.parameters };
        const payloadHash = hash(content), input = ledgerJson({ ...content, sourceRunId: request.runId, payloadHash });
        const [inserted] = await tx.insert(harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: chain.root,
          effectKey: operationKey, actionId: operationKey, toolName: request.toolName, eventType: 'business_operation_prepared', status: 'pending', input })
          .onConflictDoNothing({ target: [harnessToolEvents.harnessRunId, harnessToolEvents.effectKey] }).returning();
        const [row] = inserted ? [inserted] : await tx.select().from(harnessToolEvents)
          .where(and(eq(harnessToolEvents.harnessRunId, chain.root), eq(harnessToolEvents.effectKey, operationKey))).for('share');
        await validatePreparedOperation(tx, row, input, operationKey, user.id, manifest, chain);
        return { operationId: row.harnessToolEventId, operationKey, payloadHash, rootRunId: chain.root, status: 'pending' as const };
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      return fail('OPERATION_PREPARATION_UNAVAILABLE', 503);
    }
  } };
}
