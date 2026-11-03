import { createProjectEvaluationInTransaction } from '../project-evaluations/project-evaluation-transaction';
import type { SkillLocalTransactionAdapter } from './skills.operation-execution';
import { SkillError } from './skills.types';

const invalid = (): never => { throw new SkillError('OPERATION_PARAMETERS_INVALID', '项目参数无效', 400); };
function projectParameters(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, string> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !['projectName', 'customerName', 'industry'].includes(key)) return invalid();
    const d = descriptors[key];
    if (d.get || d.set || !d.enumerable || typeof d.value !== 'string') return invalid();
    result[key] = d.value.trim();
  }
  if (!result.projectName) return invalid();
  return result;
}
/** Explicit opt-in whitelist. Constructing this map does not grant ToolGate authority. */
export function createSkillLocalTransactionAdapters(): ReadonlyMap<string, SkillLocalTransactionAdapter> {
  return new Map([['create_project', { kind: 'local-transaction', async execute(tx, input) {
    const parameters = projectParameters(input.parameters);
    const project = await createProjectEvaluationInTransaction(tx, input.ownerId, { ...parameters, createdFromSessionId: input.sessionId });
    // The public mapper includes absent optional fields; receipts require exact JSON.
    return Object.fromEntries(Object.entries(project).filter(([, value]) => value !== undefined));
  } }]]);
}
