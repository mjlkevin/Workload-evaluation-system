import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrapList } from '../api/utils.js'

/**
 * 状态机目录（系统管理「状态机规则」可视化真源）：
 * GET /system/state-machines 一次加载全量目录，纯只读、不落库。
 */
export function useStateMachineCatalog() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await apiClient.get('/system/state-machines')
      setItems(unwrapList(payload))
    } catch (err) {
      setError(`状态机目录加载失败：${err.message || '请求失败'}`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { items, loading, error, load }
}
