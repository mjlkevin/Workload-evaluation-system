import { useCallback, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

/**
 * AI 工具清单：只读拉取 GET /system/ai-tools（需 system:manage）。
 * 清单由后端每次请求从运行时 ToolRegistry 现取，前端不缓存、不提供任何开关。
 */
export function useAiToolInventory() {
  const [tools, setTools] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadTools = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await apiClient.get('/system/ai-tools')
      const items = normalizeItems(unwrap(payload))
      setTools(items)
      return items
    } catch (err) {
      setError(`工具清单加载失败：${err.message || '请求失败'}`)
      setTools([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return { tools, loading, error, loadTools }
}
