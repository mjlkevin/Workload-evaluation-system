import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { skillDefinitionHash } from './skills.hash';
import type { SkillAssertion, SkillDefinition } from './skills.types';
import type { SkillToolDefinition } from './skills.validation';
import { copyTrialJson, createSkillSandbox, readSkillPath, SkillTrialFailure, type SkillReadExecutor, type SkillToolCall, type SkillToolStep } from './skills.sandbox';

export type SkillTrialBudgets = { maxModelAttempts: number; maxToolCalls: number; maxOutputTokens: number; totalTimeoutMs: number };
export type SkillModelRequest = {
  instructions: string; input: unknown; outputSchema: Record<string, unknown>; model: SkillDefinition['model'];
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  toolResults: SkillToolStep[]; signal: AbortSignal;
};
export type SkillModelResponse = { output?: unknown; toolCalls?: SkillToolCall[]; provider: string; model: string; usage: { outputTokens: number } };
/** Only server wiring chooses mode/adapters; client callbacks are never accepted as model evidence. */
export type SkillTrialDependencies = {
  mode: 'model' | 'simulation'; allowedTools: SkillToolDefinition[];
  complete: (request: SkillModelRequest) => Promise<SkillModelResponse>; runReadTool?: SkillReadExecutor;
};
export type SkillTrialIssue = { category: SkillTrialFailure['category']; code: string };
export type SkillCaseResult = {
  title: string; definitionHash: string; passed: boolean; output?: unknown; failures: SkillTrialIssue[];
  providers: Array<{ provider: string; model: string }>; toolSteps: SkillToolStep[];
};
export type SkillTrialResult = {
  definitionHash: string; mode: 'model' | 'simulation'; modelExecuted: boolean; passed: boolean; releaseEligible: boolean;
  releaseReason: 'MODEL_TRIAL_PASSED' | 'MODEL_TRIAL_PASSED_WITH_ISOLATED_TOOLS' | 'SIMULATION_ONLY' | 'TRIAL_FAILED';
  cases: SkillCaseResult[]; failures: SkillTrialIssue[]; simulatedSteps: SkillToolStep[];
  usage: { modelAttempts: number; toolCalls: number; outputTokens: number; elapsedMs: number };
};
const defaults: SkillTrialBudgets = { maxModelAttempts: 60, maxToolCalls: 60, maxOutputTokens: 128000, totalTimeoutMs: 300000 };
const safeIssueCodes: Record<SkillTrialIssue['category'], readonly string[]> = {
  definition: ['INVALID_OR_OVERSIZED_JSON', 'INVALID_TRIAL_MODE', 'SAMPLES_REQUIRED'],
  structure: ['INPUT_SCHEMA_FAILED', 'OUTPUT_SCHEMA_FAILED'],
  assertion: ['BUSINESS_ASSERTION_FAILED'],
  budget: ['INVALID_BUDGET', 'TOTAL_TIMEOUT', 'MODEL_ATTEMPT_LIMIT', 'OUTPUT_TOKEN_LIMIT', 'TOOL_CALL_LIMIT'],
  tool: ['INVALID_OR_OVERSIZED_JSON', 'TOOL_NOT_ALLOWED', 'NATIVE_PARAMETERS_INVALID', 'TOOL_MAPPING_MISMATCH', 'READ_EXECUTOR_UNAVAILABLE', 'READ_TOOL_FAILED', 'INVALID_OR_REPEATED_TOOL_CALL'],
  provider: ['INVALID_OR_OVERSIZED_JSON', 'INVALID_PROVIDER_METADATA', 'MODEL_REQUEST_FAILED', 'INVALID_MODEL_USAGE', 'INVALID_MODEL_RESPONSE', 'MODEL_OUTPUT_REQUIRED'],
};
function issue(error: unknown, fallback: SkillTrialIssue['category']): SkillTrialIssue {
  // Never echo arbitrary error fields, including instances manufactured by adapters.
  return error instanceof SkillTrialFailure && safeIssueCodes[error.category]?.includes(error.code)
    ? { category: error.category, code: error.code } : { category: fallback, code: `${fallback.toUpperCase()}_FAILED` };
}
function assertBudgets(budgets: SkillTrialBudgets): void {
  for (const [key, max] of Object.entries(defaults)) {
    const value = budgets[key as keyof SkillTrialBudgets];
    if (!Number.isInteger(value) || value < (key === 'maxToolCalls' ? 0 : 1) || value > max) throw new SkillTrialFailure('budget', 'INVALID_BUDGET');
  }
}
/** Race even adapters that ignore AbortSignal, while signalling cancellation to real I/O. */
async function bounded<T>(callback: (signal: AbortSignal) => Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  if (timeoutMs <= 0) throw new SkillTrialFailure('budget', 'TOTAL_TIMEOUT');
  const deadline = performance.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      new Promise<T>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SkillTrialFailure('budget', 'TOTAL_TIMEOUT')); }, timeoutMs); }),
      Promise.resolve().then(() => callback(controller.signal)),
    ]);
    if (performance.now() >= deadline) { controller.abort(); throw new SkillTrialFailure('budget', 'TOTAL_TIMEOUT'); }
    return value;
  } catch (error) {
    if (performance.now() >= deadline) { controller.abort(); throw new SkillTrialFailure('budget', 'TOTAL_TIMEOUT'); }
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}
function assertionPasses(output: unknown, assertion: SkillAssertion): boolean {
  const value = readSkillPath(output, assertion.path);
  switch (assertion.op) {
    case 'exists': return value !== undefined;
    case 'equals': return isDeepStrictEqual(value, assertion.value);
    case 'minItems': return Array.isArray(value) && value.length >= (assertion.value as number);
    case 'contains': return typeof value === 'string' && typeof assertion.value === 'string' ? value.includes(assertion.value) : Array.isArray(value) && value.some(item => isDeepStrictEqual(item, assertion.value));
  }
}
function safeMetadata(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(value) || /(?:sk-|bearer|api[-_]?key|token|secret)/i.test(value)) throw new SkillTrialFailure('provider', 'INVALID_PROVIDER_METADATA');
  return value;
}

/** No persistence, routes, real write executors or implicit provider dependencies. */
export async function evaluateSkill(value: unknown, dependencies: SkillTrialDependencies, overrides: Partial<SkillTrialBudgets> = {}): Promise<SkillTrialResult> {
  const started = performance.now();
  const { mode, complete, allowedTools, runReadTool } = dependencies;
  const controllers = new Set<AbortController>();
  const result: SkillTrialResult = {
    definitionHash: '', mode, modelExecuted: false, passed: false, releaseEligible: false, releaseReason: 'TRIAL_FAILED',
    cases: [], failures: [], simulatedSteps: [], usage: { modelAttempts: 0, toolCalls: 0, outputTokens: 0, elapsedMs: 0 },
  };
  const budgets = { ...defaults, ...overrides };
  const remaining = () => budgets.totalTimeoutMs - (performance.now() - started);
  const guardDeadline = () => {
    if (remaining() <= 0) {
      for (const controller of controllers) controller.abort();
      throw new SkillTrialFailure('budget', 'TOTAL_TIMEOUT');
    }
  };
  try {
    result.definitionHash = skillDefinitionHash(copyTrialJson(value, 'definition'));
    assertBudgets(budgets);
    if (!['model', 'simulation'].includes(mode)) throw new SkillTrialFailure('definition', 'INVALID_TRIAL_MODE');
    const sandbox = createSkillSandbox(value, allowedTools, runReadTool);
    const definition = sandbox.definition;
    result.definitionHash = skillDefinitionHash(definition);
    if (!definition.examples.length) throw new SkillTrialFailure('definition', 'SAMPLES_REQUIRED');
    guardDeadline();
    for (const example of definition.examples) {
      const item: SkillCaseResult = { title: example.title, definitionHash: result.definitionHash, passed: false, failures: [], providers: [], toolSteps: [] };
      result.cases.push(item);
      try {
        sandbox.validateInput(example.input); guardDeadline();
        const seenCalls = new Set<string>();
        while (true) {
          guardDeadline();
          if (result.usage.modelAttempts >= budgets.maxModelAttempts) throw new SkillTrialFailure('budget', 'MODEL_ATTEMPT_LIMIT');
          const tokens = Math.min(definition.model.maxTokens, budgets.maxOutputTokens - result.usage.outputTokens);
          if (tokens <= 0) throw new SkillTrialFailure('budget', 'OUTPUT_TOKEN_LIMIT');
          result.usage.modelAttempts++;
          const controller = new AbortController(); controllers.add(controller);
          let response: SkillModelResponse;
          try {
            response = await bounded(async signal => {
              if (mode === 'model') result.modelExecuted = true;
              try { return await complete({
              instructions: definition.instructions, input: structuredClone(example.input), outputSchema: structuredClone(definition.outputSchema),
              model: { ...definition.model, maxTokens: tokens, timeoutMs: Math.min(definition.model.timeoutMs, remaining()) },
              tools: structuredClone(sandbox.tools), toolResults: structuredClone(item.toolSteps), signal,
              }); } catch { throw new SkillTrialFailure('provider', 'MODEL_REQUEST_FAILED'); }
            }, Math.min(definition.model.timeoutMs, remaining()), controller);
          } catch (error) { throw error instanceof SkillTrialFailure ? error : new SkillTrialFailure('provider', 'MODEL_REQUEST_FAILED'); }
          guardDeadline();
          if (!response || !Number.isInteger(response.usage?.outputTokens) || response.usage.outputTokens < 1) throw new SkillTrialFailure('provider', 'INVALID_MODEL_USAGE');
          result.usage.outputTokens += response.usage.outputTokens;
          if (response.usage.outputTokens > tokens || result.usage.outputTokens > budgets.maxOutputTokens) throw new SkillTrialFailure('budget', 'OUTPUT_TOKEN_LIMIT');
          const metadata = { provider: safeMetadata(response.provider), model: safeMetadata(response.model) };
          if (!item.providers.some(p => p.model === metadata.model && p.provider === metadata.provider)) item.providers.push(metadata);
          const calls = response.toolCalls === undefined ? [] : response.toolCalls;
          if (!Array.isArray(calls) || calls.length > 100 || (calls.length && Object.prototype.hasOwnProperty.call(response, 'output'))) throw new SkillTrialFailure('provider', 'INVALID_MODEL_RESPONSE');
          if (calls.length) {
            if (calls.length + result.usage.toolCalls > budgets.maxToolCalls) throw new SkillTrialFailure('budget', 'TOOL_CALL_LIMIT');
            for (const call of calls) {
              if (!call || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(call.id) || seenCalls.has(call.id) || typeof call.name !== 'string') throw new SkillTrialFailure('tool', 'INVALID_OR_REPEATED_TOOL_CALL');
              seenCalls.add(call.id); result.usage.toolCalls++;
              const toolController = new AbortController(); controllers.add(toolController);
              const step = await bounded(signal => sandbox.runTool(call, example.input, signal), remaining(), toolController);
              item.toolSteps.push(step);
              if (step.simulated) result.simulatedSteps.push(structuredClone(step));
            }
            continue;
          }
          if (!Object.prototype.hasOwnProperty.call(response, 'output')) throw new SkillTrialFailure('provider', 'MODEL_OUTPUT_REQUIRED');
          item.output = copyTrialJson(response.output);
          sandbox.validateOutput(item.output);
          const passed = example.assertions ? example.assertions.every(a => assertionPasses(item.output, a)) : isDeepStrictEqual(item.output, example.expected);
          guardDeadline();
          if (!passed) throw new SkillTrialFailure('assertion', 'BUSINESS_ASSERTION_FAILED');
          item.passed = true; break;
        }
      } catch (error) {
        try { guardDeadline(); } catch (timeout) { error = timeout; }
        item.failures.push(issue(error, 'provider'));
      }
    }
    guardDeadline();
    result.passed = result.cases.length > 0 && result.cases.every(item => item.passed);
    result.releaseEligible = result.passed && mode === 'model' && result.modelExecuted;
    result.releaseReason = !result.passed ? 'TRIAL_FAILED' : mode === 'simulation' ? 'SIMULATION_ONLY' : result.simulatedSteps.length ? 'MODEL_TRIAL_PASSED_WITH_ISOLATED_TOOLS' : 'MODEL_TRIAL_PASSED';
  } catch (error) { result.failures.push(issue(error, 'definition')); }
  result.usage.elapsedMs = Math.ceil(performance.now() - started);
  return result;
}
