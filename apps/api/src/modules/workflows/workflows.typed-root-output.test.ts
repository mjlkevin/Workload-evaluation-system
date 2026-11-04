import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorkflowDefinition } from './workflows.validation';
import { mapValues } from '../harness/workflows.runtime-values';
import type { WorkflowDefinition, WorkflowValidationContext } from './workflows.types';
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const payload = object({ text: { type: 'string', minLength: 1 } }), empty = object({});
const binding = { target: 'value', source: { kind: 'path' as const, path: '$.steps.produce.output' } };
function fixture() {
 const definition: WorkflowDefinition = { name: 'Typed whole-output composition', description: '', category: 'test', roles: ['delivery'],
  inputSchema: empty, outputSchema: object({ value: payload }),
  steps: [{ id: 'produce', name: 'Produce', type: 'tool', toolName: 'read', requiresConfirmation: false, inputMapping: [], onFailure: 'fail' }], outputMapping: [binding] };
 const context: WorkflowValidationContext = { skills: [], tools: [{ name: 'read', description: '', parameters: empty, outputSchema: payload,
  source: 'code', mutates: false, requiresConfirmation: false }] };
 return { definition, context };
}
const denied = (reason: string) => (error: any) => error.details?.some((d: any) => d.reason === reason);
test('frozen native typed root output composes as a nested object and runtime returns an independent copy', () => {
 const { definition, context } = fixture(); assert.deepEqual(validateWorkflowDefinition(definition, context), definition);
 const original = { text: 'Actual output' }, result = mapValues(definition.outputMapping, { input: {}, steps: { produce: { output: original } } });
 assert.deepEqual(result, { value: original }); (result.value as any).text = 'Changed'; assert.equal(original.text, 'Actual output');
});
test('published Skill and human output roots use their existing explicit typed contracts', () => {
 for (const kind of ['skill', 'userInput'] as const) {
  const { definition, context } = fixture(); context.tools = [];
  if (kind === 'skill') {
   definition.steps = [{ id: 'produce', name: 'Produce', type: 'skill', skillId: 'skill', skillVersionId: 'version', inputMapping: [], onFailure: 'fail' }];
   context.skills = [{ stepId: 'produce', skillId: 'skill', skillVersionId: 'version', hash: 'hash', enabled: true, archived: false, status: 'published',
    definition: { roles: ['delivery'], inputSchema: empty, outputSchema: payload } }];
  } else definition.steps = [{ id: 'produce', name: 'Produce', type: 'userInput', prompt: 'Answer', inputSchema: empty, outputSchema: payload, inputMapping: [], onFailure: 'fail' }];
  assert.deepEqual(validateWorkflowDefinition(definition, context), definition);
 }
});
test('opaque or missing producer output contracts still reject whole-output mappings', () => {
 const { definition, context } = fixture(); delete context.tools[0].outputSchema;
 assert.throws(() => validateWorkflowDefinition(definition, context), denied('tool_output_contract_unavailable'));
});
test('unknown whole-output references and incompatible nested targets fail with their actual contract reasons', () => {
 const { definition, context } = fixture(); definition.outputMapping[0] = { ...binding, source: { kind: 'path', path: '$.steps.missing.output' } };
 assert.throws(() => validateWorkflowDefinition(definition, context), denied('forward_or_missing_step_reference'));
 definition.outputMapping[0] = binding; definition.outputSchema = object({ value: object({ text: { type: 'number' } }) });
 assert.throws(() => validateWorkflowDefinition(definition, context), denied('source_does_not_fit_target'));
});
test('branch availability still requires a complete valid fallback for a skipped whole-output source', () => {
 const { definition, context } = fixture(); definition.steps[0].prerequisite = [{ path: '$.input.flag', op: 'eq', value: true }];
 definition.inputSchema = object({ flag: { type: 'boolean' } });
 assert.throws(() => validateWorkflowDefinition(definition, context), denied('optional_or_skipped_source_needs_valid_fallback'));
 definition.outputMapping[0] = { ...binding, source: { ...binding.source, fallback: { text: 'Skipped' } } };
 validateWorkflowDefinition(definition, context);
 assert.deepEqual(mapValues(definition.outputMapping, { input: {}, steps: {} }), { value: { text: 'Skipped' } });
});
test('untyped entire input roots remain unsupported in validation and runtime', () => {
 const { definition, context } = fixture(); definition.outputMapping[0] = { ...binding, source: { kind: 'path', path: '$.input' } };
 assert.throws(() => validateWorkflowDefinition(definition, context));
 assert.throws(() => mapValues(definition.outputMapping, { input: { text: 'Input root' }, steps: {} }), /INVALID_VALUES/);
});
