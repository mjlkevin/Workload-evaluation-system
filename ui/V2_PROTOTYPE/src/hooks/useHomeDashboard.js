import { useEffect, useMemo, useState, useCallback } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList, unwrapUsers } from '../api/utils.js'

function sliceDate(d) {
  return typeof d === 'string' ? d.slice(0, 10) : ''
}

export function mapProjectEvaluationToPlan(record = {}) {
  const projectId = record.projectId || record.id || ''
  return {
    id: projectId,
    projectName: record.projectName || record.customerName || '未命名项目',
    customerName: record.customerName || '',
    industry: record.industry || '',
    globalVersion: record.sourceGlobalVersionRecordId || (projectId ? `PROJECT-${projectId}` : ''),
    status: record.status === 'published' ? '已发布' : record.status === 'reviewing' ? '待评审' : record.status === 'active' ? '进行中' : '草稿',
    mandays: Number(record.totalDays ?? record.mandays ?? 0),
    updatedAt: sliceDate(record.updatedAt),
    owner: record.ownerUsername || '',
    raw: record,
  }
}

function sumDays(records) {
  return records.reduce((s, r) => s + Number(r.payload?.totalDays ?? r.totalDays ?? 0), 0)
}

const FEED_TYPE_LABELS = {
  assessment: '更新了 实施评估',
  requirementImport: '完成了 需求评审',
  resource: '更新了 资源成本',
  dev: '检出了 开发评估',
  global: '发布了 总方案',
}

function generateFeed(allRecords) {
  // 取所有 type 的版本记录，按 updatedAt 降序，取前 4 条
  const sorted = [...allRecords]
    .filter((r) => r.updatedAt)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 4)

  return sorted.map((r) => ({
    name: r.updatedByUsername || r.checkedOutByUsername || '系统',
    action: `${FEED_TYPE_LABELS[r.type] || '更新了'} · ${r.versionCode || r.baseCode || ''}`,
    time: r.updatedAt
      ? `${new Date(r.updatedAt).toLocaleDateString('zh-CN')} ${new Date(r.updatedAt).getHours()}:${String(new Date(r.updatedAt).getMinutes()).padStart(2, '0')}`
      : '',
    accent: r.type === 'global',
  }))
}

const DEFAULT_KPI = [
  { ic: '▣', lb: '项目数', num: 0, sub: '加载中…', bar: '0%', icBg: 'var(--brand-soft)', icCo: 'var(--brand-ink)' },
  { ic: '≡', lb: '需求条目', num: 0, sub: '加载中…', bar: '0%', icBg: 'var(--accent-soft)', icCo: 'var(--accent)' },
  { ic: '⏱', lb: '评估人天', num: 0, sub: '加载中…', bar: '0%', icBg: 'var(--info-soft)', icCo: 'var(--info)' },
  { ic: '⚇', lb: '参与成员', num: 0, sub: '加载中…', bar: '0%', icBg: 'var(--ok-soft)', icCo: 'var(--ok)' },
]
const EMPTY_ROWS = []
const EMPTY_DASHBOARD = { kpi: DEFAULT_KPI, plans: EMPTY_ROWS, feed: EMPTY_ROWS }

function createLocalPlan(input = {}) {
  const now = new Date()
  const seq = String(now.getTime()).slice(-5)
  return mapProjectEvaluationToPlan({
    projectId: `local-${seq}`,
    projectName: input.projectName || '新建项目评估',
    customerName: input.customerName || '',
    industry: input.industry || '制造业',
    currentStage: 'rough_estimate',
    status: 'draft',
    updatedAt: now.toISOString(),
    ownerUsername: 'mjlkevin',
    totalDays: 0,
  })
}

export default function useHomeDashboard({
  enabled = isAuthenticated(),
  fallbackData = {},
} = {}) {
  const fallbackKpi = fallbackData.kpi || DEFAULT_KPI
  const fallbackPlans = fallbackData.plans || EMPTY_ROWS
  const fallbackFeed = fallbackData.feed || EMPTY_ROWS

  const fallback = useMemo(
    () => ({ kpi: fallbackKpi, plans: fallbackPlans, feed: fallbackFeed }),
    [fallbackKpi, fallbackPlans, fallbackFeed]
  )

  const [data, setData] = useState(EMPTY_DASHBOARD)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)
  const [localPlans, setLocalPlans] = useState([])

  const load = useCallback(async () => {
    if (!enabled) return fallback

    // 并发请求 4 个端点
    const [
      projectPayload,
      assessmentPayload,
      requirementPayload,
      usersPayload,
    ] = await Promise.all([
      apiClient.get('/project-evaluations').catch(() => ({ data: { items: [] } })),
      apiClient.get('/versions', { type: 'assessment' }).catch(() => ({ data: [] })),
      apiClient.get('/versions', { type: 'requirementImport' }).catch(() => ({ data: [] })),
      apiClient.get('/auth/users').catch(() => ({ data: [] })),
    ])

    const projectRecords = unwrapList(projectPayload)
    const assessmentRecords = unwrapList(assessmentPayload)
    const requirementRecords = unwrapList(requirementPayload)
    const users = unwrapUsers(usersPayload)

    // KPI 聚合
    const kpi = [
      { ...DEFAULT_KPI[0], num: projectRecords.length },
      { ...DEFAULT_KPI[1], num: requirementRecords.length },
      { ...DEFAULT_KPI[2], num: Math.round(sumDays(assessmentRecords)) },
      { ...DEFAULT_KPI[3], num: users.length },
    ]

    // Plans（项目评估方案列表）
    const plans = [...localPlans, ...projectRecords.map(mapProjectEvaluationToPlan)]

    // Feed（从所有版本记录聚合）
    const allRecords = [
      ...assessmentRecords.map((r) => ({ ...r, type: 'assessment' })),
      ...requirementRecords.map((r) => ({ ...r, type: 'requirementImport' })),
    ]
    const feed = generateFeed(allRecords)

    return { kpi, plans, feed }
  }, [enabled, fallback, localPlans])

  useEffect(() => {
    if (!enabled) {
      setData({
        ...EMPTY_DASHBOARD,
        plans: [...localPlans],
        kpi: DEFAULT_KPI.map((item) => item.lb === '项目数' ? { ...item, num: localPlans.length, sub: localPlans.length ? '本地新增' : '无数据' } : { ...item, sub: '无数据' }),
      })
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    load()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setData(EMPTY_DASHBOARD)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled, fallback, load, localPlans])

  const refetch = useCallback(() => {
    if (!enabled) {
      setData({
        ...EMPTY_DASHBOARD,
        plans: [...localPlans],
        kpi: DEFAULT_KPI.map((item) => item.lb === '项目数' ? { ...item, num: localPlans.length, sub: localPlans.length ? '本地新增' : '无数据' } : { ...item, sub: '无数据' }),
      })
      return
    }
    setLoading(true)
    setError(null)
    load()
      .then(setData)
      .catch((err) => {
        setError(err)
        setData(EMPTY_DASHBOARD)
      })
      .finally(() => setLoading(false))
  }, [enabled, fallback, localPlans, load])

  const remove = useCallback(async (versionCode) => {
    if (!enabled) return
    await apiClient.delete(`/versions/global/${versionCode}`)
    refetch()
  }, [enabled, refetch])

  const create = useCallback(async (input = {}) => {
    const localPlan = createLocalPlan(input)
    setLocalPlans((prev) => [localPlan, ...prev])
    setData((prev) => ({
      ...prev,
      plans: [localPlan, ...prev.plans],
      kpi: prev.kpi.map((item) => item.lb === '项目数' ? { ...item, num: Number(item.num || 0) + 1, sub: '刚刚新增' } : item),
      feed: [
        { name: 'mjlkevin', action: `新建了 项目评估 · ${localPlan.projectName}`, time: '刚刚', accent: true },
        ...prev.feed,
      ].slice(0, 4),
    }))

    if (!enabled) return localPlan.id

    try {
      const payload = await apiClient.post('/project-evaluations', {
        projectName: input.projectName || localPlan.projectName,
        customerName: input.customerName || '',
        industry: input.industry || '',
        currentStage: input.currentStage || 'rough_estimate',
        projectStatus: 'draft',
        totalDays: 0,
      })
      const record = payload?.data?.project || payload?.data || payload
      setLocalPlans((prev) => prev.filter((plan) => plan.id !== localPlan.id))
      await refetch()
      return record.projectId || record.id || localPlan.id
    } catch (err) {
      setError(err)
      return localPlan.id
    }
  }, [enabled, refetch])

  return { ...data, loading, error, refetch, remove, create }
}
