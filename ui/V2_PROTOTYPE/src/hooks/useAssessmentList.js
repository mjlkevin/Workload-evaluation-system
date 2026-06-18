import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { mapVcsStatus } from './mapVersionStatus.js'
import { unwrapList } from '../api/utils.js'

export function mapAssessmentToVM(record = {}) {
  const payload = record.payload || {}
  const detailId = record.id || record.versionRecordId || record.versionId || record.versionCode || record.assessmentVersion || ''

  return {
    id: detailId,
    projectName: payload.projectName || record.projectName || '',
    productLine: payload.productLine || record.productLine || '未标注',
    globalVersion: record.baseCode || record.globalVersion || record.versionCode || '',
    assessmentVersion: record.versionCode || record.assessmentVersion || '',
    quoteMode: payload.quoteMode || record.quoteMode || '标准实施',
    totalDays: Number(payload.totalDays ?? record.totalDays ?? 0),
    orgCount: Number(payload.orgCount ?? record.orgCount ?? 1),
    difficultyFactor: Number(payload.difficultyFactor ?? record.difficultyFactor ?? 1.0),
    status: mapVcsStatus(record),
    owner: record.checkedOutByUsername || record.updatedByUsername || record.owner || '—',
    updatedAt: (record.updatedAt || '').slice(0, 10),
    raw: record,
  }
}

export default function useAssessmentList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallbackRows = useMemo(
    () => fallbackData.map(mapAssessmentToVM),
    [fallbackData]
  )
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [localRows, setLocalRows] = useState([])

  const load = useCallback(async () => {
    const payload = await apiClient.get('/versions', { type: 'assessment' })
    const mapped = unwrapList(payload).map(mapAssessmentToVM)
    return mapped
  }, [])

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await load())
    } catch (err) {
      setError(err)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [load, fallbackRows])

  const create = useCallback(async () => {
    const now = new Date()
    const seq = String(now.getTime()).slice(-5)
    const local = mapAssessmentToVM({
      id: `local-assessment-${seq}`,
      versionCode: `IA-${seq}`,
      baseCode: 'GL-LOCAL',
      status: 'draft',
      checkoutStatus: 'checked_in',
      updatedAt: now.toISOString(),
      updatedByUsername: 'mjlkevin',
      payload: {
        projectName: '新建实施评估',
        productLine: '金蝶AI星空',
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
    try {
      const payload = await apiClient.post('/versions', { type: 'assessment' })
      const record = payload?.data?.record || payload?.data || payload
      await refetch()
      return record.id || record.versionRecordId
    } catch (err) {
      setLocalRows((prev) => [local, ...prev])
      setRows((prev) => [local, ...prev])
      setError(err)
      return local.id
    } finally {
      setCreating(false)
    }
  }, [enabled, refetch])

  const remove = useCallback(async (versionCode) => {
    if (!enabled) return
    await apiClient.delete(`/versions/assessment/${versionCode}`)
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
    setError(null)

    load()
      .then((mapped) => { if (!cancelled) setRows(mapped) })
      .catch((err) => { if (!cancelled) { setError(err); setRows([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [enabled, fallbackRows, load, localRows])

  return { rows, loading, error, creating, refetch, create, remove }
}
