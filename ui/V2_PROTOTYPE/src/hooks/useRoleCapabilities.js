import { useEffect, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'

/**
 * RP-026 补改：窄加载角色能力矩阵
 * 仅请求 /system/role-capabilities，不触发 rules/models/DSL/templates 等系统配置加载
 */
export default function useRoleCapabilities({ enabled = isAuthenticated() } = {}) {
  const [data, setData] = useState({
    roles: [],
    legacyMapping: [],
    capabilityLabels: {},
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const payload = await apiClient.get('/system/role-capabilities')
        if (cancelled) return
        const result = payload?.data || payload || {}
        setData({
          roles: Array.isArray(result.roles) ? result.roles : [],
          legacyMapping: Array.isArray(result.legacyMapping) ? result.legacyMapping : [],
          capabilityLabels: result.capabilityLabels || {},
        })
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || '加载角色能力矩阵失败')
          // 降级：保持空数据
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [enabled])

  return { ...data, loading, error }
}
