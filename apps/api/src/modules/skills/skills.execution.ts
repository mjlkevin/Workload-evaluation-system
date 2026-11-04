import Ajv from 'ajv';
import { createExecutionAuthority, type ExecutionAuthority } from './execution-authority';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { anyRoleHasCapability } from '../../rbac/permissions';
import { readPersistedExecutionManifest } from './execution-manifest';
import type { ExecutionManifest } from './execution-manifest.types';
import { compileNativeToolOutput, compileSkillPayloadSchema } from './skills.validation';
import { copyTrialJson, readSkillPath, type SkillToolCall, type SkillToolStep } from './skills.sandbox';
import type { SkillModelResponse, SkillTrialBudgets } from './skills.evaluation';
import { prepareFrozenSkillModel, type FrozenExecutionSkill, type PreparedSkillModel } from './skills.execution-model';
export type SkillExecutionRequest = { runId: string; ownerUserId: string; manifest: unknown; stepId: string; input: unknown; signal: AbortSignal; budgets?: Partial<SkillTrialBudgets> };
export type SkillExecutionResult = { status: 'succeeded' | 'failed' | 'cancelled'; code?: string; output?: unknown;
  model?: { providerId: string; model: string; transportProvider: string };
  usage: { modelAttempts: number; toolCalls: number; outputTokens: number; elapsedMs: number } };
export type SkillExecutionToolRequest = { caller: ExecutionManifest['caller']; stepId: string; skillId: string; versionId: string;
  binding: FrozenExecutionSkill['definition']['tools'][number]; snapshot: FrozenExecutionSkill['context']['tools'][number];
  call: SkillToolCall; input: unknown; signal: AbortSignal };
/** These are trusted server assembly ports, never client callbacks or authorization claims. */
export type SkillExecutionPorts = { createAuthority?: () => ExecutionAuthority; prepareModel?: (skill: FrozenExecutionSkill, signal: AbortSignal) => Promise<PreparedSkillModel>;
  toolGate?: (request: SkillExecutionToolRequest) => Promise<unknown> };
const ceilings: SkillTrialBudgets = { maxModelAttempts: 60, maxToolCalls: 60, maxOutputTokens: 128000, totalTimeoutMs: 300000 };
class Failure extends Error { constructor(readonly code: string) { super(code); } }
function fail(code: string): never { throw new Failure(code); }
const safeId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) && !/(sk-|bearer|api[-_]?key|token|secret)/i.test(value);
function json(value: unknown) { try { return copyTrialJson(value); } catch { return fail('INVALID_OR_OVERSIZED_JSON'); } }
/** Per-invocation accounting only. Persistent workflow/run budgets remain a later layer. */
export function createSkillExecutionService(ports: SkillExecutionPorts = {}) {
  return { async execute(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    const started = performance.now(); const controller = new AbortController();
    const usage = { modelAttempts: 0, toolCalls: 0, outputTokens: 0, elapsedMs: 0 };
    let model: SkillExecutionResult['model']; let terminal = false; let reason = 'CANCELLED';
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectAborted!: (error: Failure) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
    // This rejection is observed even when request validation fails before Promise.race.
    void aborted.catch(() => {});
    const stop = (code: string) => { if (!controller.signal.aborted) { reason = code; controller.abort(); rejectAborted(new Failure(code)); } };
    const onAbort = () => stop('CANCELLED');
    const guard = () => { if (terminal || controller.signal.aborted) fail(reason); };
    let deadline = Infinity;
    const remaining = () => deadline - performance.now();
    const deadlineGuard = () => { guard(); if (remaining() <= 0) { stop('TOTAL_TIMEOUT'); fail('TOTAL_TIMEOUT'); } };
    async function modelBound<T>(fn: () => Promise<T>, timeout: number, timeoutCode: string): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([aborted, new Promise<T>((resolve, reject) => {
          timer = setTimeout(() => stop(timeoutCode), timeout);
          Promise.resolve().then(() => { deadlineGuard(); return fn(); }).then(resolve, reject);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    }
    try {
      if (request.budgets !== undefined && (!request.budgets || typeof request.budgets !== 'object' || Array.isArray(request.budgets))) fail('INVALID_BUDGET');
      const overrides = request.budgets ?? {};
      const budgets = { ...ceilings, ...overrides };
      if (Object.keys(overrides).some(k => !Object.prototype.hasOwnProperty.call(ceilings, k))) fail('INVALID_BUDGET');
      for (const [key, max] of Object.entries(ceilings)) {
        const value = budgets[key as keyof SkillTrialBudgets];
        if (!Number.isInteger(value) || value < (key === 'maxToolCalls' ? 0 : 1) || value > max) fail('INVALID_BUDGET');
      }
      deadline = started + budgets.totalTimeoutMs;
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) stop('CANCELLED');
      deadlineGuard(); totalTimer = setTimeout(() => stop('TOTAL_TIMEOUT'), Math.max(1, remaining()));
      const core = async (): Promise<unknown> => {
        deadlineGuard(); let manifest: ExecutionManifest;
        try { manifest = readPersistedExecutionManifest(request.manifest); } catch { return fail('EXECUTION_MANIFEST_INVALID'); }
        const { runId, ownerUserId, stepId } = request;
        if (!runId || !ownerUserId || ownerUserId !== manifest.caller.id) fail('EXECUTION_AUTHORITY_DENIED');
        let authority: ExecutionAuthority;
        try { authority = (ports.createAuthority ?? createExecutionAuthority)(); } catch { return fail('EXECUTION_AUTHORITY_DENIED'); }
        const check = async (phase: 'model' | 'tool', toolName?: string) => {
          deadlineGuard();
          try { await authority.check({ runId, ownerUserId, manifestHash: manifest.manifestHash, phase, stepId, toolName }); }
          catch { deadlineGuard(); return fail('EXECUTION_AUTHORITY_DENIED'); }
          deadlineGuard();
        };
        const skill = (manifest.skills as FrozenExecutionSkill[]).find(s => s.stepId === stepId);
        if (!skill) fail('EXECUTION_STEP_NOT_FOUND');
        const definition = skill.definition; const input = json(request.input);
        if (manifest.kind === 'skill' && !isDeepStrictEqual(input, manifest.initialInput)) fail('EXECUTION_INPUT_MISMATCH');
        const inputValidator = compileSkillPayloadSchema(definition.inputSchema, 'inputSchema');
        if (!inputValidator(input)) fail('INPUT_SCHEMA_FAILED');
        const outputValidator = compileSkillPayloadSchema(definition.outputSchema, 'outputSchema');
        const compiler = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false });
        for (const snapshot of skill.context.tools) {
          const { native, policy } = snapshot;
          if (!policy.enabled || !anyRoleHasCapability(skill.context.roles, native.capability)
            || (native.source === 'code' && policy.visibleRoles.length && !policy.visibleRoles.some(r => skill.context.roles.some(role => role === r)))) fail('TOOL_SNAPSHOT_DENIED');
        }
        const validators = new Map(skill.context.tools.map(t => [t.native.name, compiler.compile(t.native.parameters)]));
        const tools = skill.context.tools.map(({ native }) => ({ name: native.name, description: native.description, parameters: native.parameters }));
        const seen = new Set<string>(); const toolResults: SkillToolStep[] = [];
        while (true) {
          deadlineGuard();
          if (usage.modelAttempts >= budgets.maxModelAttempts) fail('MODEL_ATTEMPT_LIMIT');
          const tokens = Math.min(definition.model.maxTokens, budgets.maxOutputTokens - usage.outputTokens);
          if (tokens <= 0) fail('OUTPUT_TOKEN_LIMIT');
          await check('model');
          let prepared: PreparedSkillModel;
          try { prepared = await (ports.prepareModel ?? ((s, signal) => prepareFrozenSkillModel(s, signal, { beforeDispatch: () => check('model') })))(structuredClone(skill), controller.signal); }
          catch { deadlineGuard(); return fail('MODEL_PREPARATION_FAILED'); }
          await check('model');
          if (!prepared || typeof prepared.complete !== 'function' || !safeId(prepared.transportProvider) || !safeId(skill.context.model.providerId) || !safeId(skill.context.model.model)) fail('INVALID_PROVIDER_METADATA');
          let response: SkillModelResponse;
          try { response = await modelBound(async () => {
            deadlineGuard(); usage.modelAttempts++;
            return prepared.complete({ instructions: definition.instructions, input: structuredClone(input), outputSchema: structuredClone(definition.outputSchema),
              model: { ...definition.model, maxTokens: tokens, timeoutMs: Math.min(definition.model.timeoutMs, remaining()) }, tools: structuredClone(tools), toolResults: structuredClone(toolResults), signal: controller.signal });
          }, Math.min(definition.model.timeoutMs, remaining()), definition.model.timeoutMs < remaining() ? 'MODEL_TIMEOUT' : 'TOTAL_TIMEOUT'); }
          catch (error) { deadlineGuard(); if (error instanceof Failure) throw error; return fail('MODEL_REQUEST_FAILED'); }
          deadlineGuard();
          if (!response || !Number.isSafeInteger(response.usage?.outputTokens) || response.usage.outputTokens < 1) fail('INVALID_MODEL_USAGE');
          usage.outputTokens += response.usage.outputTokens;
          if (response.usage.outputTokens > tokens || usage.outputTokens > budgets.maxOutputTokens) fail('OUTPUT_TOKEN_LIMIT');
          if (!safeId(response.provider) || !safeId(response.model) || response.provider !== prepared.transportProvider || response.model !== skill.context.model.model) fail('INVALID_PROVIDER_METADATA');
          model = { providerId: skill.context.model.providerId, model: skill.context.model.model, transportProvider: response.provider };
          const calls = response.toolCalls === undefined ? [] : response.toolCalls;
          if (!Array.isArray(calls) || calls.length > 100 || (calls.length && Object.prototype.hasOwnProperty.call(response, 'output'))) fail('INVALID_MODEL_RESPONSE');
          if (!calls.length) {
            if (!Object.prototype.hasOwnProperty.call(response, 'output')) fail('MODEL_OUTPUT_REQUIRED');
            const output = json(response.output); if (!outputValidator(output)) fail('OUTPUT_SCHEMA_FAILED'); deadlineGuard(); return output;
          }
          if (calls.length + usage.toolCalls > budgets.maxToolCalls) fail('TOOL_CALL_LIMIT');
          const batchSeen = new Set(seen);
          const batch = calls.map(call => {
            if (!call || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(call.id) || batchSeen.has(call.id) || typeof call.name !== 'string') fail('INVALID_OR_REPEATED_TOOL_CALL');
            batchSeen.add(call.id);
            const binding = definition.tools.find(t => t.toolName === call.name); const snapshot = skill.context.tools.find(t => t.native.name === call.name);
            if (!binding || !snapshot) fail('TOOL_NOT_ALLOWED');
            const parameters = json(call.arguments);
            if (!validators.get(call.name)!(parameters)) fail('NATIVE_PARAMETERS_INVALID');
            const mapped: Record<string, unknown> = Object.create(null);
            for (const [key, path] of Object.entries(binding.inputMapping)) { const value = readSkillPath(input, path); if (value !== undefined) mapped[key] = value; }
            if (!isDeepStrictEqual(parameters, { ...mapped })) fail('TOOL_MAPPING_MISMATCH');
            if ((snapshot.native.mutates || snapshot.native.exfiltrates) && !binding.requiresConfirmation) fail('TOOL_SNAPSHOT_DENIED');
            return { binding, snapshot, call: { id: call.id, name: call.name, arguments: parameters } };
          });
          for (const entry of batch) {
            await check('tool', entry.call.name);
            if (entry.binding.requiresConfirmation || entry.snapshot.policy.approvalStrategy === 'user-confirm' || entry.snapshot.native.mutates || entry.snapshot.native.exfiltrates || entry.snapshot.native.source === 'mcp') fail('EXECUTION_AUTHORITY_DENIED');
            deadlineGuard(); if (!ports.toolGate) fail('TOOL_GATE_UNAVAILABLE');
            seen.add(entry.call.id); usage.toolCalls++;
            let result: unknown;
            try { result = await ports.toolGate({ caller: structuredClone(manifest.caller), stepId: skill.stepId, skillId: skill.skillId, versionId: skill.versionId,
              binding: structuredClone(entry.binding), snapshot: structuredClone(entry.snapshot), call: structuredClone(entry.call), input: structuredClone(input), signal: controller.signal }); }
            catch { deadlineGuard(); return fail('TOOL_GATE_FAILED'); }
            deadlineGuard(); const output = json(result), validate = compileNativeToolOutput(entry.snapshot.native);
            if (validate && !validate(output)) fail('NATIVE_OUTPUT_SCHEMA_FAILED');
            toolResults.push({ callId: entry.call.id, toolName: entry.call.name, arguments: entry.call.arguments, simulated: false, result: output });
          }
        }
      };
      const output = await Promise.race([aborted, Promise.resolve().then(core)]); deadlineGuard();
      return { status: 'succeeded', output, model, usage: { ...usage, elapsedMs: Math.ceil(performance.now() - started) } };
    } catch (error) {
      const code = controller.signal.aborted ? reason : error instanceof Failure ? error.code : 'EXECUTION_FAILED';
      return { status: code === 'CANCELLED' ? 'cancelled' : 'failed', code, ...(model ? { model } : {}), usage: { ...usage, elapsedMs: Math.ceil(performance.now() - started) } };
    } finally {
      terminal = true; if (totalTimer) clearTimeout(totalTimer); request.signal.removeEventListener('abort', onAbort); controller.abort();
    }
  } };
}
