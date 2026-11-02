import type { HarnessRunCheckpointRow, HarnessRunRow } from '../../db/schema';
import {
  compileSkillPayloadSchema, copyTrialJson, readPersistedExecutionManifest,
  skillDefinitionHash as hash, type ExecutionManifest,
} from '../skills/skills.module';
import {
  BUSINESS_SKILLS_WORKFLOW_ID as ID, BUSINESS_SKILLS_WORKFLOW_VERSION as VERSION,
  BUSINESS_SKILLS_EXECUTE_STEP as STEP,
} from './business-skills.identity';
import { HARNESS_CHECKPOINT_KINDS } from './harness-runtime.types';
import {
  HarnessWorkflowCancelledError, hashHarnessCheckpointState, type HarnessWorkflow,
  type HarnessWorkflowStepContext, type HarnessWorkflowCheckpointDirective,
  type HarnessWorkflowOutputDirective,
} from './harness-runtime.worker';

export type BusinessSkillsExecutionResult = {
  nextStepKey: 'execute' | null;
  state: Record<string, unknown>;
  checkpoint: HarnessWorkflowCheckpointDirective;
  output?: HarnessWorkflowOutputDirective;
};
/** Trusted server port. No production executor is wired in C2a.2. */
export type BusinessSkillsExecutor = (input: {
  manifest: ExecutionManifest;
  state: Record<string, unknown>;
  context: HarnessWorkflowStepContext;
}) => Promise<BusinessSkillsExecutionResult>;

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const fail = (reason: string): never => { throw new Error(reason); };
function invalidRun(): never { return fail('BUSINESS_SKILLS_INVALID_RUN'); }
function invalidState(): never { return fail('BUSINESS_SKILLS_INVALID_STATE'); }
function invalidResult(): never { return fail('BUSINESS_SKILLS_INVALID_RESULT'); }

function readRun(run: HarnessRunRow): ExecutionManifest {
  try {
    const config = run.executionConfig as Record<string, unknown>;
    const manifest = readPersistedExecutionManifest(config?.executionManifest);
    if (run.workflowId !== ID || run.workflowVersion !== VERSION || run.runKind !== 'workbench_chat'
      || typeof run.aiSessionId !== 'string' || !run.aiSessionId.trim() || run.ownerUserId !== manifest.caller.id
      || typeof config.content !== 'string' || !config.content.trim()) invalidRun();
    const execution = {
      kind: manifest.kind,
      [manifest.kind === 'skill' ? 'skillId' : 'workflowId']: manifest.target.id,
      input: manifest.initialInput,
      sources: manifest.sources,
    };
    const expected = hash({ sessionId: run.aiSessionId, content: config.content.trim(), execution });
    if ((run.metadata as Record<string, unknown>)?.invocationFingerprint !== expected) invalidRun();
    return manifest;
  } catch { return invalidRun(); }
}

function readCheckpoint(cp: HarnessRunCheckpointRow, run: HarnessRunRow, manifest: ExecutionManifest): Record<string, unknown> {
  try {
    const state = cp.state as Record<string, unknown>;
    const envelope = state?.businessSkills;
    // Every recovery re-enters execute. A null successor never bypasses validation/output.
    if (cp.harnessRunId !== run.harnessRunId || cp.workflowId !== ID || cp.workflowVersion !== VERSION || cp.stepKey !== STEP
      || cp.resumePolicy !== 'restart_step' || !object(state) || (state.nextStepKey !== STEP && state.nextStepKey !== null)
      || Object.keys(state).some(key => !['businessSkills', 'nextStepKey'].includes(key)) || !object(envelope)
      || Object.keys(envelope).some(key => !['schemaVersion', 'runId', 'manifestHash', 'state'].includes(key))
      || envelope.schemaVersion !== 1 || envelope.runId !== run.harnessRunId || envelope.manifestHash !== manifest.manifestHash
      || !object(envelope.state) || hashHarnessCheckpointState(state) !== cp.stateHash || !Array.isArray(cp.effectKeys)
      || !cp.effectKeys.every(key => typeof key === 'string' && key.startsWith(`${run.harnessRunId}:`))) invalidState();
    const copied = copyTrialJson(envelope.state, 'definition');
    if (!object(copied)) invalidState();
    return copied;
  } catch { return invalidState(); }
}

function readState(ctx: HarnessWorkflowStepContext, manifest: ExecutionManifest): Record<string, unknown> {
  try {
    if (ctx.resumeFrom) {
      if (!Object.keys(ctx.state).length) invalidState();
      readCheckpoint(ctx.resumeFrom, ctx.run, manifest);
    }
    if (!Object.keys(ctx.state).length) return {};
    // Worker retains the attempt's original resumeFrom while subsequent steps advance state.
    // Validate both records independently; comparing their cursor values would reject continuation.
    const current = {
      harnessRunId: ctx.run.harnessRunId, workflowId: ID, workflowVersion: VERSION,
      stepKey: STEP, resumePolicy: 'restart_step', state: ctx.state,
      stateHash: hashHarnessCheckpointState(ctx.state), effectKeys: [],
    } as unknown as HarnessRunCheckpointRow;
    return readCheckpoint(current, ctx.run, manifest);
  } catch { return invalidState(); }
}

function readResult(raw: unknown, runId: string, manifest: ExecutionManifest): BusinessSkillsExecutionResult {
  try {
    const value = copyTrialJson(raw, 'definition') as BusinessSkillsExecutionResult;
    if (!object(value) || Object.keys(value).some(key => !['nextStepKey', 'state', 'checkpoint', 'output'].includes(key))
      || (value.nextStepKey !== STEP && value.nextStepKey !== null) || !object(value.state)) invalidResult();
    const cp = value.checkpoint;
    if (!object(cp) || typeof cp.key !== 'string' || !cp.key.trim() || !HARNESS_CHECKPOINT_KINDS.includes(cp.kind)
      || cp.resumePolicy !== 'restart_step' || (cp.effectKeys !== undefined && (!Array.isArray(cp.effectKeys)
      || !cp.effectKeys.every(key => typeof key === 'string' && key.startsWith(`${runId}:`))))) invalidResult();
    const output = value.output;
    if (value.nextStepKey === null && (!output || output.status !== 'final')) invalidResult();
    if (output !== undefined && (!object(output) || !object(output.content) || !['partial', 'final'].includes(output.status)
      || hash(output.content) !== output.contentHash || (value.nextStepKey !== null && output.status === 'final')
      || (output.status === 'final' && !compileSkillPayloadSchema(manifest.target.definition.outputSchema, 'outputSchema')(output.content)))) invalidResult();
    return value;
  } catch { return invalidResult(); }
}

export function createBusinessSkillsWorkflow(options: { executor?: BusinessSkillsExecutor } = {}): HarnessWorkflow {
  function available() {
    if (!options.executor) fail('BUSINESS_SKILLS_EXECUTOR_UNAVAILABLE');
  }
  return {
    workflowId: ID,
    workflowVersion: VERSION,
    firstStepKey: STEP,
    stepKeys: [STEP],
    preflight(run, checkpoints) {
      const manifest = readRun(run);
      if (!Array.isArray(checkpoints)) invalidState();
      for (const cp of checkpoints) readCheckpoint(cp, run, manifest);
      available();
    },
    async executeStep(stepKey, ctx) {
      const manifest = readRun(ctx.run);
      if (stepKey !== STEP || ctx.stepKey !== STEP) invalidState();
      const state = readState(ctx, manifest);
      available();
      if (ctx.abortSignal.aborted) throw new HarnessWorkflowCancelledError();
      let raw: unknown;
      try {
        raw = await options.executor!({
          manifest: structuredClone(manifest),
          state: structuredClone(state),
          context: {
            ...ctx, run: structuredClone(ctx.run), attempt: structuredClone(ctx.attempt),
            state: structuredClone(ctx.state), resumeFrom: structuredClone(ctx.resumeFrom),
          },
        });
      } catch (error) {
        if (error instanceof HarnessWorkflowCancelledError) throw error;
        if (ctx.abortSignal.aborted) throw new HarnessWorkflowCancelledError();
        return fail('BUSINESS_SKILLS_EXECUTION_FAILED');
      }
      if (ctx.abortSignal.aborted) throw new HarnessWorkflowCancelledError();
      const value = readResult(raw, ctx.run.harnessRunId, manifest);
      return {
        nextStepKey: value.nextStepKey,
        checkpoint: value.checkpoint,
        output: value.output,
        statePatch: {
          businessSkills: {
            schemaVersion: 1, runId: ctx.run.harnessRunId,
            manifestHash: manifest.manifestHash, state: value.state,
          },
        },
      };
    },
  };
}
