/** Resolve only the same bounded local definition references accepted by the server. No network lookup. */
export function resolveBusinessSchema(root = {}) {
  let remaining = 2048
  function expand(node, depth = 0, refs = new Set()) {
    if (depth > 16 || --remaining < 0) throw new Error('schema_limit')
    if (typeof node === 'boolean') return node
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('schema_invalid')
    let schema = node
    if (node.$ref !== undefined) {
      if (typeof node.$ref !== 'string' || !/^#\/(\$defs|definitions)\/[A-Za-z0-9_-]+$/.test(node.$ref) || refs.has(node.$ref)) throw new Error('schema_ref_invalid')
      const [, group, name] = node.$ref.split('/')
      const target = Object.hasOwn(root[group] || {}, name) ? root[group][name] : undefined
      if (target === undefined) throw new Error('schema_ref_missing')
      const resolved = expand(target, depth + 1, new Set([...refs, node.$ref]))
      if (typeof resolved === 'boolean') return resolved
      schema = { ...resolved, ...node }
      delete schema.$ref
    }
    const result = { ...schema }
    if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, expand(child, depth + 1, refs)]))
    for (const key of ['items', 'additionalProperties']) if (schema[key] !== undefined) result[key] = expand(schema[key], depth + 1, refs)
    return result
  }
  return expand(root)
}
export const unavailableSchemaMessage = '输入结构暂不可用，请刷新后重试'
