import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorkflowDefinition } from './workflows.validation';
import type { WorkflowDefinition, WorkflowValidationContext, WorkflowPredicate } from './workflows.types';
const payload = { type: 'object', additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 20 } }, required: ['text'] };
export const exampleWorkflow: WorkflowDefinition = { name: '交付评审', description: '', category: 'delivery', roles: ['delivery'], inputSchema: payload, outputSchema: payload,
    steps: [{ id: 'review', name: '评审', type: 'skill', skillId: 'skill-1', skillVersionId: 'version-1', inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'wait' }],
    outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.review.output.text' } }] };
export const context: WorkflowValidationContext = { skills: [{ stepId: 'review', skillId: 'skill-1', skillVersionId: 'version-1', hash: 'skillhash', enabled: true, archived: false, status: 'published', definition: { roles: ['delivery'], inputSchema: payload, outputSchema: payload } }], tools: [] };
const invalid = (value: unknown, ctx = context) => assert.throws(() => validateWorkflowDefinition(value, ctx));
test('workflow accepts exact published Skill contracts and preserves canonical definition', () => assert.deepEqual(validateWorkflowDefinition(exampleWorkflow, context), exampleWorkflow));
test('workflow rejects missing/draft/disabled/archived dependencies and role broadening', () => {
    invalid(exampleWorkflow, { ...context, skills: [] });
    for (const change of [{ status: 'draft' }, { enabled: false }, { archived: true }, { skillVersionId: 'latest' }])
        invalid(exampleWorkflow, { ...context, skills: [{ ...context.skills[0], ...change }] });
    invalid({ ...exampleWorkflow, roles: ['admin'] });
});
test('mapping proves requiredness, enum/range/nested required and valid fallback', () => {
    const optional = structuredClone(exampleWorkflow);
    optional.inputSchema = { ...payload, required: [] };
    invalid(optional);
    optional.steps[0].inputMapping[0].source = { kind: 'path', path: '$.input.text', fallback: 'ok' };
    validateWorkflowDefinition(optional, context);
    optional.steps[0].inputMapping[0].source = { kind: 'path', path: '$.input.text', fallback: 5 };
    invalid(optional);
    const constrained = structuredClone(context);
    constrained.skills[0].definition.inputSchema = { ...payload, properties: { text: { type: 'string', enum: ['ok'] } } };
    invalid(exampleWorkflow, constrained);
    const numbers = structuredClone(exampleWorkflow);
    numbers.inputSchema = { ...payload, properties: { text: { type: 'integer', minimum: 0, maximum: 10 } } };
    constrained.skills[0].definition.inputSchema = { ...numbers.inputSchema, properties: { text: { type: 'number', minimum: 1, maximum: 5 } } };
    invalid(numbers, constrained);
    const nested = structuredClone(exampleWorkflow);
    nested.inputSchema = { ...payload, properties: { text: { type: 'object', properties: { must: { type: 'string' } }, additionalProperties: false } } };
    constrained.skills[0].definition.inputSchema = { ...nested.inputSchema, properties: { text: { ...{ type: 'object', properties: { must: { type: 'string' } }, additionalProperties: false }, required: ['must'] } } };
    invalid(nested, constrained);
});
test('reject duplicate IDs, orphan targets, unsafe/executable paths and unsupported fields', () => {
    invalid({ ...exampleWorkflow, steps: [exampleWorkflow.steps[0], exampleWorkflow.steps[0]] });
    for (const path of ['$.input.__proto__.x', '$.input.text[0]', '$.input.*', 'eval(1)', '$.steps.future.output.text']) {
        const value = structuredClone(exampleWorkflow);
        value.steps[0].inputMapping[0].source = { kind: 'path', path };
        invalid(value);
    }
    const orphan = structuredClone(exampleWorkflow);
    orphan.steps[0].inputMapping[0].target = 'unknown';
    invalid(orphan);
    invalid({ ...exampleWorkflow, expression: 'true' });
});
test('control flow is bounded, strictly forward and skipped outputs require fallback', () => {
    for (const target of ['review', 'missing']) {
        const value = structuredClone(exampleWorkflow);
        value.steps[0].branches = [{ when: [{ path: '$.input.text', op: 'exists' }], target }];
        invalid(value);
    }
    for (const maxIterations of [0, 11, 1.5]) {
        const value = structuredClone(exampleWorkflow);
        value.steps[0].repeat = { while: [{ path: '$.input.text', op: 'exists' }], maxIterations, onLimit: 'wait' };
        invalid(value);
    }
    const skipped = structuredClone(exampleWorkflow);
    skipped.steps[0].prerequisite = [{ path: '$.input.text', op: 'eq', value: 'yes' }];
    invalid(skipped);
    skipped.outputMapping[0].source = { kind: 'path', path: '$.steps.review.output.text', fallback: 'skipped' };
    validateWorkflowDefinition(skipped, context);
    const exit = structuredClone(exampleWorkflow);
    exit.steps.unshift({ id: 'gate', type: 'confirmation', name: '确认', prompt: '?', inputSchema: { type: 'object', additionalProperties: false }, inputMapping: [], onFailure: 'wait', branches: [{ when: [{ path: '$.input.text', op: 'exists' }], target: '$end' }] });
    invalid(exit);
});
test('predicates reject empty, arbitrary expression and incompatible comparison literals', () => {
    for (const condition of [[], [{ expression: 'true' }], [{ path: '$.input.text', op: 'gt', value: 1 }], [{ path: '$.input.text', op: 'eq', value: 3 }], [{ path: '$.input.text', op: 'in', value: [] }]]) {
        const value = structuredClone(exampleWorkflow);
        value.steps[0].prerequisite = condition as unknown as WorkflowPredicate[];
        invalid(value);
    }
});
test('tool inputs use native contracts, confirmation cannot be relaxed and no output may be invented', () => {
    const tool: WorkflowDefinition = { ...exampleWorkflow, outputSchema: { type: 'object', additionalProperties: false }, outputMapping: [], steps: [{ id: 'tool', name: '修改', type: 'tool', toolName: 'native', requiresConfirmation: false, inputMapping: [], onFailure: 'wait' }] };
    const ctx: WorkflowValidationContext = { skills: [], tools: [{ name: 'native', description: '', parameters: { type: 'object', additionalProperties: false }, mutates: true, requiresConfirmation: true }] };
    invalid(tool, ctx);
    if (tool.steps[0].type !== 'tool')
        throw new Error('fixture');
    tool.steps[0].requiresConfirmation = true;
    validateWorkflowDefinition(tool, ctx);
    invalid({ ...tool, steps: [{ ...tool.steps[0], outputSchema: payload }] }, ctx);
    tool.outputSchema = payload;
    tool.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.steps.tool.output.text', fallback: 'fallback' } }];
    invalid(tool, ctx);
    const confirm = { ...exampleWorkflow, steps: [{ id: 'c', name: '确认', type: 'confirmation', prompt: '?', inputSchema: { type: 'object' }, outputSchema: payload, inputMapping: [], onFailure: 'wait' }] };
    invalid(confirm);
});
test('native schema alternatives and boolean target schemas fail closed instead of bypassing mapping proof', () => {
    const constrained = structuredClone(context);
    constrained.skills[0].definition.inputSchema = { type: 'object', properties: { text: false }, required: ['text'] };
    invalid(exampleWorkflow, constrained);
    constrained.skills[0].definition.inputSchema = { type: 'object', properties: { text: { type: 'object', properties: { forbidden: false }, additionalProperties: false } } };
    const value = structuredClone(exampleWorkflow);
    value.inputSchema = { type: 'object', properties: { text: { type: 'object', properties: { forbidden: { type: 'string' } }, additionalProperties: false } }, required: ['text'] };
    invalid(value, constrained);
    const tool = { ...exampleWorkflow, steps: [{ id: 't', name: 'Tool', type: 'tool', toolName: 'native', requiresConfirmation: true, inputMapping: [], onFailure: 'wait' }], outputSchema: { type: 'object' }, outputMapping: [] };
    invalid(tool, { skills: [], tools: [{ name: 'native', description: '', mutates: false, requiresConfirmation: false, parameters: { type: 'object', anyOf: [{ required: ['must'] }] } }] });
});
test('forward branch that skips an intermediate producer cannot satisfy required downstream input without fallback', () => {
    const value = structuredClone(exampleWorkflow);
    const original = value.steps[0];
    value.steps = [{ id: 'gate', type: 'confirmation', name: 'Gate', prompt: '?', inputSchema: { type: 'object', additionalProperties: false }, inputMapping: [], onFailure: 'wait', branches: [{ when: [{ path: '$.input.text', op: 'exists' }], target: 'last' }] }, original,
        { ...original, id: 'last', inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.review.output.text' } }] }];
    value.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.steps.last.output.text' } }];
    const ctx = { ...context, skills: [...context.skills, { ...context.skills[0], stepId: 'last' }] };
    invalid(value, ctx);
    value.steps[2].inputMapping[0].source = { kind: 'path', path: '$.steps.review.output.text', fallback: 'skipped' };
    validateWorkflowDefinition(value, ctx);
});
test('whole mapped objects respect output and native-input root constraints, unsupported root refs/const/enum are rejected clearly', () => {
    const empty = { type: 'object', additionalProperties: false };
    const value: WorkflowDefinition = { ...exampleWorkflow, inputSchema: empty, outputSchema: { type: 'object', additionalProperties: false, minProperties: 1, properties: { text: { type: 'string' } } }, outputMapping: [],
        steps: [{ id: 'c', type: 'confirmation', name: 'Confirm', prompt: '?', inputSchema: empty, inputMapping: [], onFailure: 'wait' }] };
    invalid(value, { skills: [], tools: [] });
    value.outputMapping = [{ target: 'text', source: { kind: 'literal', value: 'ok' } }]; validateWorkflowDefinition(value, { skills: [], tools: [] });
    value.outputSchema.maxProperties = 0; invalid(value, { skills: [], tools: [] });
    for (const constraint of [{ $ref: '#/$defs/payload', $defs: { payload: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } }, { const: { text: 'fixed' } }, { enum: [{ text: 'fixed' }] }]) {
        value.outputSchema = { type: 'object', properties: { text: { type: 'string' } }, ...constraint }; value.outputMapping = [];
        assert.throws(() => validateWorkflowDefinition(value, { skills: [], tools: [] }), (e: unknown) => e instanceof Error && 'details' in e && JSON.stringify(e.details).includes('unsupported_mapping_root_constraint'));
    }
    value.outputSchema = empty; value.outputMapping = []; value.steps = [{ id: 't', type: 'tool', name: 'Tool', toolName: 'native', requiresConfirmation: false, inputMapping: [], onFailure: 'wait' }];
    for (const parameters of [{ type: 'object', minProperties: 1, properties: { text: { type: 'string' } } }, { type: 'object', const: { text: 'fixed' } }, { type: 'object', enum: [{ text: 'fixed' }] }, { type: 'object', $ref: '#/$defs/payload', $defs: { payload: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } }]) invalid(value, { skills: [], tools: [{ name: 'native', description: '', mutates: false, requiresConfirmation: false, parameters }] });
});
test('field-level local schema references remain supported by whole-object mapping proof', () => {
    const ctx = structuredClone(context);
    ctx.skills[0].definition.inputSchema = { type: 'object', additionalProperties: false, properties: { text: { $ref: '#/$defs/Text' } }, required: ['text'], $defs: { Text: { type: 'string', minLength: 1, maxLength: 20 } } };
    validateWorkflowDefinition(exampleWorkflow, ctx);
});
