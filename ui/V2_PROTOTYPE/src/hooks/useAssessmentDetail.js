import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '../api/client.js'
import { getBusinessAssessmentBasis, calculateBusinessAssessment } from '../api/businessAssessments.js'
import { getToken, isAuthenticated } from '../api/auth.js'
import { mapVcsStatus } from './mapVersionStatus.js'
import { unwrap, asArray } from '../api/utils.js'

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function dateTime(value) {
  if (!value) return ''
  return String(value)
}

function mergeFallback(fallbackData) {
  const fallback = fallbackData || {}
  return {
    ...fallback,
    id: fallback.id || '',
    projectName: fallback.projectName || '',
    status: fallback.status || '',
    statusLabel: fallback.statusLabel || '',
    versionCode: fallback.versionCode || '',
    versionLabel: fallback.versionLabel || '',
    model: fallback.model || '',
    productLines: fallback.productLines || [],
    requirementSource: fallback.requirementSource || {},
    params: {
      userCount: 0,
      userCountMax: 500,
      difficultyFactor: 1,
      orgCount: 1,
      orgSimilarity: 1,
      ...(fallback.params || {}),
    },
    kpi: {
      totalDays: 0,
      baseDays: 0,
      userIncrementDays: 0,
      difficultyIncrementDays: 0,
      orgIncrementDays: 0,
      selectedCount: 0,
      totalItemCount: 0,
      cloudDistribution: [],
      ...(fallback.kpi || {}),
    },
    path: {
      quoteMode: '标准实施',
      preset: '默认模板',
      cloudProducts: [],
      allCloudProducts: [],
      quoteModes: ['模块报价', '标准清单报价', '范围估算'],
      presets: ['标准财务供应链', '轻量财务供应链', '集团多组织模板'],
      ...(fallback.path || {}),
    },
    context: {
      template: '默认模板',
      ruleSet: 'default',
      globalVersion: '',
      ruleSetMeta: null,
      ...(fallback.context || {}),
    },
    summary: {
      ruleVersion: '—',
      pipelineVersion: '—',
      lastRun: '—',
      ...(fallback.summary || {}),
    },
    dsl: { passed: true, issues: [], ...(fallback.dsl || {}) },
    vcs: { isReadonly: true, hasLocalChanges: false, ...(fallback.vcs || {}) },
    skuGroups: fallback.skuGroups || [],
    multiOrg: fallback.multiOrg || { incompleteCount: 0, rows: [] },
  }
}

function buildItemsFromGroups(groups = []) {
  return groups.flatMap((group, groupIndex) =>
    asArray(group.children).map((item, itemIndex) => ({
      templateItemId: item.templateItemId || `${group.groupId || `item-${groupIndex}`}-${itemIndex}`,
      included: item.included ?? itemIndex < (group.selected || 0),
      customStandardDays: item.customDays,
    }))
  )
}

function buildItemsFromTemplate(template) {
  return asArray(template?.items).map((item) => ({
    templateItemId: item.templateItemId,
    included: Boolean(item.defaultIncluded),
  }))
}

function buildCalculateBody(record, template, fallback) {
  const payload = record.payload || {}
  const params = { ...fallback.params, ...(payload.params || {}) }
  const templateItems = buildItemsFromTemplate(template)
  const fallbackItems = buildItemsFromGroups(fallback.skuGroups)
  const items = asArray(payload.items).length
    ? payload.items
    : templateItems.length
      ? templateItems
      : fallbackItems

  return {
    templateId: payload.templateId || record.templateId || template?.templateId || fallback.templateId || 'tmpl-import-1774340190465',
    ruleSetId: payload.ruleSetId || record.ruleSetId || fallback.ruleSetId || 'default',
    userCount: safeNumber(params.userCount, 0),
    difficultyFactor: safeNumber(params.difficultyFactor, 0),
    orgCount: safeNumber(params.orgCount, 1),
    orgSimilarityFactor: safeNumber(params.orgSimilarityFactor ?? params.orgSimilarity, 1),
    selectedCloudNames: payload.selectedCloudNames || payload.cloudProducts || fallback.path?.cloudProducts || [],
    exportProjectName: payload.projectName || fallback.projectName || '',
    exportAssessmentVersionCode: record.versionCode || fallback.versionCode || '',
    items,
  }
}

function buildFrozenCalculateBody(record, basis, fallback) {
  const { params, items } = record.payload || {}
  if (!params || !['userCount', 'difficultyFactor', 'orgCount', 'orgSimilarityFactor'].every(key => Number.isFinite(params[key]))
    || !Array.isArray(items) || !items.length || items.some(item => !item || typeof item.templateItemId !== 'string' || typeof item.included !== 'boolean')) {
    throw new Error('评估已确认的参数或范围不完整，请核对草稿后重试')
  }
  const body = buildCalculateBody(record, basis.template, fallback)
  return { ...body, templateId: basis.template.templateId, ruleSetId: basis.ruleSet.ruleSetId,
    items: items.map(({ templateItemId, included, customStandardDays }) => ({ templateItemId, included, ...(customStandardDays === undefined ? {} : { customStandardDays }) })) }
}

function normalizeDsl(record, ruleSet, fallback) {
  const payload = record.payload || {}
  const dsl = payload.dsl || payload.dslResult || payload.validation || fallback.dsl
  if (dsl?.issues) {
    return {
      passed: dsl.passed ?? dsl.issues.length === 0,
      issues: dsl.issues.map((issue, index) => ({
        ruleId: issue.ruleId || issue.id || `R-${index + 1}`,
        type: issue.type || issue.logic || (issue.blocking ? 'blocking' : 'warning'),
        message: issue.message || issue.reason || '',
        blocking: Boolean(issue.blocking ?? issue.type === 'blocking'),
      })),
    }
  }

  const rules = asArray(ruleSet?.rules)
  return {
    passed: true,
    issues: rules
      .filter((rule) => rule.enabled === false && rule.blocking)
      .map((rule) => ({
        ruleId: rule.id || rule.ruleId,
        type: rule.logic || 'blocking',
        message: rule.message || `${rule.subject || '规则'} 未满足`,
        blocking: true,
      })),
  }
}

function normalizeKpi(result, template, fallback) {
  if (!result) return fallback.kpi
  const itemResults = asArray(result.itemResults)
  const selectedCount = itemResults.filter((item) => item.included).length
  const totalItemCount = template?.items?.length || itemResults.length || fallback.kpi.totalItemCount || 0
  const groupSubtotals = asArray(result.groupSubtotals)
  const totalDays = safeNumber(result.totalDays, fallback.kpi.totalDays)

  return {
    totalDays,
    baseDays: safeNumber(result.baseDays, fallback.kpi.baseDays),
    userIncrementDays: safeNumber(result.userIncrementDays, fallback.kpi.userIncrementDays),
    difficultyIncrementDays: safeNumber(result.difficultyIncrementDays, fallback.kpi.difficultyIncrementDays),
    orgIncrementDays: safeNumber(result.orgIncrementDays, fallback.kpi.orgIncrementDays),
    selectedCount: selectedCount || fallback.kpi.selectedCount || 0,
    totalItemCount,
    cloudDistribution: groupSubtotals.length
      ? groupSubtotals.slice(0, 4).map((group) => ({
          name: group.groupName,
          percentage: totalDays > 0 ? Math.round((safeNumber(group.subtotalDays) / totalDays) * 1000) / 10 : 0,
        }))
      : fallback.kpi.cloudDistribution || [],
  }
}

function normalizeSkuGroups(template, result, fallback, confirmedItems = null) {
  const templateItems = asArray(template?.items)
  if (!templateItems.length) return fallback.skuGroups

  const resultsById = new Map(asArray(result?.itemResults).map((item) => [item.templateItemId, item]))
  const confirmedById = new Map(asArray(confirmedItems).filter(item => item && typeof item.templateItemId === 'string').map(item => [item.templateItemId, item]))
  const frozen = confirmedItems !== null
  const groupMeta = new Map(asArray(template?.groups).map((group) => [group.groupId, group.groupName]))
  const grouped = new Map()

  templateItems.forEach((item) => {
    const groupId = item.groupId || 'ungrouped'
    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        groupId,
        name: groupMeta.get(groupId) || item.cloudProduct || item.appGroup || '未分组',
        module: item.skuName || item.appGroup || '模块',
        selected: 0,
        total: 0,
        days: frozen && !result ? null : 0,
        children: [],
      })
    }

    const group = grouped.get(groupId)
    const calculated = resultsById.get(item.templateItemId) || {}
    const confirmed = confirmedById.get(item.templateItemId)
    const included = frozen ? (typeof confirmed?.included === 'boolean' ? confirmed.included : null) : Boolean(calculated.included ?? item.defaultIncluded)
    const standardDays = safeNumber(calculated.standardDays ?? item.standardDays, 0)
    const customDays = frozen && !result ? null : safeNumber(calculated.effectiveStandardDays ?? calculated.itemSubtotalDays ?? standardDays, standardDays)

    group.total += 1
    if (included) group.selected += 1
    if (group.days !== null) group.days = Math.round((group.days + (included ? customDays : 0)) * 10) / 10
    group.children.push({
      templateItemId: item.templateItemId,
      name: item.itemName || item.deliveryPoint || item.deliveryModule || '实施要点',
      module: item.deliveryModule || item.appGroup || item.skuName || group.module,
      description: item.deliveryDesc || item.description || '',
      baseDays: standardDays,
      customDays,
      confirmedCustomDays: frozen && Number.isFinite(confirmed?.customStandardDays) ? confirmed.customStandardDays : null,
      delta: customDays === null ? null : customDays - standardDays,
      reasonStatus: included ? 'saved' : 'none',
      assessmentNote: item.evalDesc || item.assessmentNote || '',
      included,
    })
  })

  return Array.from(grouped.values())
}

function normalizeContext(record, template, ruleSet, ruleSetMeta, fallback) {
  const payload = record.payload || {}
  return {
    template: template?.templateName || template?.name || payload.templateName || fallback.context.template,
    ruleSet: ruleSet?.ruleSetId || payload.ruleSetName || payload.ruleSetId || fallback.context.ruleSet,
    globalVersion: record.baseCode || payload.globalVersion || fallback.context.globalVersion,
    ruleSetMeta,
  }
}

function normalizePath(record, fallback) {
  const payload = record.payload || {}
  return {
    quoteMode: payload.quoteMode || fallback.path.quoteMode,
    preset: payload.preset || fallback.path.preset,
    cloudProducts: payload.cloudProducts || payload.selectedCloudNames || fallback.path.cloudProducts,
    allCloudProducts: payload.allCloudProducts || fallback.path.allCloudProducts,
    quoteModes: payload.quoteModes || fallback.path.quoteModes,
    presets: payload.presets || fallback.path.presets,
  }
}

function buildVm(record, template, ruleSet, ruleSetMeta, estimateResult, fallback, confirmedItems = null) {
  const payload = record.payload || {}
  const basicProjectInfo = payload.basicProjectInfo || {}
  const project = payload.project || {}
  const requirementSource = payload.requirementSource || payload.requirement || null
  const params = { ...fallback.params, ...(payload.params || {}) }

  // Use record data first, then fallback only as last resort
  const projectName = payload.projectName || project.projectName || basicProjectInfo.projectName || ''
  const hasRealData = Boolean(projectName || payload.projectName || record.versionCode)

  return {
    ...fallback,
    id: record.id || fallback.id,
    projectName: hasRealData ? projectName : (projectName || fallback.projectName),
    status: record.status || fallback.status,
    statusLabel: mapVcsStatus(record) || fallback.statusLabel,
    versionCode: record.versionCode || fallback.versionCode,
    versionLabel: payload.versionLabel || fallback.versionLabel || '',
    model: payload.model || fallback.model,
    productLines: payload.productLines || project.productLines || basicProjectInfo.productLines || (hasRealData ? [] : fallback.productLines),
    requirementSource: requirementSource
      ? { ...fallback.requirementSource, ...requirementSource }
      : fallback.requirementSource,
    vcs: {
      checkedOutBy: record.checkedOutByUsername || payload.checkedOutBy || fallback.vcs.checkedOutBy,
      checkedOutAt: dateTime(record.checkedOutAt || payload.checkedOutAt || fallback.vcs.checkedOutAt),
      isReadonly: record.checkoutStatus ? record.checkoutStatus !== 'checked_out' : fallback.vcs.isReadonly,
      hasLocalChanges: payload.hasLocalChanges ?? fallback.vcs.hasLocalChanges,
    },
    params: {
      userCount: safeNumber(params.userCount, fallback.params.userCount),
      userCountMax: safeNumber(params.userCountMax, fallback.params.userCountMax),
      difficultyFactor: safeNumber(params.difficultyFactor, fallback.params.difficultyFactor),
      orgCount: safeNumber(params.orgCount, fallback.params.orgCount),
      orgSimilarity: safeNumber(params.orgSimilarityFactor ?? params.orgSimilarity, fallback.params.orgSimilarity),
    },
    kpi: normalizeKpi(estimateResult, template, fallback),
    path: normalizePath(record, fallback),
    skuGroups: normalizeSkuGroups(template, estimateResult, fallback, confirmedItems),
    dsl: normalizeDsl(record, ruleSet, fallback),
    context: normalizeContext(record, template, ruleSet, ruleSetMeta, fallback),
    multiOrg: payload.multiOrg || fallback.multiOrg,
    raw: record,
    summary: {
      ...fallback.summary,
      ruleVersion: estimateResult?.ruleVersion || ruleSet?.ruleVersion || fallback.summary?.ruleVersion,
      pipelineVersion: estimateResult?.pipelineVersion || ruleSet?.pipelineVersion || fallback.summary?.pipelineVersion,
      lastRun: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
  }
}

export default function useAssessmentDetail(versionId, {
  enabled = isAuthenticated(),
  fallbackData = null,
} = {}) {
  const fallback = useMemo(() => mergeFallback(fallbackData), [fallbackData])
  const authToken = getToken()
  // Identity is per transition, so A → B → A cannot admit an older A response.
  const [reloadKey, setReloadKey] = useState(0)
  const scope = useMemo(() => ({}), [enabled, versionId, authToken, reloadKey])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [vm, setVm] = useState(null)
  const [actionState, setActionState] = useState({ scope, loading: {} })
  const isCurrent = useCallback(() => scopeRef.current === scope && getToken() === authToken, [scope, authToken])
  const emptyKpi = { ...fallback.kpi, totalDays: null, baseDays: null, userIncrementDays: null, difficultyIncrementDays: null, orgIncrementDays: null }
  const refetch = useCallback(() => {
    scopeRef.current = null
    setReloadKey(value => value + 1)
  }, [])

  const withAction = useCallback(async (key, task) => {
    if (!enabled || !versionId || !isCurrent()) return { success: false, error: '评估已切换，请刷新后重试' }
    setActionState(current => ({ scope, loading: { ...(current.scope === scope ? current.loading : {}), [key]: true } }))
    try {
      const data = await task()
      if (!isCurrent()) return { success: false, error: '评估已切换，请刷新后重试' }
      refetch()
      return { success: true, error: null, data }
    } catch (error) {
      return { success: false, error: error?.message || '操作失败' }
    } finally {
      if (isCurrent()) setActionState(current => ({ scope, loading: { ...current.loading, [key]: false } }))
    }
  }, [enabled, versionId, scope, isCurrent, refetch])

  // Reload the actual server record after every successful action. Never invent a checkout status.
  const versionPath = `/versions/${encodeURIComponent(versionId)}`
  const checkout = useCallback(() => withAction('checkout', () => apiClient.post(`${versionPath}/checkout`)), [versionPath, withAction])
  const checkin = useCallback(() => withAction('checkin', () => apiClient.post(`${versionPath}/checkin`)), [versionPath, withAction])
  const undoCheckout = useCallback(() => withAction('undoCheckout', () => apiClient.post(`${versionPath}/undo-checkout`)), [versionPath, withAction])
  const promote = useCallback(() => withAction('promote', () => apiClient.post(`${versionPath}/promote`)), [versionPath, withAction])
  const forceUnlock = useCallback(() => withAction('forceUnlock', () => apiClient.patch(`${versionPath}/force-unlock`)), [versionPath, withAction])
  const saveDraft = useCallback(payload => withAction('saveDraft', () => apiClient.patch(`${versionPath}/save-draft`, { payload })), [versionPath, withAction])
  const confirmAiDraft = useCallback(() => withAction('confirmAiDraft', async () => unwrap(await apiClient.post(`/project-evaluations/assessment-drafts/${encodeURIComponent(versionId)}/confirm`, {}))), [versionId, withAction])

  useEffect(() => {
    if (!enabled || !versionId) return undefined
    let cancelled = false
    const current = () => !cancelled && isCurrent()
    async function load() {
      let record
      try {
        const data = unwrap(await apiClient.get(versionPath)) || {}
        if (!current()) return
        record = data.record || data
      } catch (error) {
        if (current()) setVm({ ...fallback, kpi: emptyKpi, scope, loading: false, error, calculationBasis: null, estimateError: error })
        return
      }

      let calculationBasis = null
      let template = null
      let ruleSet = null
      let ruleSetMeta = null
      let estimateResult = null
      let estimateError = null
      try {
        // The server classifies the record before any latest-catalog request is allowed.
        calculationBasis = await getBusinessAssessmentBasis(versionId)
        if (!current()) return
        if (calculationBasis.kind === 'frozen') {
          template = calculationBasis.template
          ruleSet = calculationBasis.ruleSet
          // Scope identifiers come from the verified server basis, never the editable payload.
          estimateResult = await calculateBusinessAssessment(versionId, buildFrozenCalculateBody(record, calculationBasis, fallback))
        } else {
          const payload = record.payload || {}
          const templateId = payload.templateId || record.templateId || fallback.templateId || 'default'
          const ruleSetId = payload.ruleSetId || record.ruleSetId || fallback.ruleSetId || 'default'
          const enriched = await Promise.all([
            apiClient.get(`/templates/${templateId}`).catch(() => null),
            apiClient.get('/rule-sets/active').catch(() => null),
            apiClient.get('/rule-sets/meta').catch(() => null),
          ])
          if (!current()) return
          template = unwrap(enriched[0]) || null
          ruleSet = unwrap(enriched[1]) || { ruleSetId }
          ruleSetMeta = unwrap(enriched[2]) || null
          estimateResult = unwrap(await apiClient.post('/estimates/calculate', buildCalculateBody({ ...record, payload: { ...payload, templateId, ruleSetId } }, template, fallback)))
        }
      } catch (error) {
        estimateError = error
      }
      if (!current()) return
      const nextVm = buildVm(record, template, ruleSet, ruleSetMeta, estimateResult, fallback, calculationBasis?.kind === 'frozen' ? asArray(record.payload?.items) : null)
      setVm({ ...nextVm, ...(estimateError ? { kpi: emptyKpi } : {}), scope, loading: false, error: null, calculationBasis, estimateError })
    }
    load()
    return () => { cancelled = true }
  }, [enabled, fallback, isCurrent, scope, versionId, versionPath])

  const visible = vm?.scope === scope && enabled && getToken() === authToken
    ? vm
    : { ...fallback, kpi: enabled ? emptyKpi : fallback.kpi, loading: Boolean(enabled && versionId), error: null, estimateError: null, calculationBasis: null }
  return { ...visible, refetch, actionLoading: actionState.scope === scope ? actionState.loading : {}, actions: { checkout, checkin, undoCheckout, promote, forceUnlock, saveDraft, confirmAiDraft } }
}
