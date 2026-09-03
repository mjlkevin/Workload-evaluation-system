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
    globalVersion: record.versionCode || record.sourceGlobalVersionRecordId || (projectId ? `PROJECT-${projectId}` : ''),
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
  { ic: '▣', lb: '项目数', num: null, state: 'loading', sub: '加载中…', icBg: 'var(--brand-soft)', icCo: 'var(--brand-ink)' },
  { ic: '≡', lb: '需求条目', num: null, state: 'loading', sub: '加载中…', icBg: 'var(--accent-soft)', icCo: 'var(--accent)' },
  { ic: '⏱', lb: '评估人天', num: null, state: 'loading', sub: '加载中…', icBg: 'var(--info-soft)', icCo: 'var(--info)' },
  { ic: '⚇', lb: '参与成员', num: null, state: 'loading', sub: '加载中…', icBg: 'var(--ok-soft)', icCo: 'var(--ok)' },
]
const EMPTY_ROWS = []
const EMPTY_DASHBOARD = { kpi: DEFAULT_KPI, plans: EMPTY_ROWS, feed: EMPTY_ROWS }

// 指标卡按位对应四个数据源；源挂了不能退化成 0，否则「取不到」和「真的是 0」在界面上长得一样。
const KPI_SOURCES = [
  { label: '项目', run: () => apiClient.get('/project-evaluations') },
  { label: '需求条目', run: () => apiClient.get('/versions', { type: 'requirementImport' }) },
  { label: '评估人天', run: () => apiClient.get('/versions', { type: 'assessment' }) },
  { label: '成员', run: () => apiClient.get('/auth/users') },
]

function settle(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (reason) => ({ ok: false, reason })
  )
}

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
    if (!enabled) return { ...fallback, error: null }

    // 并发请求 4 个端点；逐源记账，一个源失败只影响它自己那张卡
    const settled = await Promise.all(KPI_SOURCES.map((source) => settle(source.run())))
    const failed = KPI_SOURCES.filter((_, i) => !settled[i].ok)

    const ok = (i) => settled[i].ok
    const projectPayload = ok(0) ? settled[0].value : null
    const requirementPayload = ok(1) ? settled[1].value : null
    const assessmentPayload = ok(2) ? settled[2].value : null
    const usersPayload = ok(3) ? settled[3].value : null

    const projectRecords = unwrapList(projectPayload)
    const requirementRecords = unwrapList(requirementPayload)
    const assessmentRecords = unwrapList(assessmentPayload)
    const users = unwrapUsers(usersPayload)

    // KPI 聚合
    const kpiValues = [
      projectRecords.length,
      requirementRecords.length,
      Math.round(sumDays(assessmentRecords)),
      users.length,
    ]
    const kpiSubs = [`共 ${projectRecords.length} 个项目`, `共 ${requirementRecords.length} 条`, `累计 ${kpiValues[2]} 人天`, `共 ${users.length} 人`]
    const kpi = DEFAULT_KPI.map((item, i) => ({
      ...item,
      state: ok(i) ? 'ok' : 'error',
      num: ok(i) ? kpiValues[i] : null,
      sub: ok(i) ? kpiSubs[i] : `${KPI_SOURCES[i].label}取数失败`,
    }))

    // Plans（项目评估方案列表）
    const plans = [...localPlans, ...projectRecords.map(mapProjectEvaluationToPlan)]

    // Feed（从所有版本记录聚合）
    const allRecords = [
      ...assessmentRecords.map((r) => ({ ...r, type: 'assessment' })),
      ...requirementRecords.map((r) => ({ ...r, type: 'requirementImport' })),
    ]
    const feed = generateFeed(allRecords)

    const error = failed.length
      ? new Error(`${failed.map((source) => source.label).join('、')}加载失败，数据可能不完整`)
      : null

    return { kpi, plans, feed, error }
  }, [enabled, fallback, localPlans])

  const applyResult = useCallback((result) => {
    const { error: loadError, ...dashboard } = result
    setData(dashboard)
    setError(loadError ?? null)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setData({
        ...EMPTY_DASHBOARD,
        plans: [...localPlans],
        kpi: DEFAULT_KPI.map((item) => item.lb === '项目数' ? { ...item, num: localPlans.length, state: 'ok', sub: localPlans.length ? '本地新增' : '无数据' } : { ...item, state: 'ok', sub: '无数据' }),
      })
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    load()
      .then((result) => {
        if (!cancelled) applyResult(result)
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
  }, [enabled, fallback, load, localPlans, applyResult])

  const refetch = useCallback(() => {
    if (!enabled) {
      setData({
        ...EMPTY_DASHBOARD,
        plans: [...localPlans],
        kpi: DEFAULT_KPI.map((item) => item.lb === '项目数' ? { ...item, num: localPlans.length, state: 'ok', sub: localPlans.length ? '本地新增' : '无数据' } : { ...item, state: 'ok', sub: '无数据' }),
      })
      return
    }
    setLoading(true)
    setError(null)
    load()
      .then(applyResult)
      .catch((err) => {
        setError(err)
        setData(EMPTY_DASHBOARD)
      })
      .finally(() => setLoading(false))
  }, [enabled, fallback, localPlans, load, applyResult])

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
      kpi: prev.kpi.map((item) => item.lb === '项目数' ? { ...item, num: item.state === 'error' ? item.num : Number(item.num || 0) + 1, sub: '刚刚新增' } : item),
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
