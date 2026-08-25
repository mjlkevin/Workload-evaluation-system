import { useCallback, useEffect, useRef, useState } from 'react'
import { isAuthenticated } from '../api/auth.js'
import { listUsers } from '../api/users.js'

export const BUSINESS_ROLES = [
  { key: 'sales', label: '销售员' },
  { key: 'pre_sales', label: '售前顾问' },
  { key: 'delivery', label: '交付顾问' },
  { key: 'pm', label: '项目经理' },
  { key: 'pmo', label: 'PMO' },
  { key: 'dev', label: '开发顾问' },
  { key: 'admin', label: '管理视角' },
]

export function defaultBusinessRoleForSystemRole(role) {
  if (role === 'admin') return 'admin'
  if (role === 'sub_admin') return 'pm'
  return 'pre_sales'
}

export function businessRoleLabel(role) {
  return BUSINESS_ROLES.find((item) => item.key === role)?.label || role || '未配置'
}

export function mapUserToVM(user = {}) {
  const username = user.username || user.name || user.account || 'unknown'
  const role = user.role || 'user'
  const businessRole = user.businessRole || user.business_role || defaultBusinessRoleForSystemRole(role)
  return {
    id: user.id || user.userId || username,
    username,
    email: user.email || `${username}@wes.local`,
    role,
    businessRole,
    businessRoleLabel: businessRoleLabel(businessRole),
    status: user.status === 'disabled' || user.disabled ? 'disabled' : 'active',
    lastLoginAt: user.lastLoginAt || user.lastLoginTime || null,
    createdAt: user.createdAt || null,
    locked: Boolean(user.locked || user.systemAccount || role === 'admin' || username === 'admin'),
    raw: user,
  }
}

export default function useUsers({ enabled = isAuthenticated() } = {}) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!enabled) {
      if (requestId === requestIdRef.current) {
        setUsers([])
        setLoading(false)
        setError(null)
      }
      return []
    }

    setLoading(true)
    setError(null)

    try {
      const mapped = (await listUsers()).map(mapUserToVM)
      if (requestId === requestIdRef.current) {
        setUsers(mapped)
      }
      return mapped
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err)
      }
      throw err
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [enabled])

  useEffect(() => {
    // ISS-2026-08-18-005（档 3）：reload 内部已 setError 后 rethrow，
    // 错误由 users/error 状态承载呈现；外层 catch 仅防未处理拒绝，可静默。
    void reload().catch(() => {})
    return () => {
      requestIdRef.current += 1
    }
  }, [reload])

  return { users, loading, error, reload }
}
