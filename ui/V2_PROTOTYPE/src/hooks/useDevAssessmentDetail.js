import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapSingle } from '../api/utils.js'

export function mapDevAssessmentItemToVM(raw = {}) {
  return {
    id: raw.id || raw.moduleId || '',
    group: raw.domain || raw.group || raw.category || '未分组',
    name: raw.module || raw.description || raw.name || '未命名',
    base: Number(raw.codingDays ?? raw.baseDays ?? raw.base ?? 0),
    diff: Number(raw.difficulty ?? raw.diff ?? 1),
    factor: Number(raw.factor ?? raw.complexityFactor ?? 1.0),
    status: raw.status || '未开始',
  }
}

export function mapDevAssessmentDetailToVM(record = {}) {
  const payload = record.payload || {}
  const itemsRaw = payload.items || record.items || []
  const items = itemsRaw.map(mapDevAssessmentItemToVM)

  return {
    id: record.id || record.devAssessmentId || '',
    code: record.versionCode || record.baseCode || record.code || '',
    title: payload.title || record.title || '开发评估详情',
    status: record.checkoutStatus === 'checked_out' ? '已检出' : '已检入',
    version: record.versionCode || record.version || '',
    totalDays: Number(payload.totalDays ?? record.totalDays ?? 0),
    evaluator: record.checkedOutByUsername || record.owner || '—',
    items,
    groups: Array.from(new Set(items.map((i) => i.group))),
    raw: record,
  }
}

export default function useDevAssessmentDetail({
  id,
  enabled = isAuthenticated(),
  fallbackData = null,
} = {}) {
  const fallbackVM = useMemo(
    () => (fallbackData ? mapDevAssessmentDetailToVM(fallbackData) : null),
    [fallbackData]
  )

  const [data, setData] = useState(fallbackVM)
  const [loading, setLoading] = useState(Boolean(enabled && id))
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState({})

  const withAction = useCallback(async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      await task()
      return { success: true, error: null }
    } catch (err) {
      return { success: false, error: err?.message || '操作失败' }
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  useEffect(() => {
    if (!enabled || !id) {
      setData(fallbackVM)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiClient.get(`/dev-assessments/${id}`)
      .then((payload) => {
        if (cancelled) return
        const vm = mapDevAssessmentDetailToVM(unwrapSingle(payload))
        setData(vm || fallbackVM)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setData(fallbackVM)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, id, fallbackVM])

  const save = useCallback(() => withAction('save', async () => {
    await apiClient.patch(`/versions/${id}/save-draft`, { payload: data?.raw?.payload ?? {} })
  }), [id, data, withAction])

  const merge = useCallback(() => withAction('merge', async () => {
    await apiClient.post(`/versions/${id}/checkin`)
    alert('已检入，合并到实施评估请在关联页面操作')
  }), [id, withAction])

  const checkout = useCallback(() => withAction('checkout', async () => {
    await apiClient.post(`/versions/${id}/checkout`)
    setData((current) => current ? { ...current, status: '已检出' } : current)
  }), [id, withAction])
  const checkin = useCallback(() => withAction('checkin', async () => {
    await apiClient.post(`/versions/${id}/checkin`)
    setData((current) => current ? { ...current, status: '已检入' } : current)
  }), [id, withAction])
  const undoCheckout = useCallback(() => withAction('undoCheckout', async () => {
    await apiClient.post(`/versions/${id}/undo-checkout`)
    setData((current) => current ? { ...current, status: '已检入' } : current)
  }), [id, withAction])

  const aiSkuSuggest = useCallback(() => withAction('aiSkuSuggest', async () => {
    const items = data?.items || fallbackVM?.items || []
    const payload = await apiClient.post('/ai/chat', {
      messages: [{ role: 'user', content: `请根据以下开发条目，按 SKU 推断补充子项：${JSON.stringify(items)}` }],
    })
    return payload?.data || payload
  }), [id, data, fallbackVM, withAction])

  const aiHistorySuggest = useCallback(() => withAction('aiHistorySuggest', async () => {
    const payload = await apiClient.get('/history/similar', {
      industry: (data?.raw?.payload?.industry || '离散制造'),
      scale: (data?.raw?.payload?.scale || '中大型'),
    })
    return payload?.data || payload
  }), [id, data, withAction])

  return {
    ...(data || fallbackVM || {}),
    items: data?.items || fallbackVM?.items || [],
    groups: data?.groups || fallbackVM?.groups || [],
    loading,
    error,
    actions: { save, merge, checkout, checkin, undoCheckout, aiSkuSuggest, aiHistorySuggest },
    actionLoading,
  }
}
