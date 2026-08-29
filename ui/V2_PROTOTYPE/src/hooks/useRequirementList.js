import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList } from '../api/utils.js'

const STATUS_LABELS = {
  draft: '进行中',
  reviewed: '评审中',
  published: '已发布',
  archived: '已归档',
}

export function mapRequirementToVM(record = {}) {
  const payload = record.payload || {}
  const basicProjectInfo = payload.basicInfo || payload.basicProjectInfo || {}

  return {
    id: record.id || '',
    globalVersion: record.baseCode || record.globalVersion || '',
    versionCode: record.versionCode || '',
    projectName: payload.projectName || basicProjectInfo.projectName || record.projectName || '',
    productLine: payload.productLines?.[0] || payload.productLine || record.productLine || '未标注',
    customer: payload.customerName || basicProjectInfo.customerName || record.customer || '',
    status: STATUS_LABELS[record.status] || record.status || '进行中',
    creator: record.createdByUsername || record.creator || '—',
    updater: record.updatedByUsername || record.updater || '—',
    updatedAt: (record.updatedAt || '').slice(0, 10),
    raw: record,
  }
}

export default function useRequirementList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapRequirementToVM),
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
    const payload = await apiClient.get('/versions', { type: 'requirementImport' })
    const mapped = unwrapList(payload).map(mapRequirementToVM)
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
    const local = mapRequirementToVM({
      id: `RQ-LOCAL-${seq}`,
      versionCode: `RQ-LOCAL-${seq}-V01`,
      baseCode: 'GL-LOCAL',
      status: 'draft',
      updatedAt: now.toISOString(),
      createdByUsername: 'mjlkevin',
      updatedByUsername: 'mjlkevin',
      payload: {
        projectName: '新建需求单',
        customerName: '待补充客户',
        productLines: ['金蝶AI星空'],
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
      const payload = await apiClient.post('/versions', { type: 'requirementImport' })
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
    await apiClient.delete(`/versions/requirementImport/${versionCode}`)
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
