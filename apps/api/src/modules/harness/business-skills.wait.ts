import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import type { AuthUser } from '../../types';
import { harnessRunAttempts, harnessRunCheckpoints, harnessRuns, type HarnessRunRow } from '../../db/schema';
import { copyTrialJson, skillDefinitionHash as hash } from '../skills/skills.module';
import {
  appendRunEventInTransaction, commitHarnessCheckpointInTransaction, findRunEventByActionId,
  HarnessRuntimeError, lockRunRow, pauseRunForToolWait, readDbNow, type HarnessTx,
} from './harness-runtime.repository';
import { HARNESS_WORKER_VALIDATOR_VERSION } from './harness-runtime.types';
import { HarnessWorkflowWaitingError, hashHarnessCheckpointState } from './harness-runtime.worker';
import { readBusinessSkillsCheckpoint, readBusinessSkillsRun, type BusinessSkillsExecutor } from './business-skills.workflow';
import { createWorkflowRuntime, type WorkflowCommand, type WorkflowRuntimeState } from './workflows.runtime-adapter';
import { BUSINESS_SKILLS_EXECUTE_STEP as STEP } from './business-skills.identity';
import { readBusinessSkillsHostState, type BusinessSkillsHostState } from './business-skills.host-state';
import { resolveBusinessExecutionRootInTransaction } from '../skills/skills.operations';
import { assertRunAdmissionInTransaction } from '../skills/execution-emergency';

export type BusinessSkillsWaitCommand = Extract<WorkflowCommand, { type: 'userInput' | 'confirmation' }>;
type WaitCommand = BusinessSkillsWaitCommand;
type Answer = { runId: string; sessionId: string; requestedBy: string; actionId: string;
  kind: 'userInput' | 'confirmation'; stepId: string; contentHash: string; value: unknown };
function invalid(): never { throw new HarnessRuntimeError('BUSINESS_SKILLS_WAIT_INVALID'); }
function safe<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch(error => {
    if (error instanceof HarnessRuntimeError && error.code.startsWith('BUSINESS_SKILLS_')) throw error;
    throw new HarnessRuntimeError('BUSINESS_SKILLS_WAIT_INVALID');
  });
}
function envelope(run: HarnessRunRow, state: WorkflowRuntimeState, host?: BusinessSkillsHostState) {
  return { businessSkills: { schemaVersion: 1, runId: run.harnessRunId, manifestHash: state.manifestHash,
    state: host ? { schemaVersion: 1, kind: 'workflow', workflow: state } : state }, nextStepKey: STEP };
}
export function businessSkillsWaitDescriptor(run: HarnessRunRow, command: WaitCommand) {
  return businessSkillsWaitDescriptorFromValidatedManifest(run, readBusinessSkillsRun(run).manifestHash, command);
}
/** Server-only seam: caller has already validated and locked this Run's manifest/lineage. */
export function businessSkillsWaitActionId(run: HarnessRunRow, manifestHash: string, content: {
  operationId: string; kind: WaitCommand['type']; stepId: string; contractHash: string; contentHash: string;
}) {
  return hash({ runId: run.harnessRunId, ownerUserId: run.ownerUserId, sessionId: run.aiSessionId, manifestHash, ...content });
}
/** Same descriptor, without repeatedly parsing a manifest already validated by the caller. */
export function businessSkillsWaitDescriptorFromValidatedManifest(run: HarnessRunRow, manifestHash: string, command: WaitCommand) {
  const contentHash = hash({ prompt: command.prompt, displayInput: command.input });
  const binding = { operationId: command.operationId,
    kind: command.type, stepId: command.stepId, contractHash: hash(command.outputSchema), contentHash };
  return { actionId: businessSkillsWaitActionId(run, manifestHash, binding), kind: command.type, stepId: command.stepId, contentHash,
    prompt: command.prompt, outputSchema: command.outputSchema, displayInput: command.input };
}
async function latest(tx: HarnessTx, run: HarnessRunRow) {
  const manifest = readBusinessSkillsRun(run);
  // Pre-authority bare Workflow waits remain answerable. They cannot authorize production dispatch
  // or a retry; every admitted/retried Run must use the strict original-root lineage reader.
  const legacy = !run.retryOfRunId && !Object.prototype.hasOwnProperty.call(run.executionConfig, 'executionAuthority');
  const chain = legacy ? { root: run.harnessRunId } : await resolveBusinessExecutionRootInTransaction(tx, run.harnessRunId, run.ownerUserId, manifest);
  const [cp] = await tx.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId))
    .orderBy(desc(harnessRunCheckpoints.sequence)).limit(1).for('share');
  if ((cp?.harnessRunCheckpointId ?? null) !== run.lastCheckpointId) invalid();
  const raw = cp ? readBusinessSkillsCheckpoint(cp, run, manifest) : undefined;
  if (legacy && raw?.kind !== undefined) invalid();
  const state = raw ? readBusinessSkillsHostState(raw, manifest, chain.root) : undefined;
  const runtime = createWorkflowRuntime(manifest, chain.root);
  return { cp, raw, state, chain, runtime, wrapped: raw?.kind === 'workflow', decision: runtime.next(state?.workflow) };
}
async function checkpoint(tx: HarnessTx, run: HarnessRunRow, key: string, state: WorkflowRuntimeState, attemptId?: string, host?: BusinessSkillsHostState) {
  const value = envelope(run, state, host);
  return commitHarnessCheckpointInTransaction(tx, { runId: run.harnessRunId, attemptId, checkpointKey: key,
    checkpointKind: 'structural', workflowId: run.workflowId, workflowVersion: run.workflowVersion, stepKey: STEP,
    resumePolicy: 'restart_step', state: value, stateHash: hashHarnessCheckpointState(value),
    runtimeValidation: { validatedAt: new Date().toISOString(), validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION,
      checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } } });
}
/** Internal repository/service: only identifiers enter pause; all contracts come from the locked durable run. */
export function createBusinessSkillsWaitService(database: Database) {
  return {
    pause(input: { runId: string; attemptId: string }) {
      return safe(async () => {
        const identifiers = copyTrialJson(input, 'definition') as typeof input;
        if (Object.keys(identifiers).sort().join(',') !== 'attemptId,runId') invalid();
        return pauseRunForToolWait(database, { ...identifiers, actionId: '', payload: {}, eventType: 'workflow.awaiting_input',
          terminalMessage: 'business run is terminal', notRunningMessage: 'business run is not running', cancelReason: 'business_wait_cancelled',
          async beforeWait(tx, run) {
            const current = await latest(tx, run);
            const [attempt] = await tx.select().from(harnessRunAttempts).where(and(
              eq(harnessRunAttempts.harnessRunAttemptId, identifiers.attemptId), eq(harnessRunAttempts.harnessRunId, run.harnessRunId),
              sql`${harnessRunAttempts.status} IN ('claimed', 'running')`)).for('update');
            if (!attempt) invalid();
            // Both rows are locked now. Transaction time (now()) may predate a long lock wait.
            const lease = await tx.execute(sql`SELECT ${harnessRunAttempts.leaseExpiresAt} > clock_timestamp() AS valid
              FROM ${harnessRunAttempts} WHERE ${harnessRunAttempts.harnessRunAttemptId} = ${identifiers.attemptId}`);
            if ((lease.rows as Array<{ valid: boolean }>)[0]?.valid !== true || current.decision.kind !== 'ready'
              || !['userInput', 'confirmation'].includes(current.decision.command.type)) invalid();
            const command = current.decision.command as WaitCommand;
            const payload = businessSkillsWaitDescriptor(run, command);
            copyTrialJson(payload, 'definition');
            await checkpoint(tx, run, `wait:${payload.actionId}`, current.decision.state, identifiers.attemptId, current.wrapped ? current.state : undefined);
            return { actionId: payload.actionId, payload, eventType: command.type === 'userInput'
              ? 'workflow.awaiting_input' : 'workflow.awaiting_confirmation' };
          },
        });
      });
    },
    answer(input: Answer, expectedRole?: AuthUser['role']) {
      return safe(async () => {
        const data = copyTrialJson(input, 'definition') as Answer;
        if (Object.keys(data).sort().join(',') !== ['runId', 'sessionId', 'requestedBy', 'actionId', 'kind', 'stepId', 'contentHash', 'value'].sort().join(',')) invalid();
        return database.transaction(async tx => {
          const run = await lockRunRow(tx, data.runId);
          const manifest = readBusinessSkillsRun(run);
          if (run.ownerUserId !== data.requestedBy || run.aiSessionId !== data.sessionId) invalid();
          const current = await latest(tx, run);
          const [waitCheckpoint] = await tx.select().from(harnessRunCheckpoints).where(and(
            eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId), eq(harnessRunCheckpoints.checkpointKey, `wait:${data.actionId}`)));
          if (!waitCheckpoint) invalid();
          const originalRaw = readBusinessSkillsCheckpoint(waitCheckpoint, run, manifest);
          const originalHost = readBusinessSkillsHostState(originalRaw, manifest, current.chain.root);
          const original = current.runtime.next(originalHost.workflow);
          if (original.kind !== 'ready' || !['userInput', 'confirmation'].includes(original.command.type)) invalid();
          const expected = businessSkillsWaitDescriptor(run, original.command as WaitCommand);
          for (const key of ['actionId', 'kind', 'stepId', 'contentHash'] as const) if (data[key] !== expected[key]) invalid();
          const settled = current.runtime.settle(original.state, { operationId: original.command.operationId, output: data.value });
          const valueHash = hash(data.value);
          const existing = await findRunEventByActionId(tx, run.harnessRunId, 'workflow.answer_recorded', data.actionId);
          if (existing) {
            if ((existing.payload as Record<string, unknown>).valueHash !== valueHash) invalid();
            return { created: false, run, event: existing };
          }
          if (run.status !== 'waiting' || run.cancelRequestedAt || current.cp?.harnessRunCheckpointId !== waitCheckpoint.harnessRunCheckpointId) invalid();
          // Historical exact answers above grant nothing new. New modern answers must still
          // hold the current DB permission/epoch fence in this same checkpoint-write transaction.
          if (Object.prototype.hasOwnProperty.call(run.executionConfig, 'executionAuthority')) {
            const admission = await assertRunAdmissionInTransaction(tx, run.harnessRunId, data.requestedBy);
            // HTTP supplies the trusted authenticated role separately from the answer body.
            if (expectedRole !== undefined && admission.identity.role !== expectedRole) invalid();
          }
          await checkpoint(tx, run, `answer:${data.actionId}`, settled.state, undefined, originalRaw.kind === 'workflow' ? originalHost : undefined);
          const event = await appendRunEventInTransaction(tx, { runId: run.harnessRunId, eventType: 'workflow.answer_recorded',
            payload: { actionId: data.actionId, kind: data.kind, stepId: data.stepId, contentHash: data.contentHash,
              requestedBy: data.requestedBy, valueHash, ...(data.kind === 'confirmation' ? { approved: (data.value as { approved: boolean }).approved } : {}) } });
          const now = await readDbNow(tx);
          const [updated] = await tx.update(harnessRuns).set({ status: 'queued', availableAt: now, updatedAt: now })
            .where(eq(harnessRuns.harnessRunId, run.harnessRunId)).returning();
          return { created: true, run: updated, event };
        });
      });
    },
  };
}
/** Limited internal executor. Model/Skill/tool execution remains unavailable and unregistered at production boot. */
export function createBusinessWorkflowWaitExecutor(service: ReturnType<typeof createBusinessSkillsWaitService>): BusinessSkillsExecutor {
  return async ({ manifest, state, context }) => {
    const runtime = createWorkflowRuntime(manifest, context.run.harnessRunId);
    const decision = runtime.next(Object.keys(state).length ? state : undefined);
    if (decision.kind === 'ready' && ['userInput', 'confirmation'].includes(decision.command.type)) {
      await service.pause({ runId: context.run.harnessRunId, attemptId: context.attempt.harnessRunAttemptId });
      // Both waiting and cancellation have already committed; Worker must not overwrite either outcome.
      throw new HarnessWorkflowWaitingError();
    }
    if (decision.kind !== 'completed') throw new HarnessRuntimeError('BUSINESS_SKILLS_COMMAND_UNAVAILABLE');
    return { nextStepKey: null, state: decision.state, checkpoint: { key: `completed:${hash(decision.state)}`, kind: 'structural', resumePolicy: 'restart_step' },
      output: { status: 'final', content: decision.output, contentHash: hash(decision.output) } };
  };
}
