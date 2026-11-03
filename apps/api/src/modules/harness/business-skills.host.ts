import { isDeepStrictEqual } from 'node:util';
import { db } from '../../db/client';
import { resolveCurrentSkillTools } from '../skills/skills.context';
import { assertRunAdmissionInTransaction } from '../skills/execution-emergency';
import { createResumableSkillExecutor } from '../skills/skills.execution-resumable';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { SkillError } from '../skills/skills.types';
import { lockRunRow } from './harness-runtime.repository';
import { HarnessWorkflowCancelledError, HarnessWorkflowWaitingError } from './harness-runtime.worker';
import type { BusinessSkillsExecutor } from './business-skills.workflow';
import { businessSkillOperationId, type BusinessSkillsHostState } from './business-skills.host-state';
import { assertBusinessSkillAttemptInTransaction, readBusinessSkillHostCheckpointInTransaction } from './business-skills.operation-wait';
import { createBusinessSkillHostPorts, type BusinessSkillHostOptions } from './business-skills.host-ports';
const fail = (code: string): never => { throw new SkillError(code, '技能执行暂不可用，请检查任务和确认内容', 409); };
/** One Worker tick advances one saved Skill cursor. Trusted ports cannot replace live authority or durable budget. */
export function createBusinessSkillHost(options: BusinessSkillHostOptions = {}): BusinessSkillsExecutor {
  const database = options.database ?? db, inventory = options.inventory ?? resolveCurrentSkillTools;
  return async ({ manifest, state: supplied, context }) => {
    const runId = context.run.harnessRunId, ownerUserId = context.run.ownerUserId;
    const guard = () => { if (context.abortSignal.aborted) throw new HarnessWorkflowCancelledError(); }; guard();
    const locked = await database.transaction(async tx => {
      const run = await lockRunRow(tx, runId);
      if (run.ownerUserId !== ownerUserId || run.status !== 'running' || run.cancelRequestedAt) fail('BUSINESS_SKILLS_HOST_RUN_INVALID');
      await assertBusinessSkillAttemptInTransaction(tx, run, context.attempt.harnessRunAttemptId);
      const admission = await assertRunAdmissionInTransaction(tx, runId, ownerUserId);
      const current = await readBusinessSkillHostCheckpointInTransaction(tx, run);
      if (hash(admission.manifest) !== hash(manifest) || !isDeepStrictEqual(supplied, current.raw ?? {})) fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
      return { ...current, identity: admission.identity };
    });
    if (manifest.kind !== 'skill' || manifest.skills.length !== 1) fail('BUSINESS_SKILLS_HOST_KIND_UNSUPPORTED');
    const host: BusinessSkillsHostState = locked.state ?? { schemaVersion: 1, kind: 'skill' };
    const ports = createBusinessSkillHostPorts({ ...options, database, inventory, manifest, runId, ownerUserId,
      identity: locked.identity, signal: context.abortSignal, pendingOperation: host.pendingOperation });
    await ports.check('resume'); guard();
    if (host.pendingOperation) {
      const status = await ports.pendingStatus(); guard();
      if (status === 'rejected') fail('BUSINESS_SKILLS_OPERATION_REJECTED');
      if (status === 'pending') { await ports.pause(context.attempt.harnessRunAttemptId); throw new HarnessWorkflowWaitingError(); }
    }
    const skill = manifest.skills[0], executor = createResumableSkillExecutor(ports);
    const advanced = await executor.advance({ runId: locked.chain.root, ownerUserId, manifest, input: manifest.initialInput, stepId: skill.stepId,
      operationId: businessSkillOperationId(locked.chain.root, manifest.manifestHash, skill.stepId), iteration: 0,
      ...(host.skill ? { state: host.skill } : {}), signal: context.abortSignal }); guard();
    const next: BusinessSkillsHostState = { schemaVersion: 1, kind: 'skill', skill: advanced.state,
      ...(advanced.pendingOperation ? { pendingOperation: { operationId: advanced.pendingOperation.operationId } } : {}) };
    return { nextStepKey: advanced.kind === 'completed' ? null : 'execute', state: next,
      checkpoint: { key: `host:${hash(next)}`, kind: 'structural', resumePolicy: 'restart_step' },
      ...(advanced.kind === 'completed' ? { output: { status: 'final' as const, content: advanced.output as Record<string, unknown>, contentHash: hash(advanced.output) } } : {}) };
  };
}
