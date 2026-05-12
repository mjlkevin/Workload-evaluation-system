import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList } from '../api/utils.js'

function deriveProgress(status) {
  // 后端无 progress 字段，前端由三态 status 推导
  if (status === '已完成') return 100
  if (status === '进行中') return 50
  return 0
}

export function mapWbsItemToVM(record = {}) {
  const status = record.status || '未开始'

  return {
    id: record.id || '',
    name: record.taskName || record.name || '',
    assignee: record.owner || record.assignee || '—',
    start: record.start || '',
    end: record.end || '',
    progress: deriveProgress(status),
    status,
    raw: record,
  }
}

export default function useWbsList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapWbsItemToVM),
    [fallbackData]
  )
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)
  const [fetchId, setFetchId] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setRows([])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiClient.get('/wbs')
      .then((payload) => {
        if (cancelled) return
        const mapped = unwrapList(payload).map(mapWbsItemToVM)
        setRows(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, fallbackRows, fetchId])

  const refetch = useCallback(() => {
    setFetchId((n) => n + 1)
  }, [])

  return { rows, loading, error, refetch }
}
