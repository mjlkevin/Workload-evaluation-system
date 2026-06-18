import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList } from '../api/utils.js'

const DEFAULT_PARAMS = { limit: 50 }

function projectId(raw = {}) {
  return raw.id || raw.historyProjectId || raw.projectId || raw.sourceAssessmentVersionId || ''
}

function moneyToWan(value) {
  if (typeof value !== 'number') return 0
  return value > 10000 ? value / 10000 : value
}

function yearOf(raw = {}) {
  const source = raw.year || raw.closedAt || raw.createdAt || raw.updatedAt
  if (typeof source === 'number') return source
  const year = source ? new Date(source).getFullYear() : NaN
  return Number.isFinite(year) ? year : new Date().getFullYear()
}

export function mapHistoryProjectToVM(raw = {}, extra = {}) {
  const source = raw.project || raw
  const id = projectId(source)
  const industry = source.industry || '未标注行业'
  const scale = source.scale || '未标注规模'
  const totalDays = Number(source.totalDays ?? source.actualDays ?? source.estimatedDays ?? 0)
  const totalAmount = Number(source.totalAmount ?? moneyToWan(source.actualCost ?? source.estimatedCost))
  const similarity = Math.max(0, Math.min(100, Math.round(extra.similarity ?? source.similarity ?? source.similarityScore ?? 0)))

  return {
    id,
    projectName: source.projectName || source.name || `${industry}历史项目`,
    customer: source.customer || source.customerName || '历史客户',
    industry,
    scale,
    modules: Array.isArray(source.modules) ? source.modules : [],
    version: source.version || source.versionCode || (source.sourceAssessmentVersionId ? '历史版本' : 'v01'),
    similarity,
    totalDays,
    totalAmount,
    year: yearOf(source),
    status: source.status || '已归档',
    updatedAt: source.updatedAt || source.closedAt || source.createdAt || '',
    riskTags: Array.isArray(source.riskTags) ? source.riskTags : [],
    delayReason: source.delayReason || '',
    estimatedActualDiff: extra.estimatedActualDiff || source.estimatedActualDiff || null,
    raw: source,
  }
}

function mergeSimilar(projects, similarResults) {
  if (!similarResults.length) return projects
  const similarityById = new Map()
  for (const item of similarResults) {
    const source = item.project || item
    const id = projectId(source)
    if (id) {
      similarityById.set(id, {
        similarity: item.similarityScore ?? item.similarity ?? source.similarity,
        estimatedActualDiff: item.estimatedActualDiff,
      })
    }
  }
  return projects.map((p) => similarityById.has(p.id)
    ? { ...p, ...similarityById.get(p.id) }
    : p)
}

export default function useHistoryProjects({
  enabled = isAuthenticated(),
  fallbackData = [],
  params = DEFAULT_PARAMS,
  similarQuery = null,
} = {}) {
  const fallbackProjects = useMemo(() => fallbackData.map(mapHistoryProjectToVM), [fallbackData])
  const paramsKey = JSON.stringify(params || {})
  const similarKey = JSON.stringify(similarQuery || {})
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)
  const [fetchId, setFetchId] = useState(0)
  const [creating, setCreating] = useState(false)
  const [localProjects, setLocalProjects] = useState([])

  const load = useCallback(async () => {
    const listPayload = await apiClient.get('/history/projects', params)
    const list = unwrapList(listPayload).map(mapHistoryProjectToVM)
    const hasSimilarQuery = similarQuery?.industry && similarQuery?.scale

    if (!hasSimilarQuery) return list

    const similarPayload = await apiClient.get('/history/similar', {
      industry: similarQuery.industry,
      scale: similarQuery.scale,
      modules: Array.isArray(similarQuery.modules) ? similarQuery.modules.join(',') : similarQuery.modules,
    })
    const similarRows = unwrapList(similarPayload)
    return mergeSimilar(list, similarRows).map((p) => ({ ...p, similarity: Math.round(p.similarity || 0) }))
  }, [params, similarQuery])

  useEffect(() => {
    if (!enabled) {
      setProjects([...localProjects])
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    load()
      .then((mapped) => {
        if (!cancelled) setProjects([...localProjects, ...mapped])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setProjects([...localProjects])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, fallbackProjects, load, fetchId, localProjects])

  const refetch = useCallback(() => {
    setFetchId((n) => n + 1)
  }, [])

  const remove = useCallback(async (id) => {
    if (String(id).startsWith('local-')) {
      setLocalProjects((prev) => prev.filter((p) => p.id !== id))
      setProjects((prev) => prev.filter((p) => p.id !== id))
      return
    }
    if (!enabled) return
    await apiClient.delete(`/history/projects/${id}`)
    refetch()
  }, [enabled, refetch])

  const create = useCallback(async () => {
    setCreating(true)
    const now = new Date()
    const local = mapHistoryProjectToVM({
      id: `local-history-${String(now.getTime()).slice(-5)}`,
      projectName: '新建历史项目',
      customer: '待补充客户',
      industry: '制造-离散',
      scale: '1000 人',
      modules: ['实施评估'],
      estimatedDays: 0,
      actualDays: 0,
      estimatedCost: 0,
      actualCost: 0,
      similarity: 0,
      status: '已归档',
      closedAt: now.toISOString(),
    })
    setLocalProjects((prev) => [local, ...prev])
    setProjects((prev) => [local, ...prev])

    if (!enabled) {
      setCreating(false)
      return local.id
    }

    try {
      const payload = await apiClient.post('/history/projects', {
        industry: local.industry,
        scale: local.scale,
        modules: local.modules,
        estimatedDays: 0,
        actualDays: 0,
        estimatedCost: 0,
        actualCost: 0,
        closedAt: now.toISOString(),
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

  return { projects, loading, error, refetch, remove, create, creating }
}
