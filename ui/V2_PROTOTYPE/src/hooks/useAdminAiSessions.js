import { useCallback, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

/**
 * 管理员会话审计：拉取全量用户 AI 会话摘要（GET /system/ai-sessions，仅 admin）。
 * 筛选参数直接透传给后端做服务端过滤。
 */
export function useAdminAiSessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadAllSessions = useCallback(async (filters = {}) => {
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined && value !== null),
      )
      const payload = await apiClient.get('/system/ai-sessions', params)
      const items = normalizeItems(unwrap(payload))
      setSessions(items)
      return items
    } catch (err) {
      const message = `会话审计加载失败：${err.message || '请求失败'}`
      setError(message)
      setSessions([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return { sessions, loading, error, loadAllSessions }
}
