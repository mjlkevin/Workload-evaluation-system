import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { mapVcsStatus } from './mapVersionStatus.js'
import { unwrapSingle } from '../api/utils.js'

function unwrapVersionRecord(payload) {
  return payload?.data?.record || payload?.record || unwrapSingle(payload)
}

export function mapResourceCostRowToVM(raw = {}) {
  return {
    name: raw.name || raw.userName || '—',
    unitPrice: Number(raw.unitPrice ?? raw.rate ?? 0),
    plannedDays: Number(raw.plannedDays ?? raw.days ?? 0),
    travelCost: Number(raw.travelCost ?? raw.travel ?? 0),
    months: Array.isArray(raw.months) ? raw.months.map(Number) : [],
  }
}

export function mapResourceCostGroupToVM(raw = {}) {
  const rows = (raw.rows || raw.members || []).map(mapResourceCostRowToVM)
  const hasSubtotal = raw.subtotal && typeof raw.subtotal === 'object'
  const days = hasSubtotal ? Number(raw.subtotal.days) : rows.reduce((s, r) => s + r.plannedDays, 0)
  const amount = hasSubtotal ? Number(raw.subtotal.amount) : rows.reduce((s, r) => s + r.unitPrice * r.plannedDays + r.travelCost, 0)
  return {
    group: raw.group || raw.code || '',
    role: raw.role || raw.title || '未命名',
    color: raw.color || 'var(--brand)',
    subtotal: { days, amount },
    rows,
  }
}

export function mapResourceCostDetailToVM(record = {}) {
  const payload = record.payload || {}
  const groupsRaw = payload.groups || record.groups || []
  const groups = groupsRaw.map(mapResourceCostGroupToVM)

  const months = payload.months || record.months || []
  const totalDays = Number(payload.totalDays ?? record.totalDays ?? groups.reduce((s, g) => s + g.subtotal.days, 0))
  const totalAmount = Number(payload.totalAmount ?? record.totalAmount ?? groups.reduce((s, g) => s + g.subtotal.amount, 0))
  const totalTravel = Number(payload.totalTravel ?? record.totalTravel ?? groups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.travelCost, 0), 0))
  const monthTotals = months.map((_, i) =>
    groups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + (r.months[i] || 0), 0), 0)
  )

  return {
    id: record.id || record.versionRecordId || '',
    code: record.versionCode || record.baseCode || record.code || '',
    globalVersion: record.baseCode || record.globalVersion || '',
    resourceVersion: record.versionCode || record.resourceVersion || '',
    status: mapVcsStatus(record),
    checkedOut: record.checkoutStatus === 'checked_out',
    owner: record.checkedOutByUsername || record.owner || '—',
    groups,
    months,
    totalDays,
    totalAmount,
    totalTravel,
    monthTotals,
    raw: record,
  }
}

export default function useResourceCostDetail({
  id,
  enabled = isAuthenticated(),
  fallbackData = null,
} = {}) {
  const fallbackVM = useMemo(
    () => (fallbackData ? mapResourceCostDetailToVM(fallbackData) : null),
    [fallbackData]
  )

  const [data, setData] = useState(fallbackVM)
  const [loading, setLoading] = useState(Boolean(enabled && id))
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState({})
  const [actionError, setActionError] = useState(null)

  const withAction = useCallback(async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    setActionError(null)
    try {
      const message = await task()
      return { success: true, error: null, message: typeof message === 'string' ? message : null }
    } catch (err) {
      const message = err?.message || '操作失败'
      setActionError(message)
      return { success: false, error: message, message: null }
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

    apiClient.get(`/versions/${id}`)
      .then((payload) => {
        if (cancelled) return
        const vm = mapResourceCostDetailToVM(unwrapVersionRecord(payload))
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

  const refresh = useCallback(async () => {
    const payload = await apiClient.get(`/versions/${id}`)
    setData(mapResourceCostDetailToVM(unwrapVersionRecord(payload)))
  }, [id])

  const checkout = useCallback(() => withAction('checkout', async () => {
    await apiClient.post(`/versions/${id}/checkout`)
    await refresh()
    return '已检出，进入可编辑状态'
  }), [id, refresh, withAction])
  const checkin = useCallback(() => withAction('checkin', async () => {
    await apiClient.post(`/versions/${id}/checkin`)
    await refresh()
    return '已检入，版本已锁定'
  }), [id, refresh, withAction])
  const undoCheckout = useCallback(() => withAction('undoCheckout', async () => {
    await apiClient.post(`/versions/${id}/undo-checkout`)
    await refresh()
    return '已撤销检出，未保存的修改已放弃'
  }), [id, refresh, withAction])
  const promote = useCallback(() => withAction('promote', async () => {
    await apiClient.post(`/versions/${id}/promote`)
    await refresh()
    return '已升版，新版本已生成'
  }), [id, refresh, withAction])
  const forceUnlock = useCallback(() => withAction('forceUnlock', async () => {
    await apiClient.patch(`/versions/${id}/force-unlock`)
    await refresh()
    return '已强制解锁'
  }), [id, refresh, withAction])
  const saveDraft = useCallback(() => withAction('saveDraft', async () => {
    await apiClient.patch(`/versions/${id}/save-draft`, { payload: data?.raw?.payload ?? {} })
    await refresh()
    return `版本已保存（${new Date().toLocaleTimeString('zh-CN')}）`
  }), [id, data, refresh, withAction])

  return {
    ...(data || fallbackVM || {}),
    groups: data?.groups || fallbackVM?.groups || [],
    months: data?.months || fallbackVM?.months || [],
    totalDays: data?.totalDays ?? fallbackVM?.totalDays ?? 0,
    totalAmount: data?.totalAmount ?? fallbackVM?.totalAmount ?? 0,
    totalTravel: data?.totalTravel ?? fallbackVM?.totalTravel ?? 0,
    monthTotals: data?.monthTotals || fallbackVM?.monthTotals || [],
    loading,
    error,
    actionError,
    actions: { checkout, checkin, undoCheckout, promote, forceUnlock, saveDraft },
    actionLoading,
  }
}
