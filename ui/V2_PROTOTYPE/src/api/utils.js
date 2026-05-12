/**
 * 多 shape 防御型列表解包
 * 支持: [...] / { data: [...] } / { items: [...] } / { data: { items: [...] } }
 * 对 __error 标记的 payload 返回 []
 */
export function unwrapList(payload) {
  if (!payload || payload.__error) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

/**
 * 单对象解包（非数组对象）
 * 支持: {} / { data: {} }
 */
export function unwrapSingle(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload
  return null
}

/**
 * 通用 unwrap（兼容 key 参数）
 * unwrap(payload)  → payload.data ?? payload ?? null
 * unwrap(payload, 'items') → 优先取 payload.data.items > payload.items
 */
export function unwrap(payload, key) {
  if (payload?.__error) return null
  if (key && payload?.data?.[key]) return payload.data[key]
  if (key && payload?.[key]) return payload[key]
  return payload?.data ?? payload ?? null
}

/**
 * 用户列表解包
 * 支持: [...] / { users: [...] } / { data: { users: [...] } } / { data: [...] }
 */
export function unwrapUsers(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.users)) return payload.users
  if (Array.isArray(payload?.data?.users)) return payload.data.users
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

/**
 * 数组标准化（nil-safe）
 */
export function asArray(value, key) {
  if (key && Array.isArray(value?.[key])) return value[key]
  if (key && Array.isArray(value?.data?.[key])) return value.data[key]
  if (Array.isArray(value?.data)) return value.data
  return Array.isArray(value) ? value : []
}
