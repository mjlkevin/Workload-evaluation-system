import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList, unwrap } from '../api/utils.js'

function getErrorMessage(error) {
  return error?.message || '操作失败，请稍后重试'
}

function maskKey(code = '') {
  const text = String(code)
  if (text.startsWith('sk-')) return text
  return text ? `invite-${text}` : ''
}

export function mapApiKeyToVM(record = {}) {
  const code = record.key || record.code || record.token || ''
  return {
    id: record.id || record.keyId || record.code || code || '',
    name: record.name || record.label || (record.code ? `邀请码 ${record.code}` : '未命名密钥'),
    key: maskKey(code),
    status: record.status === 'revoked' || record.status === 'used' || record.revoked ? 'revoked' : 'active',
    scope: record.scope || record.role || 'read',
    createdAt: record.createdAt || '',
    raw: record,
  }
}

export default function useApiKeys({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapApiKeyToVM),
    [fallbackData]
  )
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setKeys([])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiClient.get('/auth/invite-codes')
      .then((payload) => {
        if (cancelled) return
        const mapped = unwrapList(payload).map(mapApiKeyToVM)
        setKeys(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        setError(getErrorMessage(err))
        setKeys([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, fallbackRows])

  const createKey = async (name, scope) => {
    setLoading(true)
    setError(null)
    try {
      let nextKey
      if (enabled) {
        const payload = await apiClient.post('/auth/invite-codes/generate', {
          count: 1,
          role: scope,
          expiresInDays: 365,
        })
        const data = unwrap(payload) || {}
        nextKey = mapApiKeyToVM(data.code || data.key || data)
      } else {
        const generated = `sk-wes-${Math.random().toString(36).slice(2, 10)}`
        nextKey = mapApiKeyToVM({
          id: `k${Date.now()}`,
          name,
          key: generated,
          status: 'active',
          scope,
          createdAt: new Date().toISOString(),
        })
      }

      nextKey = { ...nextKey, name, scope, status: 'active' }
      setKeys((prev) => [nextKey, ...prev])
      return { success: true, error: null, key: nextKey }
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      return { success: false, error: message }
    } finally {
      setLoading(false)
    }
  }

  const revokeKey = async (keyId) => {
    setError(null)
    try {
      if (enabled) {
        try {
          await apiClient.patch(`/auth/keys/${keyId}/revoke`)
        } catch (firstError) {
          try {
            await apiClient.delete(`/auth/keys/${keyId}`)
          } catch (secondError) {
            if (firstError?.status !== 404 && secondError?.status !== 404) throw secondError
          }
        }
      }
      setKeys((prev) => prev.map((key) => key.id === keyId ? { ...key, status: 'revoked' } : key))
      return { success: true, error: null }
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      return { success: false, error: message }
    }
  }

  const restoreKey = async (keyId) => {
    setError(null)
    setKeys((prev) => prev.map((key) => key.id === keyId ? { ...key, status: 'active' } : key))
    return { success: true, error: null }
  }

  return {
    keys,
    loading,
    error,
    actions: { createKey, revokeKey, restoreKey },
  }
}
