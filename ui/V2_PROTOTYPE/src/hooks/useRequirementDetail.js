import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { mapVcsStatus } from './mapVersionStatus.js'
import { unwrapSingle, unwrapList } from '../api/utils.js'

function sliceDate(d) {
  return typeof d === 'string' ? d.slice(0, 10) : ''
}

function unwrapVersionRecord(payload) {
  return payload?.data?.record || payload?.record || unwrapSingle(payload)
}

function versionFamilyCode(record = {}) {
  return record.baseCode || record.payload?.globalVersionCode || record.versionCode || ''
}

function mapRequirementVersionHistory(record = {}, currentId = '') {
  return {
    id: record.id || record.versionRecordId || record.versionCode || '',
    version: record.versionCode || record.version || '—',
    baseCode: versionFamilyCode(record),
    status: mapVcsStatus(record),
    checkoutStatus: record.checkoutStatus === 'checked_out' ? '已检出' : '已检入',
    docStatus: record.versionDocStatus === 'reviewed' ? '已审核' : '草稿',
    owner: record.updatedByUsername || record.checkedOutByUsername || record.createdByUsername || '系统',
    time: record.updatedAt || record.createdAt || '',
    note: record.checkinNote || record.payload?.checkinNote || (record.isHistoricalArchive ? '历史归档' : '当前版本'),
    current: Boolean(currentId && record.id === currentId),
    archived: Boolean(record.isHistoricalArchive),
    snapshot: record,
  }
}

export function mapRequirementSolutionItem(raw = {}) {
  return {
    id: raw.id || raw.solutionId || 0,
    module: raw.module || raw.name || '—',
    desc: raw.description || raw.desc || '—',
    days: Number(raw.days ?? raw.mandays ?? 0),
    owner: raw.owner || raw.assignee || '—',
  }
}

export function mapRequirementAttachment(raw = {}) {
  return {
    name: raw.name || raw.fileName || '—',
    size: raw.size || raw.fileSize || '—',
    date: sliceDate(raw.date || raw.uploadedAt),
  }
}

export function mapRequirementScopeRow(raw = {}, index = 0) {
  if (raw.type === 'group') {
    return { type: 'group', label: raw.label || raw.group || '' }
  }
  return {
    cat: raw.category || raw.cat || raw.module || '—',
    item: raw.item || raw.description || raw.name || '—',
    priority: raw.priority || 'P2',
    owner: raw.owner || raw.assignee || '—',
    status: raw.status || '待确认',
    badge: raw.badge || (raw.status === '已确认' ? 'ci' : raw.status === '待结构化' ? 'co' : 'rev'),
    error: Boolean(raw.error || raw.isError),
  }
}

const BASIC_FIELD_PATCH = {
  客户名称: { top: 'customer', payload: 'customer', basic: 'customerName' },
  地点: { top: 'location', payload: 'location', basic: 'location' },
  项目名称: { top: 'project', payload: 'projectName', basic: 'projectName' },
  商机号: { payload: 'opportunityCode', basic: 'opportunityNo' },
  产品线: { payload: 'productLine', basic: 'productLines', isArray: true },
  客户行业: { top: 'industry', payload: 'industry', basic: 'customerIndustry' },
  企业营收: { top: 'revenue', payload: 'revenue', basic: 'enterpriseRevenue' },
  信息化现状: { top: 'it', payload: 'it', basic: 'itStatus' },
  预期上线: { top: 'goLive', payload: 'goLive', basic: 'expectedGoLive' },
}

function splitProductLines(value) {
  return String(value || '')
    .split(/[、,，/]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function mapRequirementDetailToVM(record = {}) {
  const payload = record.payload || {}
  const basicInfo = payload.basicInfo || payload.basicProjectInfo || record.basicInfo || {}
  const requirementImportData = payload.requirementImportData || record.requirementImportData || {}

  const code = payload.code || record.baseCode || record.code || ''
  const project = payload.project || payload.projectName || basicInfo.projectName || record.projectName || record.project || '未命名项目'
  const submitter = payload.submitter || record.submitter || record.createdByUsername || '—'
  const submittedAt = sliceDate(payload.submittedAt || record.createdAt)
  const status = mapVcsStatus(record)
  const version = record.versionCode || record.version || ''
  const customer = payload.customer || payload.customerName || basicInfo.customerName || record.customer || '—'
  const location = payload.location || basicInfo.location || record.location || '—'
  const industry = payload.industry || payload.customerIndustry || basicInfo.customerIndustry || record.industry || '—'
  const revenue = payload.revenue || payload.enterpriseRevenue || basicInfo.enterpriseRevenue || record.revenue || '—'
  const it = payload.it || payload.itStatus || basicInfo.itStatus || record.it || '—'
  const goLive = payload.goLive || payload.expectedGoLive || basicInfo.expectedGoLive || record.goLive || '—'
  const value = payload.value || payload.businessValue || basicInfo.projectGoals || record.value || '—'
  const urgency = payload.urgency || record.urgency || '中'
  const priority = payload.priority || record.priority || 'P2'
  const scopeIn = Array.isArray(payload.scopeIn) ? payload.scopeIn : []
  const scopeOut = Array.isArray(payload.scopeOut) ? payload.scopeOut : []
  const assumptions = Array.isArray(payload.assumptions) ? payload.assumptions : []

  const solutionRaw = payload.solution || payload.solutionItems || record.solution || []
  const solution = solutionRaw.map(mapRequirementSolutionItem)

  const attachRaw = payload.attachments || payload.attach || record.attachments || record.attach || []
  const attach = attachRaw.map(mapRequirementAttachment)

  const summary = {
    complexity: payload.complexity || record.complexity || '中',
    mandays: Number(payload.mandays ?? record.mandays ?? 0),
    risk: payload.risk || record.risk || '中',
  }

  const vcsStatus = record.checkoutStatus === 'checked_out' ? 'checked-out' : 'checked-in'
  const vcs = {
    status: vcsStatus,
    hasLocalChanges: Boolean(record.hasLocalChanges),
  }

  const basicFields = [
    { label: '客户名称', value: customer, required: true },
    { label: '地点', value: location },
    { label: '项目名称', value: project, required: true },
    { label: '商机号', value: payload.opportunityCode || basicInfo.opportunityNo || '—', muted: true },
    { label: '产品线', value: payload.productLine || basicInfo.productLines?.join(' / ') || '请选择产品线（可多选 ≥ 1）', required: true, muted: true, italic: true },
    { label: '客户行业', value: industry, badge: 'teal', help: true },
    { label: '企业营收', value: revenue },
    { label: '信息化现状', value: it, muted: true },
    { label: '预期上线', value: goLive, muted: true },
  ]

  const valueRows = Array.isArray(requirementImportData.valuePropositionRows) ? requirementImportData.valuePropositionRows : []
  const valueItems = valueRows.length ? valueRows.slice(0, 3).map((row, index) => ({
    label: ['价值', '要求', '指标'][index] || '价值',
    tone: ['accent', 'brand', 'teal'][index] || 'brand',
    text: row.refinedContent || row.summary || row.originalDemand || row.interviewOutline || '',
  })) : [
    { label: '价值', tone: 'accent', text: payload.valueText || value || '' },
    { label: '要求', tone: 'brand', text: payload.requirementText || '' },
    { label: '指标', tone: 'teal', text: payload.kpiText || '' },
  ]

  const businessNeedRows = Array.isArray(requirementImportData.businessNeedRows)
    ? requirementImportData.businessNeedRows.map((row) => ({
        category: row.businessDomain || row.category || '业务需求',
        item: row.title || row.businessNeed || row.solutionSuggestion || '—',
        priority: row.requiresCustomDev ? 'P1' : 'P2',
        owner: row.proposer || '—',
        status: row.standardImplemented === '是' ? '已确认' : '待结构化',
      }))
    : []
  const scopeRaw = payload.scopeRows || payload.scope || record.scopeRows || businessNeedRows
  const scopeRows = scopeRaw.map((r, i) => mapRequirementScopeRow(r, i))

  const keyPointCards = Array.isArray(requirementImportData.keyPointRows)
    ? requirementImportData.keyPointRows.slice(0, 4).map((row) => ({
        title: row.analysisCategory || row.subItem || '关键点',
        desc: row.detail || row.note || '—',
        source: 'Excel 解析',
      }))
    : []
  const extraCardsRaw = payload.extraCards || record.extraCards || keyPointCards.length ? (payload.extraCards || record.extraCards || keyPointCards) : [
    { title: '干系人', desc: '业务负责人 / IT 对接人 / 实施顾问', source: '访谈纪要' },
    { title: '约束条件', desc: '上线窗口、数据准备、跨组织协同约束', source: '项目上下文' },
    { title: '成功指标', desc: '交付周期、库存准确率、月结时效等指标', source: '价值主张' },
    { title: '风险假设', desc: '需求歧义、系统集成、历史数据质量风险', source: 'AI 解析' },
  ]
  const extraCards = extraCardsRaw.map((c) => ({ title: c.title || '', desc: c.desc || '', source: c.source || '' }))

  const versionHistory = Array.isArray(record.versionHistory) ? record.versionHistory : []
  const versionTimeline = versionHistory.map((row) => ({
    version: row.version,
    owner: row.owner,
    time: sliceDate(row.time),
    current: row.current,
    checkoutStatus: row.checkoutStatus,
    docStatus: row.docStatus,
  }))

  const structuredCount = scopeRows.filter((r) => r.type !== 'group' && r.status === '已确认').length
  const totalCount = scopeRows.filter((r) => r.type !== 'group').length
  const percent = totalCount ? Math.round((structuredCount / totalCount) * 100) : 0

  const completionStats = {
    percent,
    structuredCount,
    totalCount,
    fields: { current: basicFields.filter((f) => f.value && f.value !== '—').length, total: basicFields.length },
    valueItems: valueItems.length,
    dslViolations: scopeRows.filter((r) => r.type !== 'group' && r.error).length,
  }

  return {
    id: record.id || record.versionRecordId || '',
    code,
    project,
    submitter,
    submittedAt,
    status,
    version,
    customer,
    location,
    industry,
    revenue,
    it,
    goLive,
    value,
    urgency,
    priority,
    scopeIn,
    scopeOut,
    assumptions,
    companyProfile: payload.companyProfile || basicInfo.enterpriseProfile || '',
    projectBackground: payload.projectBackground || basicInfo.projectBackgroundNeeds || '',
    solution,
    attach,
    summary,
    vcs,
    basicFields,
    valueItems,
    scopeRows,
    extraCards,
    versionHistory,
    versionTimeline,
    completionStats,
    raw: record,
  }
}

export default function useRequirementDetail({
  id,
  enabled = isAuthenticated(),
  fallbackData = null,
} = {}) {
  const fallbackVM = useMemo(
    () => (fallbackData ? mapRequirementDetailToVM(fallbackData) : null),
    [fallbackData]
  )

  const [data, setData] = useState(fallbackVM)
  const dataRef = useRef(fallbackVM)
  const [loading, setLoading] = useState(Boolean(enabled && id))
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState({})

  const withAction = useCallback(async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      const data = await task()
      return { success: true, error: null, data }
    } catch (err) {
      return { success: false, error: err?.message || '操作失败' }
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    if (!enabled || !id) {
      setData(fallbackVM)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    // 并行请求：requirement-pack + 评审 + 当前版本 + 同模块版本列表
    // ISS-2026-08-18-005（档 1）：主请求（requirement-pack / 当前版本）失败必须可见——
    // 按 HTTP 状态码区分：404 是「真新建」的结构化信号（无记录），保留 null 走既有新建分支；
    // 其余错误（5xx/网络）rethrow，由外层 catch → setError 暴露失败态，不得静默降级为新建。
    Promise.all([
      apiClient.get(`/presales/requirement-packs/${id}`).catch((err) => {
        if (err?.status === 404) return null
        throw err
      }),
      // 评审列表降级：缺失时详情页以无评审渲染，属可选区块，可静默
      apiClient.get('/reviews', { versionId: id }).catch(() => null),
      apiClient.get(`/versions/${id}`).catch((err) => {
        if (err?.status === 404) return null
        throw err
      }),
      // 版本列表降级：缺失时版本时间线为空，属次要区块，可静默
      apiClient.get('/versions', { type: 'requirementImport' }).catch(() => null),
    ])
      .then(([mainPayload, reviewPayload, versionPayload, versionsPayload]) => {
        if (cancelled) return
        const main = unwrapSingle(mainPayload)
        const versionRecord = unwrapVersionRecord(versionPayload)
        const allVersions = unwrapList(versionsPayload)
        const family = versionFamilyCode(versionRecord || main || {})
        const historyRows = (family
          ? allVersions.filter((record) => record.type === 'requirementImport' && versionFamilyCode(record) === family)
          : allVersions.filter((record) => record.id === id)
        )
          .concat(versionRecord && !allVersions.some((record) => record.id === versionRecord.id) ? [versionRecord] : [])
          .filter(Boolean)
          .sort((a, b) => Number(new Date(b.updatedAt || b.createdAt || 0)) - Number(new Date(a.updatedAt || a.createdAt || 0)))
          .map((record) => mapRequirementVersionHistory(record, versionRecord?.id || id))
        const versionTimeline = historyRows.map((row) => ({
          version: row.version,
          owner: row.owner,
          time: sliceDate(row.time),
          current: row.current,
          checkoutStatus: row.checkoutStatus,
          docStatus: row.docStatus,
        }))

        if (!main) {
          // 无 requirement-pack → 尝试从 version 记录构建最小 VM
          if (versionRecord) {
            const vm = mapRequirementDetailToVM({
              ...versionRecord,
              versionHistory: historyRows,
              versionTimeline,
            })
            setData(vm || fallbackVM)
          } else {
            // 新建记录：无任何后端数据，构建空 VM
            const vm = mapRequirementDetailToVM({ id, status: 'draft', versionCode: '' })
            setData(vm || fallbackVM)
          }
          return
        }

        const reviews = unwrapList(reviewPayload)

        // 合并评审信息到 payload
        const merged = {
          ...main,
          ...(versionRecord || {}),
          payload: {
            ...(main.payload || {}),
            ...(versionRecord?.payload || {}),
            reviews: reviews.length ? reviews : undefined,
          },
          versionHistory: historyRows,
          versionTimeline,
        }

        const vm = mapRequirementDetailToVM(merged)
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

  const actions = useMemo(() => ({
    updateBasicField: (label, value) => {
      setData((current) => {
        if (!current) return current
        const patch = BASIC_FIELD_PATCH[label] || {}
        const raw = current.raw || {}
        const payload = { ...(raw.payload || {}) }
        const basicInfo = { ...(payload.basicInfo || payload.basicProjectInfo || {}) }
        if (patch.payload) payload[patch.payload] = value
        if (patch.basic) basicInfo[patch.basic] = patch.isArray ? splitProductLines(value) : value
        payload.basicInfo = basicInfo
        return {
          ...current,
          ...(patch.top ? { [patch.top]: value } : {}),
          basicFields: (current.basicFields || []).map((field) => (
            field.label === label ? { ...field, value, muted: false, italic: false } : field
          )),
          vcs: { ...current.vcs, hasLocalChanges: true },
          raw: { ...raw, payload, hasLocalChanges: true },
        }
      })
    },
    updateLongField: (key, value) => {
      setData((current) => {
        if (!current) return current
        const raw = current.raw || {}
        const payload = { ...(raw.payload || {}) }
        const basicInfo = { ...(payload.basicInfo || payload.basicProjectInfo || {}) }
        if (key === 'companyProfile') {
          payload.companyProfile = value
          basicInfo.enterpriseProfile = value
        }
        if (key === 'projectBackground') {
          payload.projectBackground = value
          basicInfo.projectBackgroundNeeds = value
        }
        payload.basicInfo = basicInfo
        return {
          ...current,
          [key]: value,
          vcs: { ...current.vcs, hasLocalChanges: true },
          raw: { ...raw, payload, hasLocalChanges: true },
        }
      })
    },
    saveDraft: () => withAction('saveDraft', async () => {
      const payloadSnapshot = dataRef.current?.raw?.payload || {}
      await apiClient.patch(`/versions/${id}/save-draft`, { payload: payloadSnapshot })
      setData((current) => current ? { ...current, vcs: { ...current.vcs, hasLocalChanges: false }, raw: { ...current.raw, hasLocalChanges: false } } : current)
    }),
    parseFile: (file) => withAction('parseFile', async () => {
      const formData = new FormData()
      formData.append('file', file)
      const payload = await apiClient.upload('/ai/parse-basic-info', formData)
      const parsed = payload?.data || payload
      setData((current) => {
        const parsedBasic = parsed.basicInfo || {}
        const nextRecord = {
          ...(current?.raw || current || {}),
          id: current?.id || id,
          versionCode: current?.version || current?.code || '',
          baseCode: current?.globalVersion || current?.raw?.baseCode || '',
          checkoutStatus: current?.vcs?.status === 'checked-out' ? 'checked_out' : 'checked_in',
          hasLocalChanges: true,
          payload: {
            ...(current?.raw?.payload || {}),
            projectName: parsedBasic.projectName || current?.raw?.payload?.projectName,
            customer: parsedBasic.customerName || current?.raw?.payload?.customer,
            customerName: parsedBasic.customerName || current?.raw?.payload?.customerName,
            location: parsedBasic.location || current?.raw?.payload?.location,
            industry: parsedBasic.customerIndustry || current?.raw?.payload?.industry,
            customerIndustry: parsedBasic.customerIndustry || current?.raw?.payload?.customerIndustry,
            revenue: parsedBasic.enterpriseRevenue || current?.raw?.payload?.revenue,
            enterpriseRevenue: parsedBasic.enterpriseRevenue || current?.raw?.payload?.enterpriseRevenue,
            it: parsedBasic.itStatus || current?.raw?.payload?.it,
            itStatus: parsedBasic.itStatus || current?.raw?.payload?.itStatus,
            goLive: parsedBasic.expectedGoLive || current?.raw?.payload?.goLive,
            expectedGoLive: parsedBasic.expectedGoLive || current?.raw?.payload?.expectedGoLive,
            ...(current?.raw?.payload?.basicInfo ? {} : { basicInfo: {} }),
            basicInfo: {
              ...(current?.raw?.payload?.basicInfo || {}),
              ...parsedBasic,
            },
            requirementImportData: parsed.requirementImportData || current?.raw?.payload?.requirementImportData,
          },
        }
        return mapRequirementDetailToVM(nextRecord)
      })
      return parsed
    }),
    previewAssessment: (requirementSnapshot) => withAction('previewAssessment', async () => {
      const payload = await apiClient.post('/ai/kimi-assessment/preview', { requirementSnapshot })
      return payload?.data || payload
    }),
    applyTemplate: (templateName) => withAction('applyTemplate', async () => {
      const payload = await apiClient.post('/ai/chat', {
        messages: [{ role: 'user', content: `请基于需求条目，套用模板「${templateName}」生成评估建议。` }],
      })
      return payload?.data || payload
    }),
    fixAmbiguity: (questions) => withAction('fixAmbiguity', async () => {
      const payload = await apiClient.post('/ai/chat', {
        messages: [{ role: 'user', content: `请分析并消除以下需求条目的歧义：${JSON.stringify(questions)}` }],
      })
      return payload?.data || payload
    }),
    aiChat: (messages) => withAction('aiChat', async () => {
      const payload = await apiClient.post('/ai/chat', { messages })
      return payload?.data || payload
    }),
    checkout: () => withAction('checkout', async () => {
      await apiClient.post(`/versions/${id}/checkout`)
      setData((current) => current ? { ...current, vcs: { ...current.vcs, status: 'checked-out' } } : current)
    }),
    checkin: () => withAction('checkin', async () => {
      const payloadSnapshot = dataRef.current?.raw?.payload || {}
      const result = await apiClient.post(`/versions/${id}/checkin`, { payload: payloadSnapshot })
      const record = result?.data?.record || result?.record
      setData((current) => {
        if (record) return mapRequirementDetailToVM(record)
        return current ? { ...current, vcs: { ...current.vcs, status: 'checked-in', hasLocalChanges: false }, raw: { ...current.raw, hasLocalChanges: false } } : current
      })
    }),
    undoCheckout: () => withAction('undoCheckout', async () => {
      await apiClient.post(`/versions/${id}/undo-checkout`)
      setData((current) => current ? { ...current, vcs: { ...current.vcs, status: 'checked-in', hasLocalChanges: false } } : current)
    }),
    promote: () => withAction('promote', async () => {
      await apiClient.post(`/versions/${id}/promote`)
    }),
    forceUnlock: () => withAction('forceUnlock', async () => {
      await apiClient.patch(`/versions/${id}/force-unlock`)
      setData((current) => current ? { ...current, vcs: { ...current.vcs, status: 'checked-in', hasLocalChanges: false } } : current)
    }),
  }), [id, withAction])

  return {
    ...(data || fallbackVM || {}),
    loading,
    error,
    actions,
    actionLoading,
  }
}
