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
import { copyTrialJson } from './skills.sandbox';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
import type { ExecutionManifest } from './execution-manifest.types';
import { selectSkillOperation, readWorkflowOperationScope, operationContent, type OperationSelection } from './skills.operation-scope';
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
/** Shared strict retry ancestry; resolving a root never grants execution permission. */
export async function resolveBusinessExecutionRootInTransaction(tx: QueueDbExecutor, runId: string, ownerId: string, manifest: ExecutionManifest) {
  return lineage(tx, runId, ownerId, manifest);
}
function intent(manifest: ExecutionManifest, request: Request) {
  if (manifest.kind !== 'skill' || manifest.skills.length !== 1 || manifest.tools.length) return fail('OPERATION_SCOPE_INVALID');
  return selectSkillOperation(manifest.skills[0], manifest.initialInput, request);
}
type Chain = Awaited<ReturnType<typeof lineage>>;
async function validatePreparedOperation(tx: QueueDbExecutor, row: typeof harnessToolEvents.$inferSelect | undefined,
  input: Record<string, unknown> & { sourceRunId: string }, operationKey: string, ownerId: string, manifest: ExecutionManifest, chain: Chain) {
  if (!row) return conflict();
  if (row.eventType !== 'business_operation_prepared' || row.status !== 'pending' || row.actionId !== operationKey
    || row.toolName !== input.toolName || row.output !== null || row.errorMessage !== null || row.resolvedAt !== null || row.riskLevel !== null) conflict();
  const stored = ledgerJson(row.input) as typeof input;
  if (!stored || !uuid(stored.sourceRunId) || stored.sourceRunId !== stored.sourceRunId.toLowerCase()
    || !isDeepStrictEqual(stored, { ...input, sourceRunId: stored.sourceRunId, ...(input.schemaVersion === 2 ? { sourceCheckpointId: stored.sourceCheckpointId, sourceCheckpointSequence: stored.sourceCheckpointSequence, sourceCheckpointHash: stored.sourceCheckpointHash } : {}) })) conflict();
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
  if (!uuid(stored.sourceRunId) || stored.sourceRunId !== stored.sourceRunId.toLowerCase()) conflict();
  const source = await lineage(tx, stored.sourceRunId as string, ownerId, manifest, chain.fingerprint, chain.sessionId);
  if (source.root !== chain.root) conflict();
  const workflow = manifest.kind === 'workflow' ? await readWorkflowOperationScope(tx, source.first, chain.root, manifest, request, String(stored.sourceCheckpointId)) : undefined;
  const selected = workflow?.selected ?? intent(manifest, request);
  const { operationKey, content } = operationContent(manifest, chain.root, request, selected, workflow);
  const payloadHash = hash(content), input = ledgerJson({ ...content, sourceRunId: runId, ...(workflow ? { sourceCheckpointId: workflow.sourceCheckpointId, sourceCheckpointSequence: workflow.sourceCheckpointSequence, sourceCheckpointHash: workflow.sourceCheckpointHash } : {}), payloadHash });
  if (workflow && (stored.sourceCheckpointSequence !== workflow.sourceCheckpointSequence || stored.sourceCheckpointHash !== workflow.sourceCheckpointHash)) conflict();
  if (row.effectKey !== operationKey) conflict();
  await validatePreparedOperation(tx, row, input, operationKey, ownerId, manifest, chain);
  return { operationId: row.harnessToolEventId, operationKey, payloadHash, rootRunId: chain.root, sessionId: chain.sessionId,
    executionAuthority: readExecutionAuthorityBindings(manifest, (chain.first.executionConfig as Record<string, unknown>).executionAuthority),
    input: ledgerJson(row.input), request, ...selected };
}
/** Current admission adds a latest-cursor fence; historical provenance intentionally omits it. */
export async function assertOperationIsCurrentInTransaction(tx: QueueDbExecutor, runId: string, ownerId: string, manifest: ExecutionManifest,
 pending: Awaited<ReturnType<typeof readPreparedOperationInTransaction>>) {
 if (manifest.kind !== 'workflow') return;
 const chain = await lineage(tx, runId, ownerId, manifest);
 const workflow = await readWorkflowOperationScope(tx, chain.first, chain.root, manifest, pending.request);
 const { operationKey, content } = operationContent(manifest, chain.root, pending.request, workflow.selected, workflow);
 if (operationKey !== pending.operationKey || hash(content) !== pending.payloadHash) fail('OPERATION_SCOPE_INVALID');
}
/** Shared confirmation condition; it cannot grant dispatch. */
export function assertOperationNeedsConfirmation(selected: OperationSelection, current: Awaited<ReturnType<typeof resolveCurrentSkillTools>>, toolName: string) {
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
      const selection = manifest.kind === 'workflow' ? await database.transaction(async tx => {
        const chain = await lineage(tx, request.runId, user.id, manifest);
        return (await readWorkflowOperationScope(tx, chain.first, chain.root, manifest, request)).selected;
      }) : intent(manifest, request);
      const prepared = await prepareSkillAuthority([], async () => {
        const current = await (options.inventory ?? resolveCurrentSkillTools)({ ...user, ...identity, businessRole: manifest.caller.businessRole } as AuthUser);
        validateFrozenExecutionTools(manifest, identity, current, { phase: 'prepare-tool', stepId: request.stepId, toolName: request.toolName });
        assertOperationNeedsConfirmation(selection, current, request.toolName);
      }, database);
      return await database.transaction(async tx => {
        const after = await assertRunAdmissionInTransaction(tx, request.runId, user.id);
        if (hash(after) !== hash(before)) fail('EXECUTION_AUTHORITY_CHANGED', 403);
        await prepared.verify(tx);
        const chain = await lineage(tx, request.runId, user.id, manifest);
        const workflow = manifest.kind === 'workflow' ? await readWorkflowOperationScope(tx, chain.first, chain.root, manifest, request) : undefined;
        const selected = workflow?.selected ?? intent(manifest, request);
        if (!isDeepStrictEqual(selected, selection)) fail('OPERATION_SCOPE_INVALID');
        const { operationKey, content } = operationContent(manifest, chain.root, request, selected, workflow);
        const payloadHash = hash(content), input = ledgerJson({ ...content, sourceRunId: request.runId, ...(workflow ? { sourceCheckpointId: workflow.sourceCheckpointId, sourceCheckpointSequence: workflow.sourceCheckpointSequence, sourceCheckpointHash: workflow.sourceCheckpointHash } : {}), payloadHash });
        const [inserted] = await tx.insert(harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: chain.root,
          effectKey: operationKey, actionId: operationKey, toolName: request.toolName, eventType: 'business_operation_prepared', status: 'pending', input })
          .onConflictDoNothing({ target: [harnessToolEvents.harnessRunId, harnessToolEvents.effectKey] }).returning();
        const [row] = inserted ? [inserted] : await tx.select().from(harnessToolEvents)
          .where(and(eq(harnessToolEvents.harnessRunId, chain.root), eq(harnessToolEvents.effectKey, operationKey))).for('share');
        await validatePreparedOperation(tx, row, input, operationKey, user.id, manifest, chain);
        // Existing winner is checked against its immutable original checkpoint, never reanchored.
        await readPreparedOperationInTransaction(tx, request.runId, row.harnessToolEventId, user.id, manifest);
        return { operationId: row.harnessToolEventId, operationKey, payloadHash, rootRunId: chain.root, status: 'pending' as const };
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      return fail('OPERATION_PREPARATION_UNAVAILABLE', 503);
    }
  } };
}
