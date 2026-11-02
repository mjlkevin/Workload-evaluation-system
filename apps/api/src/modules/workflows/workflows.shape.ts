import Ajv from 'ajv';
import { isBusinessRole } from '../../middleware/auth';
import { compileSkillPayloadSchema } from '../skills/skills.validation';
import { workflowInvalid as invalid, type WorkflowDefinition } from './workflows.types';
const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const safe = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' };
const predicate = object({ path: text(300, 1), op: { enum: ['exists', 'eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte'] }, value: {} }, ['path', 'op']);
const predicates = { type: 'array', minItems: 1, maxItems: 20, items: predicate };
const mappings = { type: 'array', maxItems: 100, items: object({ target: safe, source: { oneOf: [object({ kind: { const: 'path' }, path: text(300, 1), fallback: {} }, ['kind', 'path']), object({ kind: { const: 'literal' }, value: {} })] } }) };
const base = { id: safe, name: text(120, 1), inputMapping: mappings, prerequisite: predicates,
    branches: { type: 'array', minItems: 1, maxItems: 20, items: object({ when: predicates, target: text(80, 1) }) }, onFailure: { enum: ['wait', 'fail'] },
    repeat: object({ while: predicates, maxIterations: { type: 'integer', minimum: 1, maximum: 10 }, onLimit: { enum: ['wait', 'fail'] } }) };
const required = ['id', 'name', 'inputMapping', 'onFailure', 'type'];
const step = (extra: Record<string, unknown>) => object({ ...base, ...extra }, [...required, ...Object.keys(extra).filter(k => k !== 'type')]);
const validateShape = new Ajv({ allErrors: true, strict: false }).compile(object({
    name: text(120, 1), description: text(2000), category: text(80, 1), roles: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: text(30, 1) },
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, outputMapping: mappings,
    steps: { type: 'array', minItems: 1, maxItems: 50, items: { oneOf: [
                step({ type: { const: 'skill' }, skillId: text(160, 1), skillVersionId: text(160, 1) }),
                step({ type: { const: 'userInput' }, prompt: text(4000, 1), inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }),
                step({ type: { const: 'confirmation' }, prompt: text(4000, 1), inputSchema: { type: 'object' } }),
                step({ type: { const: 'tool' }, toolName: text(160, 1), requiresConfirmation: { type: 'boolean' } }),
            ] } },
}));
export function workflowShape(value: unknown): WorkflowDefinition {
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        invalid('definition', 'json_required');
    }
    if (!serialized || Buffer.byteLength(serialized) > 256000)
        invalid('definition', 'definition_too_large');
    if (!validateShape(value))
        invalid(`definition${validateShape.errors?.[0]?.instancePath ?? ''}`, validateShape.errors?.[0]?.message ?? 'invalid');
    const definition = structuredClone(value) as WorkflowDefinition;
    if (![definition.name, definition.category, ...definition.steps.map(s => s.name)].every(s => s.trim()))
        invalid('name', 'nonblank_required');
    if (!definition.roles.every(isBusinessRole))
        invalid('roles', 'unknown_business_role');
    const ids = definition.steps.map(s => s.id);
    if (new Set(ids).size !== ids.length || ids.some(id => ['__proto__', 'constructor', 'prototype'].includes(id)))
        invalid('steps', 'duplicate_or_unsafe_id');
    if (definition.steps.reduce((n, s) => n + (s.repeat?.maxIterations ?? 1), 0) > 500)
        invalid('steps', 'step_visit_limit');
    try {
        compileSkillPayloadSchema(definition.inputSchema, 'inputSchema');
        compileSkillPayloadSchema(definition.outputSchema, 'outputSchema');
        for (const s of definition.steps)
            if (s.type === 'userInput' || s.type === 'confirmation') {
                compileSkillPayloadSchema(s.inputSchema, `steps.${s.id}.inputSchema`);
                if (s.type === 'userInput')
                    compileSkillPayloadSchema(s.outputSchema, `steps.${s.id}.outputSchema`);
            }
    }
    catch (error) {
        invalid('schema', (error as Error).message);
    }
    return definition;
}
