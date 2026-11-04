import { isDeepStrictEqual } from 'node:util';
import { copyTrialJson, skillPathParts } from '../skills/skills.module';
import type { WorkflowMapping, WorkflowPredicate } from '../workflows/workflows.module';
export const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function reject(code: string): never { throw new Error(`WORKFLOW_RUNTIME_${code}`); }
export function copy<T>(value: T, code: string): T {
  try { return copyTrialJson(value, 'definition') as T; } catch { return reject(code); }
}
export function exact(value: Record<string, unknown>, keys: string[], code: string): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !own(value, key))) reject(code);
}
export type WorkflowValues = { input: unknown; steps: Record<string, { output: unknown }> };
function source(context: WorkflowValues, path: string): { exists: boolean; value?: unknown } {
  let parts: string[];
  try { parts = skillPathParts(path); } catch { return reject('INVALID_VALUES'); }
  if (!((parts[0] === 'input' && parts.length >= 2) || (parts[0] === 'steps' && parts[2] === 'output' && parts.length >= 3))) reject('INVALID_VALUES');
  let value: unknown = context;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !own(value, part)) return { exists: false };
    value = (value as Record<string, unknown>)[part];
  }
  return { exists: true, value };
}
export function mapValues(items: WorkflowMapping[], context: WorkflowValues): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const item of items) {
    if (item.source.kind === 'literal') mapped[item.target] = copy(item.source.value, 'INVALID_VALUES');
    else {
      const found = source(context, item.source.path);
      if (!found.exists && !own(item.source, 'fallback')) reject('INVALID_VALUES');
      mapped[item.target] = copy(found.exists ? found.value : item.source.fallback, 'INVALID_VALUES');
    }
  }
  return mapped;
}
export function predicates(items: WorkflowPredicate[] | undefined, context: WorkflowValues): boolean {
  // Evaluate all declared predicates so a missing required comparison never becomes a silent jump.
  return (items ?? []).map(item => {
    const found = source(context, item.path);
    if (item.op === 'exists') return found.exists;
    if (!found.exists || !own(item, 'value')) return reject('INVALID_VALUES');
    if (item.op === 'eq') return isDeepStrictEqual(found.value, item.value);
    if (item.op === 'neq') return !isDeepStrictEqual(found.value, item.value);
    if (item.op === 'in') {
      if (!Array.isArray(item.value)) return reject('INVALID_VALUES');
      return item.value.some(value => isDeepStrictEqual(found.value, value));
    }
    if (typeof found.value !== 'number' || !Number.isFinite(found.value) || typeof item.value !== 'number' || !Number.isFinite(item.value)) return reject('INVALID_VALUES');
    switch (item.op) {
      case 'gt': return found.value > item.value;
      case 'gte': return found.value >= item.value;
      case 'lt': return found.value < item.value;
      case 'lte': return found.value <= item.value;
      default: return reject('INVALID_VALUES');
    }
  }).every(Boolean);
}
export const equalJson = isDeepStrictEqual;
