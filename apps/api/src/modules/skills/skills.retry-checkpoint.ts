import type { Database } from '../../db/client';
import type { HarnessRunRow } from '../../db/schema';
import { lockRunRow, commitHarnessCheckpointInTransaction, type HarnessTx } from '../harness/harness-runtime.repository';
import { readBusinessSkillHostCheckpointInTransaction } from '../harness/business-skills.operation-wait';
import { readBusinessSkillsCheckpoint, readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { hashHarnessCheckpointState } from '../harness/harness-runtime.worker';
import { HARNESS_WORKER_VALIDATOR_VERSION } from '../harness/harness-runtime.types';
import { BUSINESS_SKILLS_EXECUTE_STEP } from '../harness/business-skills.identity';
import type { ExecutionManifest } from './execution-manifest.types';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { readBusinessSkillsHostState } from '../harness/business-skills.host-state';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
const invalid = (): never => { throw new SkillError('INVOCATION_CONTEXT_CHANGED', '原任务检查点已变化或损坏，请重新读取', 409); };
/** The exact retry inheritance transform, shared by initialization and read-only provenance. */
export function businessRetryResumeState(raw: Record<string, unknown> | undefined,
 state: import('../harness/business-skills.host-state').BusinessSkillsHostState | undefined, manifest: ExecutionManifest, rootRunId: string) {
  let resumeRaw = raw;
  if (manifest.kind === 'workflow' && state?.workflow) {
    const runtime = createWorkflowRuntime(manifest, rootRunId), workflow = state.workflow;
    const decision = runtime.next(workflow);
    if (decision.kind === 'failed' || decision.kind === 'waiting') {
      if (!['execution_failed', 'invalid_output'].includes(decision.code))
        throw new SkillError('INVOCATION_RETRY_NOT_ALLOWED', '已拒绝或达到重复上限的节点不能重置，请重新发起业务任务', 409);
      const failure = workflow.receipts[workflow.receipts.length - 1];
      if (!failure || failure.status !== 'failed' || failure.code !== decision.code) invalid();
      const retry = runtime.next({ ...workflow, receipts: workflow.receipts.slice(0, -1) });
      if (retry.kind !== 'ready' || retry.command.operationId !== failure.operationId || !['skill', 'tool'].includes(retry.command.type)) return invalid();
      // Only the terminal execution failure is reopened. Successful prefix/iterations and logical IDs stay fixed.
      resumeRaw = raw?.kind === 'workflow' ? { ...raw, workflow: retry.state } : { ...retry.state };
      readBusinessSkillsHostState(resumeRaw, manifest, rootRunId);
    }
  }
  return resumeRaw;
}
/** Trusted latest source only. No caller can supply state, a checkpoint ID or a resume ordinal. */
export async function prepareBusinessRetryCheckpoint(database: Database, sourceRunId: string, ownerId: string, manifest: ExecutionManifest) {
  async function load(tx: HarnessTx) {
    try {
      const run = await lockRunRow(tx, sourceRunId);
      if (run.ownerUserId !== ownerId || run.status !== 'failed' || hash(readBusinessSkillsRun(run)) !== hash(manifest)) invalid();
      return await readBusinessSkillHostCheckpointInTransaction(tx, run);
    } catch { return invalid(); }
  }
  const original = await database.transaction(load);
  const resumeRaw = businessRetryResumeState(original.raw, original.state, manifest, original.chain.root);
  const proof = original.cp ? { runId: sourceRunId, checkpointId: original.cp.harnessRunCheckpointId,
    sequence: original.cp.sequence, stateHash: original.cp.stateHash } : undefined;
  return {
    proof,
    async verify(tx: HarnessTx) {
      const current = await load(tx);
      const actual = current.cp ? { runId: sourceRunId, checkpointId: current.cp.harnessRunCheckpointId,
        sequence: current.cp.sequence, stateHash: current.cp.stateHash } : undefined;
      if (hash(actual ?? null) !== hash(proof ?? null) || hash(current.raw ?? null) !== hash(original.raw ?? null)) invalid();
    },
    async initialize(tx: HarnessTx, run: HarnessRunRow) {
      if (!original.cp) return;
      if (!original.raw || run.ownerUserId !== ownerId || run.retryOfRunId !== sourceRunId
        || hash(readBusinessSkillsRun(run)) !== hash(manifest)) invalid();
      const state = { businessSkills: { schemaVersion: 1, runId: run.harnessRunId, manifestHash: manifest.manifestHash, state: resumeRaw },
        nextStepKey: (original.cp.state as Record<string, unknown>).nextStepKey };
      const committed = await commitHarnessCheckpointInTransaction(tx, { runId: run.harnessRunId,
        checkpointKey: `retry-source:${original.cp.harnessRunCheckpointId}`, checkpointKind: original.cp.checkpointKind,
        workflowId: run.workflowId!, workflowVersion: run.workflowVersion!, stepKey: BUSINESS_SKILLS_EXECUTE_STEP,
        resumePolicy: 'restart_step', state, stateHash: hashHarnessCheckpointState(state),
        // The durable reader above validates every physical-run effect key before this rebinding.
        effectKeys: (original.cp.effectKeys as string[]).map(key => `${run.harnessRunId}${key.slice(sourceRunId.length)}`),
        runtimeValidation: { validatedAt: new Date().toISOString(), validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION,
          checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } } });
      readBusinessSkillsCheckpoint(committed.checkpoint, run, manifest);
    },
  };
}
