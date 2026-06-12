import { useEffect, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrap } from '../api/utils.js'
import { businessRoleLabel, defaultBusinessRoleForSystemRole } from './useUsers.js'

export default function useCurrentUser({ enabled = isAuthenticated() } = {}) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setUser(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient.get('/auth/me')
      .then((payload) => {
        if (cancelled) return
        const data = unwrap(payload) || {}
        const raw = data.user || payload?.user || {}
        const businessRole = raw.businessRole || defaultBusinessRoleForSystemRole(raw.role)
        setUser({ ...raw, businessRole, businessRoleLabel: businessRoleLabel(businessRole) })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled])

  return { user, loading, error }
}
