import type { SkillToolStep } from './skills.sandbox';
/** Server-owned cursor. Only a persisted, locked run checkpoint may supply this value. */
export type SkillExecutionState = {
  schemaVersion: 1; runId: string; ownerUserId: string; manifestHash: string; stepId: string;
  operationId: string; iteration: number; inputHash: string;
  phase: 'model' | 'tools' | 'completed';
  toolResults: SkillToolStep[]; seenCallIds: string[];
  pendingBatch: Array<{ ordinal: number; callId: string; name: string; arguments: unknown }>;
  nextToolIndex: number;
  usage: { modelAttempts: number; outputTokens: number };
  model?: { providerId: string; model: string; transportProvider: string };
  output?: unknown;
};

import { isDeepStrictEqual } from 'node:util';
import { copyTrialJson, type SkillToolCall } from './skills.sandbox';
export type SkillExecutionStateBinding = Pick<SkillExecutionState, 'runId' | 'ownerUserId' | 'manifestHash' | 'stepId' | 'operationId' | 'iteration' | 'inputHash'>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, required: string[], optional: string[] = []) => object(value)
  && required.every(key => own(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
export const safeSkillMetadata = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) && !/(sk-|bearer|api[-_]?key|token|secret)/i.test(value);
/** Corruption detection only: the caller must load this cursor from a locked server checkpoint. */
export function readSkillExecutionState(value: unknown, binding: SkillExecutionStateBinding, model: { providerId: string; model: string; maxTokens: number },
  validateCall: (call: SkillToolCall) => unknown, validateOutput: (output: unknown) => boolean): SkillExecutionState {
  const invalid = (): never => { throw new Error('EXECUTION_STATE_INVALID'); };
  try {
    const state = copyTrialJson(value) as SkillExecutionState;
    if (!isDeepStrictEqual(value, state) || !exact(state, ['schemaVersion', ...Object.keys(binding), 'phase', 'toolResults', 'seenCallIds', 'pendingBatch', 'nextToolIndex', 'usage', 'model'], ['output'])
      || state.schemaVersion !== 1 || Object.entries(binding).some(([key, expected]) => (state as unknown as Record<string, unknown>)[key] !== expected)
      || !['model', 'tools', 'completed'].includes(state.phase) || !Array.isArray(state.toolResults) || !Array.isArray(state.pendingBatch) || !Array.isArray(state.seenCallIds)
      || state.toolResults.length > 60 || state.pendingBatch.length > 60 || !Number.isSafeInteger(state.nextToolIndex) || state.nextToolIndex < 0
      || !exact(state.usage, ['modelAttempts', 'outputTokens']) || !Number.isSafeInteger(state.usage.modelAttempts) || state.usage.modelAttempts < 1 || state.usage.modelAttempts > 60
      || !Number.isSafeInteger(state.usage.outputTokens) || state.usage.outputTokens < state.usage.modelAttempts || state.usage.outputTokens > state.usage.modelAttempts * model.maxTokens
      || !exact(state.model, ['providerId', 'model', 'transportProvider']) || state.model?.providerId !== model.providerId || state.model?.model !== model.model
      || !safeSkillMetadata(state.model!.transportProvider)) invalid();
    if (state.phase === 'tools' ? state.pendingBatch.length === 0 || state.nextToolIndex >= state.pendingBatch.length
      : state.pendingBatch.length !== 0 || state.nextToolIndex !== 0) invalid();
    if (state.phase === 'completed' ? !own(state, 'output') || !validateOutput(state.output) : own(state, 'output')) invalid();
    const baseOrdinal = state.toolResults.length - state.nextToolIndex;
    if (baseOrdinal < 0 || state.toolResults.length + state.pendingBatch.length - state.nextToolIndex > 60) invalid();
    for (const result of state.toolResults) {
      if (!exact(result, ['callId', 'toolName', 'arguments', 'simulated', 'result']) || result.simulated !== false) invalid();
      validateCall({ id: result.callId, name: result.toolName, arguments: result.arguments });
    }
    state.pendingBatch.forEach((entry, index) => {
      if (!exact(entry, ['ordinal', 'callId', 'name', 'arguments']) || entry.ordinal !== baseOrdinal + index) invalid();
      validateCall({ id: entry.callId, name: entry.name, arguments: entry.arguments });
      if (index < state.nextToolIndex) {
        const result = state.toolResults[baseOrdinal + index];
        if (!result || result.callId !== entry.callId || result.toolName !== entry.name || !isDeepStrictEqual(result.arguments, entry.arguments)) invalid();
      }
    });
    const ids = [...state.toolResults.map(result => result.callId), ...state.pendingBatch.slice(state.nextToolIndex).map(entry => entry.callId)];
    if (new Set(ids).size !== ids.length || !isDeepStrictEqual(ids, state.seenCallIds)) invalid();
    return state;
  } catch { return invalid(); }
}
