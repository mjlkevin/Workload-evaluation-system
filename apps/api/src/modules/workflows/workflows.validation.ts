import { mappedInput, schemaFits } from '../skills/skills.schema-compatibility';
import { compileNativeToolOutput, compileSkillPayloadSchema, skillPathParts } from '../skills/skills.validation';
import { workflowShape } from './workflows.shape';
import { workflowInvalid as invalid, type WorkflowDefinition, type WorkflowMapping, type WorkflowPredicate, type WorkflowSchema, type WorkflowValidationContext } from './workflows.types';
const confirmationOutput = { type: 'object', additionalProperties: false, properties: { approved: { type: 'boolean' } }, required: ['approved'] };
const fields = (schema: WorkflowSchema) => (schema.properties ?? {}) as Record<string, WorkflowSchema>;
function literalFits(value: unknown, schema: WorkflowSchema, root: WorkflowSchema): boolean {
    try {
        return Boolean(compileSkillPayloadSchema({ type: 'object', properties: { value: schema }, required: ['value'], $defs: root.$defs ?? {}, definitions: root.definitions ?? {} }, 'literal')({ value }));
    }
    catch {
        return false;
    }
}
/** Conservative finite graph analysis only. No tool execution, model invocation or expression evaluation. */
export function validateWorkflowDefinition(value: unknown, context: WorkflowValidationContext): WorkflowDefinition {
    const definition = workflowShape(value);
    const steps = definition.steps;
    const ids = new Map(steps.map((s, i) => [s.id, i]));
    const contracts = steps.map(step => {
        if (step.type === 'skill') {
            const skill = context.skills.find(s => s.stepId === step.id && s.skillId === step.skillId && s.skillVersionId === step.skillVersionId);
            if (!skill || skill.status !== 'published' || !skill.enabled || skill.archived)
                invalid(`steps.${step.id}`, 'exact_published_skill_unavailable');
            if (definition.roles.some(role => !skill.definition.roles.includes(role)))
                invalid('roles', 'workflow_roles_broaden_skill_access');
            return { input: skill.definition.inputSchema, output: skill.definition.outputSchema };
        }
        if (step.type === 'tool') {
            const tool = context.tools.find(t => t.name === step.toolName);
            if (!tool)
                invalid(`steps.${step.id}`, 'tool_unavailable_under_current_policy');
            if ((tool.mutates || tool.exfiltrates || tool.requiresConfirmation) && !step.requiresConfirmation)
                invalid(`steps.${step.id}.requiresConfirmation`, 'native_confirmation_required');
            try { compileNativeToolOutput(tool); }
            catch { invalid(`steps.${step.id}`, 'unsupported_native_output_schema'); }
            return { input: tool.parameters, output: tool.outputSchema ?? null };
        }
        return { input: step.inputSchema, output: step.type === 'confirmation' ? confirmationOutput : step.outputSchema };
    });
    // All possible predecessors, including branch exits, participate. The default next edge always exists.
    const incoming: Set<string>[][] = Array.from({ length: steps.length + 1 }, () => []);
    incoming[0].push(new Set());
    const intersect = (sets: Set<string>[]) => new Set(sets.length ? [...sets[0]].filter(id => sets.every(s => s.has(id))) : []);
    function source(path: string, at: number, available: Set<string>, allowCurrent = false) {
        let parts: string[];
        try {
            parts = skillPathParts(path);
        }
        catch {
            return invalid('path', 'unsafe_or_unsupported_path');
        }
        if (parts[0] === 'input' && parts.length >= 2) {
            const found = mappedInput(definition.inputSchema, `$.${parts.slice(1).join('.')}`);
            if (!found)
                invalid('path', 'input_field_missing');
            return { ...found, root: definition.inputSchema };
        }
        if (parts[0] !== 'steps' || parts[2] !== 'output' || parts.length < 4)
            invalid('path', 'only_input_or_step_output_paths');
        const index = ids.get(parts[1]);
        if (index === undefined || index > at || (index === at && !allowCurrent))
            invalid('path', 'forward_or_missing_step_reference');
        const output = contracts[index].output;
        // Only a frozen code-owned native schema can make tool output available to mappings.
        if (!output)
            invalid('path', 'tool_output_contract_unavailable');
        const found = mappedInput(output, `$.${parts.slice(3).join('.')}`);
        if (!found)
            invalid('path', 'step_output_field_missing');
        return { ...found, required: found.required && available.has(parts[1]), root: output };
    }
    function map(items: WorkflowMapping[], target: WorkflowSchema, at: number, available: Set<string>) {
        try {
            compileSkillPayloadSchema(target, 'mapping.target');
        }
        catch {
            invalid('mapping', 'unsupported_target_schema');
        }
        if (['$ref', 'const', 'enum'].some(key => Object.prototype.hasOwnProperty.call(target, key)))
            invalid('mapping', 'unsupported_mapping_root_constraint:ref_const_enum');
        const properties = fields(target);
        const mapped = new Set<string>();
        for (const item of items) {
            if (mapped.has(item.target) || !Object.prototype.hasOwnProperty.call(properties, item.target) || ['constructor', 'prototype', '__proto__'].includes(item.target))
                invalid('mapping', 'duplicate_or_unknown_target');
            mapped.add(item.target);
            const constraint = properties[item.target];
            const binding = item.source;
            if (binding.kind === 'literal') {
                if (!literalFits(binding.value, constraint, target))
                    invalid('mapping', 'literal_does_not_fit_target');
                continue;
            }
            const input = source(binding.path, at, available);
            if (!schemaFits(input.schema, constraint, input.root, target))
                invalid('mapping', 'source_does_not_fit_target');
            const fallback = Object.prototype.hasOwnProperty.call(binding, 'fallback');
            if ((!input.required && !fallback) || (fallback && !literalFits(binding.fallback, constraint, target)))
                invalid('mapping', 'optional_or_skipped_source_needs_valid_fallback');
        }
        if (((target.required ?? []) as string[]).some(name => !mapped.has(name)))
            invalid('mapping', 'required_target_not_mapped');
        // Every successful binding produces exactly one field (optional paths already require fallback).
        // Field proofs above establish each value fits its target; now prove the entire assembled object,
        // including root cardinality and additional-property constraints, against the authoritative contract.
        const assembled = { type: 'object', additionalProperties: false, minProperties: mapped.size, maxProperties: mapped.size,
            properties: Object.fromEntries([...mapped].map(key => [key, properties[key]])), required: [...mapped] };
        if (!schemaFits(assembled, target, target, target))
            invalid('mapping', 'mapped_object_does_not_fit_target');
    }
    function predicates(items: WorkflowPredicate[], at: number, available: Set<string>, allowCurrent = false) {
        for (const item of items) {
            const input = source(item.path, at, available, allowCurrent);
            if (item.op === 'exists') {
                if (Object.prototype.hasOwnProperty.call(item, 'value'))
                    invalid('predicate', 'exists_has_no_value');
                continue;
            }
            if (!input.required || !Object.prototype.hasOwnProperty.call(item, 'value'))
                invalid('predicate', 'comparison_requires_guaranteed_field_and_value');
            if (item.op === 'in') {
                if (!Array.isArray(item.value) || !item.value.length || item.value.length > 100 || !item.value.every(v => literalFits(v, input.schema, input.root)))
                    invalid('predicate', 'bounded_type_compatible_list_required');
            }
            else if (['gt', 'gte', 'lt', 'lte'].includes(item.op)) {
                if (!['integer', 'number'].includes(String(input.schema.type)) || typeof item.value !== 'number' || !Number.isFinite(item.value))
                    invalid('predicate', 'numeric_comparison_required');
            }
            else if (!literalFits(item.value, input.schema, input.root))
                invalid('predicate', 'type_compatible_literal_required');
        }
    }
    for (const [index, step] of steps.entries()) {
        const before = intersect(incoming[index]);
        map(step.inputMapping, contracts[index].input, index, before);
        if (step.prerequisite)
            predicates(step.prerequisite, index, before);
        const after = new Set(before);
        if (!step.prerequisite)
            after.add(step.id);
        incoming[index + 1].push(after);
        for (const branch of step.branches ?? []) {
            predicates(branch.when, index, after, true);
            const target = branch.target === '$end' ? steps.length : ids.get(branch.target);
            if (target === undefined || target <= index)
                invalid('branches.target', 'strictly_forward_target_required');
            incoming[target].push(after);
        }
        if (step.repeat)
            predicates(step.repeat.while, index, after, true);
    }
    map(definition.outputMapping, definition.outputSchema, steps.length, intersect(incoming[steps.length]));
    return definition;
}
