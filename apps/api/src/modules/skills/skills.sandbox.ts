import Ajv from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { SkillError } from './skills.types';
import { compileNativeToolOutput, compileSkillPayloadSchema, skillPathParts, validateSkillDefinition, type SkillToolDefinition } from './skills.validation';

export type SkillToolCall = { id: string; name: string; arguments: unknown };
export type SkillToolStep = { callId: string; toolName: string; arguments: unknown; simulated: boolean; result: unknown };
export type SkillReadExecutor = (name: string, parameters: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export class SkillTrialFailure extends Error {
  constructor(public category: 'definition' | 'structure' | 'assertion' | 'budget' | 'tool' | 'provider', public code: string) { super(code); }
}
export function readSkillPath(value: unknown, path: string): unknown {
  let result = value;
  for (const key of skillPathParts(path)) {
    if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, key)) return undefined;
    result = (result as Record<string, unknown>)[key];
  }
  return result;
}
/** Bound all provider/tool payloads and copy them before they can enter evidence or prompts. */
export function copyTrialJson(value: unknown, category: 'provider' | 'tool' | 'definition' = 'provider'): unknown {
  try {
    const visit = (item: unknown, depth: number): void => {
      if (depth > 32 || item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) throw new Error();
      if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error();
        visit(child, depth + 1);
      }
    };
    visit(value, 0);
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 1024 * 1024) throw new Error();
    return JSON.parse(json);
  } catch { throw new SkillTrialFailure(category, 'INVALID_OR_OVERSIZED_JSON'); }
}

/** The same validated definition, schemas and native mappings serve trials and future invocation. */
export function createSkillSandbox(value: unknown, allowedTools: SkillToolDefinition[], runReadTool?: SkillReadExecutor) {
  const nativeTools = structuredClone(allowedTools);
  const definition = validateSkillDefinition(value, nativeTools);
  const input = compileSkillPayloadSchema(definition.inputSchema, 'inputSchema');
  const output = compileSkillPayloadSchema(definition.outputSchema, 'outputSchema');
  const compiler = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false });
  const validators = new Map(definition.tools.map(binding => {
    const tool = nativeTools.find(t => t.name === binding.toolName)!;
    return [tool.name, compiler.compile(tool.parameters)] as const;
  }));
  function validateInput(value: unknown) {
    if (!input(value)) throw new SkillTrialFailure('structure', 'INPUT_SCHEMA_FAILED');
  }
  function validateOutput(value: unknown) {
    if (!output(value)) throw new SkillTrialFailure('structure', 'OUTPUT_SCHEMA_FAILED');
  }
  return {
    definition,
    tools: definition.tools.map(binding => {
      const tool = nativeTools.find(t => t.name === binding.toolName)!;
      return { name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters) };
    }),
    validateInput, validateOutput,
    async runTool(call: SkillToolCall, inputValue: unknown, signal: AbortSignal): Promise<SkillToolStep> {
      validateInput(inputValue);
      const binding = definition.tools.find(b => b.toolName === call.name);
      const native = nativeTools.find(t => t.name === call.name);
      if (!binding || !native) throw new SkillTrialFailure('tool', 'TOOL_NOT_ALLOWED');
      const parameters = copyTrialJson(call.arguments, 'tool');
      if (!validators.get(call.name)!(parameters)) throw new SkillTrialFailure('tool', 'NATIVE_PARAMETERS_INVALID');
      const mapped: Record<string, unknown> = {};
      for (const [key, path] of Object.entries(binding.inputMapping)) {
        const value = readSkillPath(inputValue, path);
        if (value !== undefined) mapped[key] = value;
      }
      if (!isDeepStrictEqual(parameters, mapped)) throw new SkillTrialFailure('tool', 'TOOL_MAPPING_MISMATCH');
      if (signal.aborted) throw new SkillTrialFailure('budget', 'TOTAL_TIMEOUT');
      const step = { callId: call.id, toolName: call.name, arguments: parameters, simulated: native.mutates || !!native.exfiltrates || !!native.simulationOnly };
      if (step.simulated) {
        if ((native.mutates || native.exfiltrates) && !binding.requiresConfirmation) throw new SkillError('SKILL_INVALID_DEFINITION', '工具确认规则无效');
        return { ...step, result: { dryRun: true, executed: false, reason: native.exfiltrates ? 'exfiltration_isolated' : native.mutates ? 'mutation_isolated' : 'unverified_or_remote_read_isolated' } };
      }
      if (!runReadTool) throw new SkillTrialFailure('tool', 'READ_EXECUTOR_UNAVAILABLE');
      let toolOutput: unknown;
      try { toolOutput = await runReadTool(call.name, structuredClone(parameters) as Record<string, unknown>, signal); }
      catch { throw new SkillTrialFailure('tool', 'READ_TOOL_FAILED'); }
      const validate = compileNativeToolOutput(native);
      if (validate && !validate(toolOutput)) throw new SkillTrialFailure('tool', 'NATIVE_OUTPUT_SCHEMA_FAILED');
      return { ...step, result: copyTrialJson(toolOutput, 'tool') };
    },
  };
}
