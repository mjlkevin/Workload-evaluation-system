import Ajv from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { anyRoleHasCapability } from '../../rbac/permissions';
import { readPersistedExecutionManifest } from './execution-manifest';
import type { ExecutionManifest } from './execution-manifest.types';
import { skillDefinitionHash as hash } from './skills.hash';
import { compileNativeToolOutput, compileSkillPayloadSchema } from './skills.validation';
import { copyTrialJson, readSkillPath, type SkillToolCall } from './skills.sandbox';
import { SkillError } from './skills.types';
import { readSkillExecutionState, safeSkillMetadata, type SkillExecutionStateBinding } from './skills.execution-state';
import type { SkillModelRequest, SkillModelResponse } from './skills.evaluation';
import type { FrozenExecutionSkill } from './skills.execution-model';
import type { SkillExecutionToolRequest } from './skills.execution';
import type { SkillExecutionState } from './skills.execution-state';
export type ResumableSkillIdentity = { runId: string; ownerUserId: string; manifestHash: string; stepId: string; operationId: string; iteration: number };
export type ResumableSkillAdvanceRequest = Omit<ResumableSkillIdentity, 'manifestHash'> & { manifest: unknown; input: unknown; state?: unknown; signal: AbortSignal };
export type ResumableSkillModelRequest = SkillModelRequest & ResumableSkillIdentity & { skill: FrozenExecutionSkill };
export type ResumableSkillToolRequest = SkillExecutionToolRequest & ResumableSkillIdentity & { ordinal: number };
export type ResumableSkillPendingOperation = { operationId: string; confirmationHash?: string };
export type ResumableSkillToolResult = { kind: 'completed'; result: unknown } | ({ kind: 'waiting' } & ResumableSkillPendingOperation);
/** Trusted server ports must enforce live authority and persistent budgets on every dispatch. */
export type ResumableSkillPorts = { complete?: (request: ResumableSkillModelRequest) => Promise<SkillModelResponse>; tool?: (request: ResumableSkillToolRequest) => Promise<ResumableSkillToolResult> };
export type ResumableSkillAdvanceResult = { kind: 'checkpoint' | 'waiting' | 'completed'; state: SkillExecutionState; output?: unknown; pendingOperation?: ResumableSkillPendingOperation };
export class ResumableSkillFailure extends Error { constructor(readonly code: string) { super(code); } }
function fail(code: string): never { throw new ResumableSkillFailure(code); }
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
function json<T>(value: T): T {
  try { const copied = copyTrialJson(value) as T; if (!isDeepStrictEqual(value, copied)) fail('INVALID_OR_OVERSIZED_JSON'); return copied; }
  catch { return fail('INVALID_OR_OVERSIZED_JSON'); }
}
const safePortCodes = new Set(['EXECUTION_AUTHORITY_DENIED', 'EXECUTION_BUDGET_EXHAUSTED', 'EXECUTION_BUDGET_ABORTED',
  'EXECUTION_BUDGET_TIMEOUT', 'EXECUTION_BUDGET_USAGE_INVALID', 'EXECUTION_BUDGET_LEDGER_INVALID', 'EXECUTION_BUDGET_UNAVAILABLE',
  'EXECUTION_BUDGET_INVALID_REQUEST', 'EXECUTION_BUDGET_CALLBACK_FAILED', 'CANCELLED']);
function portFailure(error: unknown, fallback: string): never {
  return fail((error instanceof SkillError || error instanceof ResumableSkillFailure) && safePortCodes.has(error.code) ? error.code : fallback);
}
/** One advance does at most one model call or one effect. Persist each returned state before advancing. */
export function createResumableSkillExecutor(ports: ResumableSkillPorts = {}) {
  return { async advance(request: ResumableSkillAdvanceRequest): Promise<ResumableSkillAdvanceResult> {
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).some(key => !['runId', 'ownerUserId', 'manifest', 'stepId', 'operationId', 'iteration', 'input', 'state', 'signal'].includes(key))
      || !text(request.runId) || !text(request.ownerUserId) || !text(request.stepId) || !text(request.operationId)
      || !Number.isSafeInteger(request.iteration) || request.iteration < 0 || !(request.signal instanceof AbortSignal)) fail('EXECUTION_INVALID_REQUEST');
    const guard = () => { if (request.signal.aborted) fail('CANCELLED'); }; guard();
    let manifest: ExecutionManifest;
    try { manifest = readPersistedExecutionManifest(request.manifest); } catch { return fail('EXECUTION_MANIFEST_INVALID'); }
    if (request.ownerUserId !== manifest.caller.id) fail('EXECUTION_AUTHORITY_DENIED');
    const skill = (manifest.skills as FrozenExecutionSkill[]).find(s => s.stepId === request.stepId); if (!skill) fail('EXECUTION_STEP_NOT_FOUND');
    const input = json(request.input), definition = skill.definition;
    if (manifest.kind === 'skill' && !isDeepStrictEqual(input, manifest.initialInput)) fail('EXECUTION_INPUT_MISMATCH');
    if (!compileSkillPayloadSchema(definition.inputSchema, 'inputSchema')(input)) fail('INPUT_SCHEMA_FAILED');
    const validateOutput = compileSkillPayloadSchema(definition.outputSchema, 'outputSchema');
    const compiler = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false });
    for (const { native, policy } of skill.context.tools) {
      if (!policy.enabled || !anyRoleHasCapability(skill.context.roles, native.capability)
        || (native.source === 'code' && policy.visibleRoles.length && !policy.visibleRoles.some(role => skill.context.roles.some(current => current === role)))) fail('TOOL_SNAPSHOT_DENIED');
    }
    const validators = new Map(skill.context.tools.map(t => [t.native.name, compiler.compile(t.native.parameters)]));
    const outputValidators = new Map(skill.context.tools.map(t => [t.native.name, compileNativeToolOutput(t.native)]));
    const validateCall = (value: SkillToolCall) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['id', 'name', 'arguments'].includes(key))
        || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.id) || typeof value.name !== 'string') fail('INVALID_OR_REPEATED_TOOL_CALL');
      const binding = definition.tools.find(t => t.toolName === value.name), snapshot = skill.context.tools.find(t => t.native.name === value.name);
      if (!binding || !snapshot) fail('TOOL_NOT_ALLOWED');
      const parameters = json(value.arguments);
      if (!validators.get(value.name)!(parameters)) fail('NATIVE_PARAMETERS_INVALID');
      const mapped: Record<string, unknown> = Object.create(null);
      for (const [key, path] of Object.entries(binding.inputMapping)) { const item = readSkillPath(input, path); if (item !== undefined) mapped[key] = item; }
      if (!isDeepStrictEqual(parameters, { ...mapped })) fail('TOOL_MAPPING_MISMATCH');
      if ((snapshot.native.mutates || snapshot.native.exfiltrates) && !binding.requiresConfirmation) fail('TOOL_SNAPSHOT_DENIED');
      return { binding, snapshot, call: { id: value.id, name: value.name, arguments: parameters } };
    };
    const identity: ResumableSkillIdentity = { runId: request.runId, ownerUserId: request.ownerUserId, manifestHash: manifest.manifestHash,
      stepId: request.stepId, operationId: request.operationId, iteration: request.iteration };
    const binding: SkillExecutionStateBinding = { ...identity, inputHash: hash(input) };
    let state: SkillExecutionState;
    if (request.state !== undefined) {
      try {
        state = readSkillExecutionState(request.state, binding, { ...skill.context.model, maxTokens: definition.model.maxTokens }, validateCall, validateOutput);
        for (const result of state.toolResults) {
          const validate = outputValidators.get(result.toolName);
          if (validate && !validate(result.result)) fail('EXECUTION_STATE_INVALID');
        }
      }
      catch { return fail('EXECUTION_STATE_INVALID'); }
    } else state = { schemaVersion: 1, ...binding, phase: 'model', toolResults: [], seenCallIds: [], pendingBatch: [], nextToolIndex: 0, usage: { modelAttempts: 0, outputTokens: 0 } };
    const finish = (kind: ResumableSkillAdvanceResult['kind'], pendingOperation?: ResumableSkillPendingOperation): ResumableSkillAdvanceResult => {
      guard(); const saved = json(state);
      return { kind, state: saved, ...(kind === 'completed' ? { output: json(saved.output) } : {}), ...(pendingOperation ? { pendingOperation: json(pendingOperation) } : {}) };
    };
    if (state.phase === 'completed') return finish('completed');
    if (state.phase === 'tools') {
      if (!ports.tool) fail('TOOL_PORT_UNAVAILABLE');
      const entry = state.pendingBatch[state.nextToolIndex], validated = validateCall({ id: entry.callId, name: entry.name, arguments: entry.arguments });
      let result: ResumableSkillToolResult;
      guard();
      try { result = await ports.tool({ ...identity, ordinal: entry.ordinal, caller: structuredClone(manifest.caller), stepId: skill.stepId,
        skillId: skill.skillId, versionId: skill.versionId, binding: structuredClone(validated.binding), snapshot: structuredClone(validated.snapshot),
        call: structuredClone(validated.call), input: structuredClone(input), signal: request.signal }); }
      catch (error) { guard(); return portFailure(error, 'TOOL_PORT_FAILED'); }
      guard(); result = json(result);
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail('TOOL_PORT_INVALID');
      if (result.kind === 'waiting') {
        if (Object.keys(result).some(key => !['kind', 'operationId', 'confirmationHash'].includes(key)) || !text(result.operationId)
          || (result.confirmationHash !== undefined && !/^[a-f0-9]{64}$/.test(result.confirmationHash))) fail('TOOL_PORT_INVALID');
        return finish('waiting', { operationId: result.operationId, ...(result.confirmationHash !== undefined ? { confirmationHash: result.confirmationHash } : {}) });
      }
      if (result.kind !== 'completed' || !own(result, 'result') || Object.keys(result).some(key => !['kind', 'result'].includes(key))) fail('TOOL_PORT_INVALID');
      const validate = outputValidators.get(entry.name);
      if (validate && !validate(result.result)) fail('NATIVE_OUTPUT_SCHEMA_FAILED');
      state.toolResults.push({ callId: entry.callId, toolName: entry.name, arguments: entry.arguments, simulated: false, result: result.result });
      state.nextToolIndex++;
      if (state.nextToolIndex === state.pendingBatch.length) { state.phase = 'model'; state.pendingBatch = []; state.nextToolIndex = 0; }
      return finish('checkpoint');
    }
    if (!ports.complete) fail('MODEL_PORT_UNAVAILABLE');
    if (state.usage.modelAttempts >= 60) fail('MODEL_ATTEMPT_LIMIT');
    let response: SkillModelResponse;
    guard();
    try { response = await ports.complete({ ...identity, skill: structuredClone(skill), instructions: definition.instructions, input: structuredClone(input),
      outputSchema: structuredClone(definition.outputSchema), model: structuredClone(definition.model),
      tools: skill.context.tools.map(({ native }) => ({ name: native.name, description: native.description, parameters: structuredClone(native.parameters) })),
      toolResults: structuredClone(state.toolResults), signal: request.signal }); }
    catch (error) { guard(); return portFailure(error, 'MODEL_REQUEST_FAILED'); }
    guard(); response = json(response);
    if (!response || typeof response !== 'object' || Array.isArray(response) || Object.keys(response).some(key => !['provider', 'model', 'usage', 'output', 'toolCalls'].includes(key))) fail('INVALID_MODEL_RESPONSE');
    if (!safeSkillMetadata(response.provider) || !safeSkillMetadata(response.model) || !safeSkillMetadata(skill.context.model.providerId)
      || response.model !== skill.context.model.model || state.model && response.provider !== state.model.transportProvider) fail('INVALID_PROVIDER_METADATA');
    if (!response.usage || Object.keys(response.usage).some(key => key !== 'outputTokens') || !Number.isSafeInteger(response.usage.outputTokens) || response.usage.outputTokens < 1) fail('INVALID_MODEL_USAGE');
    if (response.usage.outputTokens > definition.model.maxTokens) fail('OUTPUT_TOKEN_LIMIT');
    state.usage.modelAttempts++; state.usage.outputTokens += response.usage.outputTokens;
    state.model = { providerId: skill.context.model.providerId, model: response.model, transportProvider: response.provider };
    const calls = response.toolCalls === undefined ? [] : response.toolCalls;
    if (!Array.isArray(calls) || calls.length && own(response, 'output')) fail('INVALID_MODEL_RESPONSE');
    if (!calls.length) {
      if (!own(response, 'output')) fail('MODEL_OUTPUT_REQUIRED');
      if (!validateOutput(response.output)) fail('OUTPUT_SCHEMA_FAILED');
      state.output = response.output; state.phase = 'completed'; return finish('completed');
    }
    if (state.toolResults.length + calls.length > 60) fail('TOOL_CALL_LIMIT');
    const seen = new Set(state.seenCallIds);
    const batch = calls.map((call, index) => {
      const validated = validateCall(call);
      if (seen.has(call.id)) fail('INVALID_OR_REPEATED_TOOL_CALL'); seen.add(call.id);
      return { ordinal: state.toolResults.length + index, callId: call.id, name: call.name, arguments: validated.call.arguments };
    });
    state.seenCallIds = [...seen]; state.pendingBatch = batch; state.nextToolIndex = 0; state.phase = 'tools';
    return finish('checkpoint');
  } };
}
