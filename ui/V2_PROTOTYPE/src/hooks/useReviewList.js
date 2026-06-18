import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList } from '../api/utils.js'

function mapReviewStatus(record) {
  const verdict = record.verdict
  const status = record.status

  if (verdict === 'pass') return '已通过'
  if (verdict === 'reject') return '驳回'
  if (status === 'pending' || verdict === undefined || verdict === null) return '待评审'

  // 防御：若后端已返回中文状态，直接透传
  const known = new Set(['待评审', '已通过', '驳回'])
  if (known.has(status)) return status

  return '待评审'
}

function formatReviewers(record) {
  // 优先取 reviewerUsername（单条），若是数组则 join
  const r = record.reviewerUsername || record.reviewerName
  if (typeof r === 'string') return r
  if (Array.isArray(record.reviewers)) {
    return record.reviewers.map((x) => (typeof x === 'string' ? x : x.username || x.name)).join('，')
  }
  if (Array.isArray(record.reviewerUserIds)) return record.reviewerUserIds.join('，')
  return '—'
}

export function mapReviewToVM(record = {}) {
  const snap = record.contextSnapshot || {}

  return {
    id: record.id || '',
    projectName: snap.projectName || record.projectName || record.versionId || '—',
    version: record.versionCode || record.versionId || '',
    reviewers: formatReviewers(record),
    deadline: (record.deadline || '').slice(0, 10),
    status: mapReviewStatus(record),
    updatedAt: (record.updatedAt || record.createdAt || '').slice(0, 10),
    raw: record,
  }
}

export default function useReviewList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapReviewToVM),
    [fallbackData]
  )
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)
  const [fetchId, setFetchId] = useState(0)
  const [creating, setCreating] = useState(false)
  const [localRows, setLocalRows] = useState([])

  useEffect(() => {
    if (!enabled) {
      setRows([...localRows])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiClient.get('/pm/reviews')
      .then((payload) => {
        if (cancelled) return
        const mapped = unwrapList(payload).map(mapReviewToVM)
        setRows([...localRows, ...mapped])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setRows([...localRows])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, fallbackRows, fetchId, localRows])

  const refetch = useCallback(() => {
    setFetchId((n) => n + 1)
  }, [])

  const create = useCallback(async () => {
    setCreating(true)
    const now = new Date()
    const local = mapReviewToVM({
      id: `REV-LOCAL-${String(now.getTime()).slice(-5)}`,
      status: 'pending',
      verdict: null,
      reviewerUsername: 'mjlkevin',
      versionCode: '待关联版本',
      deadline: now.toISOString(),
      updatedAt: now.toISOString(),
      contextSnapshot: { projectName: '新建评审单' },
    })
    setLocalRows((prev) => [local, ...prev])
    setRows((prev) => [local, ...prev])

    if (!enabled) {
      setCreating(false)
      return local.id
    }

    try {
      const payload = await apiClient.post('/pm/reviews', {
        notes: '从前端评审列表新建',
        checklist: {
          deliverablesComplete: false,
          methodologySevenPhases: false,
          rateCardCorrect: false,
          narrativeComplete: false,
          assumptionsDocumented: false,
        },
      })
      const record = payload?.data || payload
      refetch()
      return record.id || local.id
    } catch (err) {
      setError(err)
      return local.id
    } finally {
      setCreating(false)
    }
  }, [enabled, refetch])

  return { rows, loading, error, refetch, create, creating }
}
