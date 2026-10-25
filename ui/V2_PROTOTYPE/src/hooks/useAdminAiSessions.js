import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

/**
 * 管理员会话审计：跨用户摘要（GET /system/ai-sessions，仅 admin）。
 * 筛选参数直接透传；服务端默认最多返回 200 条，没有分页/total 契约。
 */
export function useAdminAiSessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  useEffect(() => () => { requestId.current += 1 }, [])

  // 筛选输入改变时即失效，不能等到防抖后的新请求才挡住旧响应。
  const invalidateSessions = useCallback(() => {
    requestId.current += 1
    setSessions([])
    setError('')
    setLoading(true)
  }, [])

  const loadAllSessions = useCallback(async (filters = {}) => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setSessions([])
    setError('')
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined && value !== null),
      )
      const payload = await apiClient.get('/system/ai-sessions', params)
      const items = normalizeItems(unwrap(payload))
      if (currentRequest !== requestId.current) return []
      setSessions(items)
      return items
    } catch (err) {
      if (currentRequest !== requestId.current) return []
      const message = `会话审计加载失败：${err.message || '请求失败'}`
      setError(message)
      setSessions([])
      return []
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [])

  return { sessions, loading, error, loadAllSessions, invalidateSessions }
}
