type Schema = Record<string, unknown>;
const annotations = new Set(['description', 'title', 'default', 'examples', '$schema', '$defs', 'definitions']);
const supported = new Set(['type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', '$ref']);
function resolve(schema: Schema, root: Schema): Schema | null {
  if (!schema.$ref) return schema;
  if (typeof schema.$ref !== 'string' || !/^#\/(\$defs|definitions)\/[A-Za-z0-9_-]+$/.test(schema.$ref)) return null;
  if (Object.keys(schema).some(key => key !== '$ref' && !annotations.has(key))) return null;
  const [, group, key] = schema.$ref.split('/');
  const target = (root[group] as Record<string, unknown> | undefined)?.[key];
  return target && typeof target === 'object' && !Array.isArray(target) ? target as Schema : null;
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const numeric = (value: unknown, fallback: number) => typeof value === 'number' ? value : fallback;
function bound(schema: Schema, lower: boolean) {
  const ordinary = numeric(schema[lower ? 'minimum' : 'maximum'], lower ? -Infinity : Infinity);
  const exclusiveValue = schema[lower ? 'exclusiveMinimum' : 'exclusiveMaximum'];
  const exclusive = numeric(exclusiveValue, lower ? -Infinity : Infinity);
  const value = lower ? Math.max(ordinary, exclusive) : Math.min(ordinary, exclusive);
  return { value, exclusive: exclusiveValue !== undefined && value === exclusive };
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Prove the supported source schema is no broader than the native parameter schema. Unknown constraints fail closed. */
export function schemaFits(source: Schema, target: Schema, sourceRoot: Schema, targetRoot: Schema, depth = 0): boolean {
  if (depth > 16 || !source || typeof source !== 'object' || Array.isArray(source) || !target || typeof target !== 'object' || Array.isArray(target)) return false;
  const s = resolve(source, sourceRoot); const t = resolve(target, targetRoot);
  if (!s || !t) return false;
  if (s !== source || t !== target) return schemaFits(s, t, sourceRoot, targetRoot, depth + 1);
  if (Object.keys(t).some(key => !annotations.has(key) && !supported.has(key))) return false;
  const targetTypes = t.type === undefined ? [] : Array.isArray(t.type) ? t.type : [t.type];
  if (targetTypes.length && !targetTypes.includes(s.type) && !(s.type === 'integer' && targetTypes.includes('number'))) return false;
  const sourceValues = Object.prototype.hasOwnProperty.call(s, 'const') ? [s.const] : Array.isArray(s.enum) ? s.enum : null;
  if (Array.isArray(t.enum) && (!sourceValues || !sourceValues.every(value => list(t.enum).some(allowed => same(value, allowed))))) return false;
  if (Object.prototype.hasOwnProperty.call(t, 'const') && (!sourceValues || !sourceValues.every(value => same(value, t.const)))) return false;
  for (const [min, max] of [['minLength', 'maxLength'], ['minItems', 'maxItems'], ['minProperties', 'maxProperties']]) {
    if (numeric(s[min], 0) < numeric(t[min], 0) || numeric(s[max], Infinity) > numeric(t[max], Infinity)) return false;
  }
  const sMin = bound(s, true); const tMin = bound(t, true);
  const sMax = bound(s, false); const tMax = bound(t, false);
  if (sMin.value < tMin.value || sMax.value > tMax.value || (sMin.value === tMin.value && tMin.exclusive && !sMin.exclusive) || (sMax.value === tMax.value && tMax.exclusive && !sMax.exclusive)) return false;
  if (t.uniqueItems === true && s.uniqueItems !== true) return false;
  if (t.items === false && s.maxItems !== 0) return false;
  if (t.items && typeof t.items === 'object') {
    if (!s.items || typeof s.items !== 'object' || Array.isArray(s.items) || !schemaFits(s.items as Schema, t.items as Schema, sourceRoot, targetRoot, depth + 1)) return false;
  }
  const sp = (s.properties || {}) as Record<string, Schema>; const tp = (t.properties || {}) as Record<string, Schema>;
  if (list(t.required).some(key => typeof key !== 'string' || !list(s.required).includes(key) || !sp[key])) return false;
  for (const [key, constraint] of Object.entries(tp)) {
    if (sp[key]) { if (!schemaFits(sp[key], constraint, sourceRoot, targetRoot, depth + 1)) return false; }
    else if (s.additionalProperties !== false) return false;
  }
  if (t.additionalProperties === false && (s.additionalProperties !== false || Object.keys(sp).some(key => !tp[key]))) return false;
  if (t.additionalProperties && typeof t.additionalProperties === 'object') {
    if (s.additionalProperties !== false && (!s.additionalProperties || typeof s.additionalProperties !== 'object' || !schemaFits(s.additionalProperties as Schema, t.additionalProperties as Schema, sourceRoot, targetRoot, depth + 1))) return false;
    for (const [key, constraint] of Object.entries(sp)) if (!tp[key] && !schemaFits(constraint, t.additionalProperties as Schema, sourceRoot, targetRoot, depth + 1)) return false;
  }
  return true;
}

export function mappedInput(root: Schema, path: string): { schema: Schema; required: boolean } | null {
  if (!/^\$\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) return null;
  let node = root; let required = true;
  for (const part of path.slice(2).split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(part)) return null;
    const resolved = resolve(node, root); if (!resolved || resolved.type !== 'object') return null;
    required = required && list(resolved.required).includes(part);
    const next = (resolved.properties as Record<string, unknown> | undefined)?.[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return null;
    node = next as Schema;
  }
  return { schema: node, required };
}
