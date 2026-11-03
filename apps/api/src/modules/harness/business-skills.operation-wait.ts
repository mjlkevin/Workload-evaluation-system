import { and, desc, eq, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { harnessRunAttempts, harnessRunCheckpoints, harnessRuns, type HarnessRunRow } from '../../db/schema';
import type { AuthUser } from '../../types';
import { resolveCurrentSkillTools } from '../skills/skills.context';
import { readPreparedOperationInTransaction, resolveBusinessExecutionRootInTransaction } from '../skills/skills.operations';
import { createSkillOperationDecisionService } from '../skills/skills.operation-decisions';
import { assertRunAdmissionInTransaction } from '../skills/execution-emergency';
import { SkillError } from '../skills/skills.types';
import { copyTrialJson } from '../skills/skills.sandbox';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { readBusinessSkillsCheckpoint, readBusinessSkillsRun } from './business-skills.workflow';
import { readBusinessSkillsHostState } from './business-skills.host-state';
import { createWorkflowRuntime } from './workflows.runtime-adapter';
import { HarnessRuntimeError, lockRunRow, pauseRunForToolWait, readDbNow, type HarnessTx } from './harness-runtime.repository';
const invalid = (): never => { throw new HarnessRuntimeError('BUSINESS_SKILLS_OPERATION_WAIT_INVALID'); };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
/** Caller locks the Run first. No inventory, model or additional pool transaction is called under this lock. */
export async function readBusinessSkillHostCheckpointInTransaction(tx: HarnessTx, run: HarnessRunRow) {
  const manifest = readBusinessSkillsRun(run);
  const chain = await resolveBusinessExecutionRootInTransaction(tx, run.harnessRunId, run.ownerUserId, manifest);
  const [cp] = await tx.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId))
    .orderBy(desc(harnessRunCheckpoints.sequence)).limit(1).for('share');
  if ((cp?.harnessRunCheckpointId ?? null) !== run.lastCheckpointId) invalid();
  const raw = cp ? readBusinessSkillsCheckpoint(cp, run, manifest) : undefined;
  const state = raw ? readBusinessSkillsHostState(raw, manifest, chain.root) : undefined;
  return { manifest, chain, cp, raw, state };
}
export async function assertBusinessSkillAttemptInTransaction(tx: HarnessTx, run: HarnessRunRow, attemptId: string) {
  const [attempt] = await tx.select().from(harnessRunAttempts).where(and(eq(harnessRunAttempts.harnessRunAttemptId, attemptId),
    eq(harnessRunAttempts.harnessRunId, run.harnessRunId), sql`${harnessRunAttempts.status} IN ('claimed','running')`)).for('update');
  if (!attempt) invalid();
  const result = await tx.execute(sql`SELECT ${harnessRunAttempts.leaseExpiresAt} > clock_timestamp() AS valid
    FROM ${harnessRunAttempts} WHERE ${harnessRunAttempts.harnessRunAttemptId} = ${attemptId}`);
  if ((result.rows as Array<{ valid: boolean }>)[0]?.valid !== true) invalid();
}
async function pending(tx: HarnessTx, run: HarnessRunRow) {
  const current = await readBusinessSkillHostCheckpointInTransaction(tx, run), state = current.state;
  if (!state?.pendingOperation) return invalid();
  const prepared = await readPreparedOperationInTransaction(tx, run.harnessRunId, state.pendingOperation.operationId, run.ownerUserId, current.manifest);
  let stepId: string, ordinal: number, toolName: string, parameters: unknown;
  if (state.skill?.phase === 'tools') {
    const entry = state.skill.pendingBatch[state.skill.nextToolIndex];
    ({ ordinal, name: toolName, arguments: parameters } = entry); stepId = state.skill.stepId;
  } else {
    if (!state.workflow) return invalid();
    const decision = createWorkflowRuntime(current.manifest, current.chain.root).next(state.workflow);
    if (decision.kind !== 'ready' || decision.command.type !== 'tool') return invalid();
    ({ stepId, toolName, input: parameters } = decision.command); ordinal = 0;
  }
  if (prepared.request.stepId !== stepId || prepared.request.ordinal !== ordinal || prepared.request.toolName !== toolName
    || hash(prepared.request.parameters) !== hash(parameters) || prepared.rootRunId !== current.chain.root) invalid();
  const actionId = hash({ runId: run.harnessRunId, manifestHash: current.manifest.manifestHash, operationId: prepared.operationId, stepId, ordinal });
  return { current, prepared, descriptor: { kind: 'operation' as const, actionId, operationId: prepared.operationId, stepId, toolName,
    parameters: copyTrialJson(parameters, 'definition') } };
}
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools };
type Answer = { runId: string; actionId: string; confirmationHash: string; decision: 'approve' | 'reject' };
/** Explicit 3b decisions are the only authority. Run waiting is a retryable projection of that durable fact. */
export function createBusinessSkillOperationWaitService(options: Options = {}) {
  const database = options.database ?? db, decisions = createSkillOperationDecisionService({ database, inventory: options.inventory });
  async function owned(user: AuthUser, runId: string) {
    if (!uuid(runId)) return invalid();
    return database.transaction(async tx => {
      const run = await lockRunRow(tx, runId);
      if (run.ownerUserId !== user.id) invalid();
      return { run, ...await pending(tx, run) };
    });
  }
  return {
    async pause(input: { runId: string; attemptId: string }) {
      if (!input || Object.keys(input).sort().join(',') !== 'attemptId,runId' || !uuid(input.runId) || !uuid(input.attemptId)) invalid();
      return pauseRunForToolWait(database, { ...input, actionId: '', payload: {}, eventType: 'workflow.awaiting_confirmation',
        terminalMessage: 'business run is terminal', notRunningMessage: 'business run is not running', cancelReason: 'business_operation_wait_cancelled',
        async beforeWait(tx, run) {
          await assertBusinessSkillAttemptInTransaction(tx, run, input.attemptId);
          const value = await pending(tx, run);
          return { actionId: value.descriptor.actionId, payload: value.descriptor, eventType: 'workflow.awaiting_confirmation' };
        } });
    },
    async read(user: AuthUser, runId: string) {
      const value = await owned(user, runId);
      // Never retain the Run lock across 3b's inventory or another transaction (works with a max:1 pool).
      const view = await decisions.readForConfirmation(user, { runId, operationId: value.prepared.operationId });
      return { ...value.descriptor, ...view };
    },
    async answer(user: AuthUser, input: Answer) {
      if (!input || Object.keys(input).sort().join(',') !== 'actionId,confirmationHash,decision,runId' || !uuid(input.runId)
        || ![input.actionId, input.confirmationHash].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
        || !['approve', 'reject'].includes(input.decision)) return invalid();
      const before = await owned(user, input.runId);
      if (before.descriptor.actionId !== input.actionId || !['waiting', 'queued', 'running', 'recovering'].includes(before.run.status) || before.run.cancelRequestedAt) invalid();
      if (before.run.status !== 'waiting') {
        // Only an already recorded exact decision may be retried while a Worker is running.
        // A first answer before pause would otherwise race pause and strand an approved waiting Run.
        const existing = await decisions.readForConfirmation(user, { runId: input.runId, operationId: before.prepared.operationId });
        if (existing.decision !== input.decision || existing.confirmationHash !== input.confirmationHash) invalid();
      }
      const view = await decisions.decideOperation(user, { runId: input.runId, operationId: before.prepared.operationId,
        confirmationHash: input.confirmationHash, decision: input.decision });
      // A crash before this transaction leaves the exact decision recoverable by the same explicit request.
      return database.transaction(async tx => {
        const run = await lockRunRow(tx, input.runId);
        if (run.ownerUserId !== user.id || run.cancelRequestedAt) invalid();
        // The recorded decision is history; queue admission is a fresh grant in this transaction.
        const admission = await assertRunAdmissionInTransaction(tx, run.harnessRunId, user.id);
        if (user.status !== 'active' || user.role !== admission.identity.role)
          throw new SkillError('EXECUTION_AUTHORITY_CHANGED', '当前用户权限已变化', 403);
        if (run.status !== 'waiting') return { resumed: false, run, decision: view };
        const after = await pending(tx, run);
        if (after.descriptor.actionId !== input.actionId || after.prepared.operationId !== view.operationId) invalid();
        const now = await readDbNow(tx);
        const [updated] = await tx.update(harnessRuns).set({ status: 'queued', availableAt: now, updatedAt: now })
          .where(and(eq(harnessRuns.harnessRunId, run.harnessRunId), eq(harnessRuns.status, 'waiting'))).returning();
        return { resumed: true, run: updated, decision: view };
      });
    },
  };
}
