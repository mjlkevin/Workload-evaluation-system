import Ajv from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import type { ExecutionManifest } from '../skills/execution-manifest.types';
import type { FrozenExecutionSkill } from '../skills/skills.execution-model';
import { readPersistedExecutionManifest } from '../skills/execution-manifest';
import { readSkillExecutionState, type SkillExecutionState } from '../skills/skills.execution-state';
import { copyTrialJson, readSkillPath } from '../skills/skills.sandbox';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { compileNativeToolOutput, compileSkillPayloadSchema } from '../skills/skills.validation';
import { createWorkflowRuntime, type WorkflowRuntimeState } from './workflows.runtime-adapter';

/** Stored only within the existing server-owned businessSkills.state checkpoint. */
export type BusinessSkillsHostState = { schemaVersion: 1; kind: 'skill' | 'workflow'; workflow?: WorkflowRuntimeState;
  skill?: SkillExecutionState; pendingOperation?: { operationId: string } };
export const businessSkillOperationId = (executionId: string, manifestHash: string, stepId: string) => hash({ executionId, manifestHash, stepId, iteration: 0 });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (): never => { throw new Error('BUSINESS_SKILLS_HOST_STATE_INVALID'); };
/** This validates corruption, never admits client cursors. Callers must first lock/load the real checkpoint. */
export function readBusinessSkillsHostState(value: unknown, rawManifest: ExecutionManifest, executionId: string): BusinessSkillsHostState {
  try {
    const manifest = readPersistedExecutionManifest(rawManifest);
    if (typeof executionId !== 'string' || !executionId.trim()) invalid();
    let state = copyTrialJson(value, 'definition') as BusinessSkillsHostState;
    if (!isDeepStrictEqual(state, value) || !object(state)) invalid();
    // Explicit compatibility conversion for the original bare workflow cursor.
    if (manifest.kind === 'workflow' && Object.keys(state).sort().join(',') === 'executionId,manifestHash,receipts,schemaVersion') {
      state = { schemaVersion: 1, kind: 'workflow', workflow: state as unknown as WorkflowRuntimeState };
    }
    if (state.schemaVersion !== 1 || state.kind !== manifest.kind
      || Object.keys(state).some(k => !['schemaVersion', 'kind', 'workflow', 'skill', 'pendingOperation'].includes(k))) invalid();
    let stepId = manifest.skills[0]?.stepId, input = manifest.initialInput, iteration = 0;
    let operationId = stepId ? businessSkillOperationId(executionId, manifest.manifestHash, stepId) : '';
    let directTool = false;
    if (manifest.kind === 'workflow') {
      if (!state.workflow) invalid();
      const decision = createWorkflowRuntime(manifest, executionId).next(state.workflow);
      directTool = decision.kind === 'ready' && decision.command.type === 'tool';
      if (state.skill) {
        if (decision.kind !== 'ready' || decision.command.type !== 'skill') return invalid();
        ({ stepId, input, iteration, operationId } = decision.command);
      }
    } else if (state.workflow !== undefined || manifest.skills.length !== 1 || !state.skill) invalid();
    if (state.skill !== undefined) {
      const skill = (manifest.skills as FrozenExecutionSkill[]).find(s => s.stepId === stepId); if (!skill) return invalid();
      const compiler = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false });
      const validators = new Map(skill.context.tools.map(t => [t.native.name, compiler.compile(t.native.parameters)]));
      readSkillExecutionState(state.skill, { runId: executionId, ownerUserId: manifest.caller.id, manifestHash: manifest.manifestHash,
        stepId, operationId, iteration, inputHash: hash(input) }, { ...skill.context.model, maxTokens: skill.definition.model.maxTokens }, call => {
        const binding = skill.definition.tools.find(t => t.toolName === call.name);
        if (!binding || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(call.id) || !validators.get(call.name)?.(call.arguments)) return invalid();
        const mapped: Record<string, unknown> = {};
        for (const [key, path] of Object.entries(binding.inputMapping)) { const item = readSkillPath(input, path); if (item !== undefined) mapped[key] = item; }
        if (!isDeepStrictEqual(mapped, call.arguments)) invalid();
      }, compileSkillPayloadSchema(skill.definition.outputSchema, 'outputSchema'));
      const outputValidators = new Map(skill.context.tools.map(t => [t.native.name, compileNativeToolOutput(t.native)]));
      for (const result of state.skill.toolResults) {
        const validate = outputValidators.get(result.toolName);
        if (validate && !validate(result.result)) invalid();
      }
    }
    if (state.pendingOperation !== undefined && (!object(state.pendingOperation)
      || Object.keys(state.pendingOperation).join(',') !== 'operationId' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(state.pendingOperation.operationId)
      || !(state.skill?.phase === 'tools' || directTool && !state.skill))) invalid();
    return state;
  } catch { return invalid(); }
}
