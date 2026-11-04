import Ajv from 'ajv';
import { isBusinessRole } from '../../middleware/auth';
import { SkillError, type SkillDefinition } from './skills.types';
import { mappedInput, schemaFits } from './skills.schema-compatibility';

export type SkillToolDefinition = { name: string; description: string; parameters: Record<string, unknown>; outputSchema?: Record<string, unknown>; mutates: boolean; exfiltrates?: boolean; simulationOnly?: boolean };
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false });
const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const definitionSchema = object({
  name: text(120, 1), description: text(2000), category: text(80, 1), instructions: text(30000, 1),
  roles: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: text(30, 1) },
  references: { type: 'array', maxItems: 30, items: object({ label: text(120, 1), uri: text(1000, 1), version: text(120, 1) }) },
  inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
  model: object({ scenario: { enum: ['assessment', 'fileParsing', 'generation'] }, temperature: { type: 'number', minimum: 0, maximum: 2 }, maxTokens: { type: 'integer', minimum: 1, maximum: 64000 }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000 } }),
  tools: { type: 'array', maxItems: 30, items: object({ toolName: text(160, 1), inputMapping: { type: 'object', maxProperties: 50, additionalProperties: text(300, 1) }, requiresConfirmation: { type: 'boolean' } }) },
  examples: { type: 'array', maxItems: 30, items: object({ title: text(120, 1), input: {}, expected: {}, assertions: { type: 'array', minItems: 1, maxItems: 30, items: object({ path: text(300, 1), op: { enum: ['equals', 'contains', 'exists', 'minItems'] }, value: {} }, ['path', 'op']) } }, ['title', 'input', 'expected']) },
});
const validateDefinition = ajv.compile(definitionSchema);
const schemaKeys = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', '$defs', 'definitions', '$ref', '$schema']);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
function invalid(field: string, reason: string): never {
  throw new SkillError('SKILL_INVALID_DEFINITION', 'Skill 定义不合法，请检查标记字段', 400, [{ field, reason }]);
}
function errors(field: string, items: typeof validateDefinition.errors): never {
  throw new SkillError('SKILL_INVALID_DEFINITION', 'Skill 定义不合法，请检查标记字段', 400, (items || []).slice(0, 15).map(e => ({ field: `${field}${e.instancePath}`, reason: e.message || 'invalid' })));
}
function inspectSchema(node: unknown, root: Record<string, unknown>, field: string, depth = 0, refs = new Set<string>()): void {
  if (depth > 16) invalid(field, 'schema_too_deep');
  if (typeof node === 'boolean') return;
  if (!node || typeof node !== 'object' || Array.isArray(node)) invalid(field, 'schema_must_be_object');
  const schema = node as Record<string, unknown>;
  for (const key of Object.keys(schema)) if (!schemaKeys.has(key) || forbiddenKeys.has(key)) invalid(field, `unsupported_schema_keyword:${key}`);
  if (schema.$schema && schema.$schema !== 'http://json-schema.org/draft-07/schema#') invalid(field, 'unsupported_schema_dialect');
  if (schema.$ref !== undefined) {
    const ref = schema.$ref;
    if (typeof ref !== 'string' || !/^#\/(\$defs|definitions)\/[A-Za-z0-9_-]+$/.test(ref)) invalid(field, 'only_local_definition_refs_allowed');
    if (refs.has(ref)) invalid(field, 'recursive_schema_not_allowed');
    const [, group, name] = ref.split('/');
    const target = (root[group] as Record<string, unknown> | undefined)?.[name];
    if (target === undefined) invalid(field, 'schema_ref_not_found');
    inspectSchema(target, root, field, depth + 1, new Set([...refs, ref]));
  }
  for (const group of ['properties', '$defs', 'definitions']) {
    if (schema[group] === undefined) continue;
    const entries = schema[group];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) invalid(field, `${group}_must_be_object`);
    for (const [name, child] of Object.entries(entries)) {
      if (forbiddenKeys.has(name)) invalid(field, 'unsafe_field_name');
      inspectSchema(child, root, `${field}/${group}/${name}`, depth + 1, refs);
    }
  }
  for (const key of ['items', 'additionalProperties']) if (schema[key] !== undefined) inspectSchema(schema[key], root, `${field}/${key}`, depth + 1, refs);
}
function compileSchema(schema: Record<string, unknown>, field: string, compiler: Ajv) {
  if (schema.type !== 'object') invalid(field, 'root_type_must_be_object');
  inspectSchema(schema, schema, field);
  try { return compiler.compile(schema); } catch { return invalid(field, 'invalid_json_schema'); }
}
export function skillPathParts(path: string): string[] {
  if (typeof path !== 'string' || path.length > 300 || !/^\$(\.[A-Za-z0-9_-]+){0,16}$/.test(path)) invalid('path', 'invalid_field_path');
  const parts = path.split('.').slice(1);
  if (parts.some(part => forbiddenKeys.has(part))) invalid('path', 'unsafe_field_path');
  return parts;
}

/** Dynamic schemas use a fresh compiler, never the static definition validator cache. */
export function compileSkillPayloadSchema(schema: Record<string, unknown>, field: string) {
  return compileSchema(schema, field, new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false }));
}

/** Only Registry code may supply this contract. Missing schemas never acquire defaults on replay. */
export function compileNativeToolOutput(tool: { outputSchema?: Record<string, unknown>; source?: string }) {
  if (tool.outputSchema === undefined) return null;
  if (tool.source !== undefined && tool.source !== 'code') invalid('outputSchema', 'native_code_output_contract_required');
  return compileSkillPayloadSchema(tool.outputSchema, 'native.outputSchema');
}

export function validateSkillDefinition(value: unknown, tools: SkillToolDefinition[]): SkillDefinition {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return invalid('definition', 'json_required'); }
  if (!serialized || Buffer.byteLength(serialized) > 128000) invalid('definition', 'definition_too_large');
  if (!validateDefinition(value)) errors('definition', validateDefinition.errors);
  const definition = structuredClone(value) as SkillDefinition;
  if (!definition.name.trim() || !definition.instructions.trim()) invalid('name', 'nonblank_required');
  if (!definition.roles.every(isBusinessRole)) invalid('roles', 'unknown_business_role');
  // User-authored schemas are request-scoped: AJV caches anonymous schema objects even with addUsedSchema=false.
  const compiler = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false });
  const input = compileSchema(definition.inputSchema, 'inputSchema', compiler);
  const output = compileSchema(definition.outputSchema, 'outputSchema', compiler);
  for (const [i, example] of definition.examples.entries()) {
    if (!input(example.input)) errors(`examples/${i}/input`, input.errors);
    if (!output(example.expected)) errors(`examples/${i}/expected`, output.errors);
    for (const assertion of example.assertions || []) {
      skillPathParts(assertion.path);
      if (assertion.op !== 'exists' && !Object.prototype.hasOwnProperty.call(assertion, 'value')) invalid(`examples/${i}/assertions`, 'assertion_value_required');
      if (assertion.op === 'minItems' && (!Number.isInteger(assertion.value) || (assertion.value as number) < 0 || (assertion.value as number) > 100000)) invalid(`examples/${i}/assertions`, 'invalid_min_items');
    }
  }
  const seen = new Set<string>();
  for (const [i, binding] of definition.tools.entries()) {
    const field = `tools/${i}`;
    const tool = tools.find(item => item.name === binding.toolName);
    if (!tool || seen.has(binding.toolName)) invalid(field, 'unknown_or_duplicate_tool');
    compileNativeToolOutput(tool);
    seen.add(binding.toolName);
    if ((tool.mutates || tool.exfiltrates) && !binding.requiresConfirmation) invalid(field, 'native_confirmation_cannot_be_relaxed');
    if (!compiler.validateSchema(tool.parameters)) invalid(field, 'invalid_native_parameter_schema');
    const properties = tool.parameters.properties as Record<string, Record<string, unknown>> | undefined;
    const mappedProperties: Record<string, unknown> = {}; const mappedRequired: string[] = [];
    for (const [key, path] of Object.entries(binding.inputMapping)) {
      const target = properties?.[key]; const source = mappedInput(definition.inputSchema, path);
      if (!target || !source) invalid(`${field}/inputMapping/${key}`, 'unknown_parameter_or_input_path');
      if (!schemaFits(source.schema, target, definition.inputSchema, tool.parameters)) invalid(`${field}/inputMapping/${key}`, 'native_parameter_schema_mismatch');
      if (Array.isArray(tool.parameters.required) && tool.parameters.required.includes(key) && !source.required) invalid(`${field}/inputMapping/${key}`, 'native_required_source_optional');
      mappedProperties[key] = source.schema;
      if (source.required) mappedRequired.push(key);
    }
    for (const key of Array.isArray(tool.parameters.required) ? tool.parameters.required : []) if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(binding.inputMapping, key)) invalid(`${field}/inputMapping/${key}`, 'native_required_parameter_missing');
    const mappedParameters = { type: 'object', properties: mappedProperties, required: mappedRequired, additionalProperties: false, minProperties: mappedRequired.length, maxProperties: Object.keys(mappedProperties).length };
    if (!schemaFits(mappedParameters, tool.parameters, definition.inputSchema, tool.parameters)) invalid(field, 'native_root_parameter_schema_mismatch');
  }
  return definition;
}
