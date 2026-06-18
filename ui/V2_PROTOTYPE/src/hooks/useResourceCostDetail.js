import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { mapVcsStatus } from './mapVersionStatus.js'
import { unwrapSingle } from '../api/utils.js'

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

    apiClient.get(`/versions/${id}`)
      .then((payload) => {
        if (cancelled) return
        const vm = mapResourceCostDetailToVM(unwrapSingle(payload))
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

  const checkout = useCallback(() => withAction('checkout', async () => {
    await apiClient.post(`/versions/${id}/checkout`)
    setData((prev) => prev ? { ...prev, checkedOut: true, status: '已检出' } : prev)
  }), [id, withAction])
  const checkin = useCallback(() => withAction('checkin', async () => {
    await apiClient.post(`/versions/${id}/checkin`)
    setData((prev) => prev ? { ...prev, checkedOut: false, status: '已检入' } : prev)
  }), [id, withAction])
  const undoCheckout = useCallback(() => withAction('undoCheckout', async () => {
    await apiClient.post(`/versions/${id}/undo-checkout`)
    setData((prev) => prev ? { ...prev, checkedOut: false, status: '已检入' } : prev)
  }), [id, withAction])
  const promote = useCallback(() => withAction('promote', () => apiClient.post(`/versions/${id}/promote`)), [id, withAction])
  const forceUnlock = useCallback(() => withAction('forceUnlock', async () => {
    await apiClient.patch(`/versions/${id}/force-unlock`)
    setData((prev) => prev ? { ...prev, checkedOut: false, status: '已检入' } : prev)
  }), [id, withAction])
  const saveDraft = useCallback(() => withAction('saveDraft', () => apiClient.patch(`/versions/${id}/save-draft`)), [id, withAction])

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
    actions: { checkout, checkin, undoCheckout, promote, forceUnlock, saveDraft },
    actionLoading,
  }
}
