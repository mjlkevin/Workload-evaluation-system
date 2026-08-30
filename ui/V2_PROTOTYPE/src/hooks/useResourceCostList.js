import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { mapVcsStatus } from './mapVersionStatus.js'
import { unwrapList } from '../api/utils.js'

export function mapResourceCostToVM(record = {}) {
  const payload = record.payload || {}

  return {
    id: record.id || record.versionRecordId || '',
    projectName: payload.projectName || record.projectName || '',
    globalVersion: record.baseCode || record.globalVersion || '',
    resourceVersion: record.versionCode || record.resourceVersion || '',
    quoteMode: payload.quoteMode || record.quoteMode || '标准实施',
    totalDays: Number(payload.totalDays ?? record.totalDays ?? 0),
    orgCount: Number(payload.orgCount ?? record.orgCount ?? 1),
    status: mapVcsStatus(record),
    owner: record.checkedOutByUsername || record.updatedByUsername || record.owner || '—',
    updatedAt: (record.updatedAt || record.createdAt || '').slice(0, 10),
    raw: record,
  }
}

export default function useResourceCostList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapResourceCostToVM),
    [fallbackData]
  )
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  // 加载失败和创建失败分开记账：合并成一个 error 后，创建失败会被念成「加载列表失败」。
  // 命名跟 useReviewList 保持一致。
  const [loadError, setLoadError] = useState(null)
  const [createError, setCreateError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [localRows, setLocalRows] = useState([])

  const load = useCallback(async () => {
    const payload = await apiClient.get('/versions', { type: 'resource' })
    const mapped = unwrapList(payload).map(mapResourceCostToVM)
    return mapped
  }, [])

  const refetch = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setRows(await load())
    } catch (err) {
      setLoadError(err)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [load, fallbackRows])

  const create = useCallback(async () => {
    const now = new Date()
    const seq = String(now.getTime()).slice(-5)
    const local = mapResourceCostToVM({
      id: `local-resource-${seq}`,
      versionCode: `RS-${seq}`,
      baseCode: 'GL-LOCAL',
      status: 'draft',
      checkoutStatus: 'checked_in',
      updatedAt: now.toISOString(),
      updatedByUsername: 'mjlkevin',
      payload: {
        projectName: '新建资源成本',
        quoteMode: '标准实施',
        totalDays: 0,
        orgCount: 1,
      },
    })
    if (!enabled) {
      setLocalRows((prev) => [local, ...prev])
      setRows((prev) => [local, ...prev])
      return local.id
    }
    setCreating(true)
    setCreateError(null)
    try {
      const payload = await apiClient.post('/versions', { type: 'resource' })
      const record = payload?.data?.record || payload?.data || payload
      await refetch()
      return record.id || record.versionRecordId
    } catch (err) {
      setLocalRows((prev) => [local, ...prev])
      setRows((prev) => [local, ...prev])
      setCreateError(err)
      return local.id
    } finally {
      setCreating(false)
    }
  }, [enabled, refetch])

  const remove = useCallback(async (versionCode) => {
    if (!enabled) return
    await apiClient.delete(`/versions/resource/${versionCode}`)
    await refetch()
  }, [enabled, refetch])

  useEffect(() => {
    if (!enabled) {
      setRows([...localRows])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)

    load()
      .then((mapped) => { if (!cancelled) setRows(mapped) })
      .catch((err) => { if (!cancelled) { setLoadError(err); setRows([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [enabled, fallbackRows, load, localRows])

  return { rows, loading, loadError, createError, creating, refetch, create, remove }
}
