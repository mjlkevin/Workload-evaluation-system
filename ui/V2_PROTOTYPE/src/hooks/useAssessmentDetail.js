import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
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

function normalizeSkuGroups(template, result, fallback) {
  const templateItems = asArray(template?.items)
  if (!templateItems.length) return fallback.skuGroups

  const resultsById = new Map(asArray(result?.itemResults).map((item) => [item.templateItemId, item]))
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
        days: 0,
        children: [],
      })
    }

    const group = grouped.get(groupId)
    const calculated = resultsById.get(item.templateItemId) || {}
    const included = Boolean(calculated.included ?? item.defaultIncluded)
    const standardDays = safeNumber(calculated.standardDays ?? item.standardDays, 0)
    const customDays = safeNumber(calculated.effectiveStandardDays ?? calculated.itemSubtotalDays ?? standardDays, standardDays)

    group.total += 1
    if (included) group.selected += 1
    group.days = Math.round((group.days + (included ? customDays : 0)) * 10) / 10
    group.children.push({
      templateItemId: item.templateItemId,
      name: item.itemName || item.deliveryPoint || item.deliveryModule || '实施要点',
      module: item.deliveryModule || item.appGroup || item.skuName || group.module,
      description: item.deliveryDesc || item.description || '',
      baseDays: standardDays,
      customDays,
      delta: customDays - standardDays,
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

function buildVm(record, template, ruleSet, ruleSetMeta, estimateResult, fallback) {
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
    skuGroups: normalizeSkuGroups(template, estimateResult, fallback),
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
  const [vm, setVm] = useState(() => ({ ...fallback, loading: Boolean(enabled), error: null }))
  const [reloadKey, setReloadKey] = useState(0)
  const [actionLoading, setActionLoading] = useState({})

  const refetch = useCallback(() => {
    setReloadKey((value) => value + 1)
  }, [])

  const withAction = useCallback(async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      const data = await task()
      return { success: true, error: null, data }
    } catch (error) {
      return { success: false, error: error?.message || '操作失败' }
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  const checkout = useCallback(() => withAction('checkout', async () => {
    await apiClient.post(`/versions/${versionId}/checkout`)
    setVm((current) => ({ ...current, vcs: { ...current.vcs, isReadonly: false } }))
  }), [versionId, withAction])

  const checkin = useCallback(() => withAction('checkin', async () => {
    await apiClient.post(`/versions/${versionId}/checkin`)
    setVm((current) => ({ ...current, vcs: { ...current.vcs, isReadonly: true, hasLocalChanges: false } }))
  }), [versionId, withAction])

  const undoCheckout = useCallback(() => withAction('undoCheckout', async () => {
    await apiClient.post(`/versions/${versionId}/undo-checkout`)
    setVm((current) => ({ ...current, vcs: { ...current.vcs, isReadonly: true, hasLocalChanges: false } }))
  }), [versionId, withAction])

  const promote = useCallback(() => withAction('promote', async () => {
    await apiClient.post(`/versions/${versionId}/promote`)
    refetch()
  }), [versionId, refetch, withAction])

  const forceUnlock = useCallback(() => withAction('forceUnlock', async () => {
    await apiClient.patch(`/versions/${versionId}/force-unlock`)
    refetch()
  }), [versionId, refetch, withAction])

  const saveDraft = useCallback((payload) => withAction('saveDraft', async () => {
    await apiClient.patch(`/versions/${versionId}/save-draft`, { payload })
    setVm((current) => ({ ...current, vcs: { ...current.vcs, hasLocalChanges: false } }))
  }), [versionId, withAction])

  const confirmAiDraft = useCallback(() => withAction('confirmAiDraft', async () => {
    const response = await apiClient.post(`/project-evaluations/assessment-drafts/${encodeURIComponent(versionId)}/confirm`, {})
    const result = unwrap(response) || {}
    const manualConfirmation = result.assessmentDraft?.manualConfirmation || null
    const harness = result.harness || null
    setVm((current) => {
      const raw = current.raw || {}
      const payload = raw.payload || {}
      return {
        ...current,
        raw: {
          ...raw,
          payload: {
            ...payload,
            aiDraftReview: manualConfirmation,
            aiDraftHarnessWriteBack: harness,
          },
        },
      }
    })
    refetch()
    return result
  }), [versionId, refetch, withAction])

  useEffect(() => {
    if (!enabled || !versionId) {
      setVm({ ...fallback, loading: false, error: null })
      return undefined
    }

    let cancelled = false
    setVm((current) => ({ ...current, loading: true, error: null }))

    async function load() {
      // Step 1 — fetch the version record (must succeed)
      let record
      try {
        const versionPayload = await apiClient.get(`/versions/${versionId}`)
        if (cancelled) return
        record = unwrap(versionPayload) || {}
      } catch (error) {
        if (cancelled) return
        // Only full fallback when the record itself can't be fetched
        setVm({ ...fallback, loading: false, error })
        return
      }

      // Step 2 — enrich with template / rule-set / calculate, but tolerate failures
      const payload = record.payload || {}
      const templateId = payload.templateId || record.templateId || fallback.templateId || 'default'
      const ruleSetId = payload.ruleSetId || record.ruleSetId || fallback.ruleSetId || 'default'

      let template = null
      let activeRuleSet = { ruleSetId }
      let ruleSetMeta = null
      let estimateResult = null

      try {
        const [templatePayload, activeRuleSetPayload, ruleSetMetaPayload] = await Promise.all([
          apiClient.get(`/templates/${templateId}`).catch(() => null),
          apiClient.get('/rule-sets/active').catch(() => null),
          apiClient.get('/rule-sets/meta').catch(() => null),
        ])
        if (cancelled) return

        template = unwrap(templatePayload) || null
        activeRuleSet = unwrap(activeRuleSetPayload) || { ruleSetId }
        ruleSetMeta = unwrap(ruleSetMetaPayload) || null

        const calculateBody = buildCalculateBody({ ...record, payload: { ...payload, templateId, ruleSetId } }, template, fallback)
        const estimatePayload = await apiClient.post('/estimates/calculate', calculateBody).catch(() => null)
        if (cancelled) return
        estimateResult = unwrap(estimatePayload)
      } catch (_) {
        // enrichment failed — continue with record-only data
      }

      const nextVm = buildVm(record, template, activeRuleSet, ruleSetMeta, estimateResult, fallback)
      setVm({ ...nextVm, loading: false, error: null })
    }

    load()
    return () => { cancelled = true }
  }, [enabled, fallback, reloadKey, versionId])

  return { ...vm, loading: vm.loading, error: vm.error, refetch, actionLoading, actions: { checkout, checkin, undoCheckout, promote, forceUnlock, saveDraft, confirmAiDraft } }
}
