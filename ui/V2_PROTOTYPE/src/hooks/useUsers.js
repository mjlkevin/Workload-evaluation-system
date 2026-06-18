import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapUsers } from '../api/utils.js'

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

export default function useUsers({ enabled = isAuthenticated(), fallbackData = [] } = {}) {
  const fallbackUsers = useMemo(() => fallbackData.map(mapUserToVM), [fallbackData])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setUsers([])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiClient.get('/auth/users')
      .then((payload) => {
        if (cancelled) return
        const mapped = unwrapUsers(payload).map(mapUserToVM)
        setUsers(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setUsers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, fallbackUsers])

  return { users, loading, error }
}
