import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList } from '../api/utils.js'

const KNOWN_DEV_STATUSES = new Set([
  '已检出', '已检入', '进行中', '待评审', '已归档',
  '已发布', '评审中', '已通过', '驳回', '已完成',
])

function mapDevStatus(record) {
  // 若后端已返回中文状态，直接透传
  if (KNOWN_DEV_STATUSES.has(record.status)) return record.status

  // 英文枚举映射
  const s = record.status
  if (s === 'draft') return '进行中'
  if (s === 'reviewed') return '已检入'
  if (s === 'published') return '已检入'

  // checkout 字段映射
  if (record.checkoutStatus === 'checked_out') return '已检出'

  return '进行中'
}

function sumItemsDays(items = []) {
  if (!Array.isArray(items)) return 0
  return items.reduce((sum, it) => sum + (Number(it.totalDays) || 0), 0)
}

export function mapDevAssessmentToVM(record = {}) {
  const snap = record.contextSnapshot || record.payload || {}
  const items = record.items || []
  const payloadTotal = Number(record.payload?.totalDays ?? NaN)
  const computedTotal = sumItemsDays(items)
  const totalDays = Number.isFinite(payloadTotal) ? payloadTotal : computedTotal

  return {
    id: record.id || record.assessmentVersionId || '',
    projectName: snap.projectName || record.projectName || record.payload?.projectName || '未命名项目',
    globalVersion: snap.globalVersion || record.globalVersion || record.payload?.globalVersion || '',
    devVersion: record.versionCode || record.devVersion || record.payload?.versionCode || '',
    assessor: record.assessedByUsername || record.assessor || '—',
    totalDays: Number.isFinite(totalDays) ? Number(totalDays) : 0,
    status: mapDevStatus(record),
    owner: record.updatedByUsername || record.checkedOutByUsername || record.assessedByUsername || '—',
    updatedAt: (record.updatedAt || record.createdAt || '').slice(0, 10),
    raw: record,
  }
}

export default function useDevAssessmentList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapDevAssessmentToVM),
    [fallbackData]
  )
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  // 加载失败和创建失败分开记账：合并成一个 error 后，页面上只能选一句文案，
  // 创建失败会被念成「加载列表失败」。命名跟 useReviewList 保持一致。
  const [loadError, setLoadError] = useState(null)
  const [createError, setCreateError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [localRows, setLocalRows] = useState([])

  const load = useCallback(async () => {
    const payload = await apiClient.get('/dev-assessments')
    const mapped = unwrapList(payload).map(mapDevAssessmentToVM)
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
    const local = mapDevAssessmentToVM({
      id: `local-dev-${seq}`,
      versionCode: `DV-${seq}`,
      status: 'draft',
      updatedAt: now.toISOString(),
      assessedByUsername: 'mjlkevin',
      payload: {
        projectName: '新建开发评估',
        globalVersion: 'GL-LOCAL',
        totalDays: 0,
      },
    })
    if (!enabled) {
      setLocalRows((prev) => [local, ...prev])
      setRows((prev) => [local, ...prev])
      return local.id
    }
    setCreating(true)
    try {
      setCreateError(null)
      const payload = await apiClient.post('/dev-assessments')
      const record = payload?.data || payload
      await refetch()
      return record.id || record.devAssessmentId || record.assessmentVersionId
    } catch (err) {
      setLocalRows((prev) => [local, ...prev])
      setRows((prev) => [local, ...prev])
      setCreateError(err)
      return local.id
    } finally {
      setCreating(false)
    }
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

  return { rows, loading, loadError, createError, creating, refetch, create }
}
