import { createHash } from 'node:crypto';

// PostgreSQL jsonb does not preserve object key order; hashes describe content, not serialization order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export const skillDefinitionHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
