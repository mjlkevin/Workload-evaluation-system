import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrap, asArray } from '../api/utils.js'

const DEFAULT_SEALS = []

const DEFAULT_DELIVERABLES = []

const DEFAULT_CHECKLIST = []

const DEFAULT_COMMENTS = []

const DEFAULT_VM = {
  header: {
    versionLabel: '',
    initiator: '—',
    reviewers: '—',
    deadline: '',
    remainingDays: 0,
  },
  checklist: [],
  comments: [],
  deliverables: [],
  completeness: { percent: 0, passed: 0, total: 0 },
  handoff: {
    fromRole: '',
    fromName: '',
    toRole: '',
    toName: '',
    deadline: '',
    remainingDays: 0,
  },
  relatedDocs: [],
  reviewStatus: 'pending',
  seals: [],
}

const CHECKLIST_LABELS = {
  deliverablesComplete: { type: '必检', name: '交付物完整' },
  methodologySevenPhases: { type: '必检', name: '方法论七阶段' },
  rateCardCorrect: { type: '必检', name: 'RateCard 正确性' },
  narrativeComplete: { type: '建议', name: '叙事完整性' },
  assumptionsDocumented: { type: '建议', name: '假设清单记录' },
}

const DELIVERABLE_TYPES = {
  effort_table: { name: '人天估算表', type: 'XLSX' },
  resource_cost: { name: '资源成本表', type: 'XLSX' },
  variance_analysis: { name: '差异分析表', type: 'PDF' },
  wbs: { name: 'WBS 工作分解', type: 'MD' },
  sow: { name: '实施 SOW', type: 'PDF' },
  plan: { name: '实施计划', type: 'MD' },
}

function formatDate(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function formatDateTime(value) {
  if (!value) return ''
  return String(value).slice(0, 16).replace('T', ' ')
}

function nowLabel() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function daysUntil(value) {
  if (!value) return 0
  const target = new Date(value)
  if (Number.isNaN(target.valueOf())) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.ceil((target - today) / 86400000))
}

function displayUser(user, fallback) {
  if (!user) return fallback
  if (typeof user === 'string') return user
  const name = user.name || user.username || user.displayName || user.userName || user.userId || fallback
  const role = user.roleName || user.roleLabel || user.role || user.title
  return role ? `${name} · ${role}` : name
}

function mapReviewStatus(review = {}) {
  if (review.verdict === 'pass' || review.status === 'approved') return 'approved'
  if (review.verdict === 'reject' || review.status === 'rejected') return 'rejected'
  return 'pending'
}

function normalizeChecklist(checklist) {
  if (Array.isArray(checklist)) {
    return checklist.map((item) => ({
      type: item.type || (item.required ? '必检' : '建议'),
      name: item.name || item.label || item.field || '检查项',
      status: item.status || (item.passed === true ? '通过' : item.passed === false ? '未通过' : '待审'),
    }))
  }

  if (checklist && typeof checklist === 'object') {
    return Object.entries(CHECKLIST_LABELS).map(([key, meta]) => ({
      ...meta,
      status: checklist[key] === true ? '通过' : checklist[key] === false ? '待审' : '待审',
    }))
  }

  return DEFAULT_CHECKLIST
}

function normalizeComments(items) {
  return items.map((comment) => {
    const name = comment.name || displayUser(comment.author, '') || comment.authorName || comment.authorUserId || '当前用户'
    return {
      name,
      time: formatDateTime(comment.time || comment.createdAt),
      text: comment.text || comment.content || '',
      avatarInitial: comment.avatarInitial || name.slice(0, 1),
    }
  })
}

function normalizeDeliverables(items, fallback = DEFAULT_DELIVERABLES) {
  if (!items.length) return fallback
  return items.map((item, index) => {
    const sourceType = item.deliverableType || item.kind || item.type
    const mappedType = DELIVERABLE_TYPES[sourceType] || {}
    const sealName = item.sealName || item.seal?.name || item.sealedByName || ''
    const generatedAt = formatDateTime(item.generatedAt || item.createdAt || item.updatedAt)
    const status = sealName || item.status === 'sealed'
      ? 'sealed'
      : item.status === 'pending' || item.status === 'todo'
        ? 'pending'
        : 'generated'

    return {
      id: item.id || item.deliverableId || `D${index + 1}`,
      name: item.name || item.title || item.content?.title || mappedType.name || fallback[index]?.name || 'PM 交付物',
      type: item.fileType || mappedType.type || String(item.type || 'PDF').toUpperCase(),
      status,
      generatedAt,
      sealName,
      raw: item,
    }
  })
}

function normalizeHandoff(items, fallback) {
  const handoff = items[0]
  if (!handoff) return fallback
  return {
    fromRole: handoff.fromRole || fallback.fromRole,
    fromName: handoff.fromName || handoff.initiatedByName || handoff.fromUser?.name || fallback.fromName,
    toRole: handoff.toRole || fallback.toRole,
    toName: handoff.toName || handoff.acceptedByName || handoff.toUser?.name || fallback.toName,
    deadline: formatDateTime(handoff.deadline || handoff.dueAt || handoff.createdAt) || fallback.deadline,
    remainingDays: daysUntil(handoff.deadline || handoff.dueAt) || fallback.remainingDays,
  }
}

function normalizeSeals(payload, fallback) {
  const value = unwrap(payload, 'seals')
  if (Array.isArray(value)) return value.length ? value : fallback
  if (Array.isArray(value?.seals)) return value.seals.length ? value.seals : fallback
  return fallback
}

function mergeFallback(fallbackData) {
  const merged = { ...DEFAULT_VM, ...(fallbackData || {}) }
  return {
    ...merged,
    header: { ...DEFAULT_VM.header, ...(fallbackData?.header || {}) },
    checklist: fallbackData?.checklist || DEFAULT_VM.checklist,
    comments: normalizeComments(fallbackData?.comments || DEFAULT_VM.comments),
    deliverables: fallbackData?.deliverables || DEFAULT_VM.deliverables,
    completeness: fallbackData?.completeness || DEFAULT_VM.completeness,
    handoff: { ...DEFAULT_VM.handoff, ...(fallbackData?.handoff || {}) },
    relatedDocs: fallbackData?.relatedDocs || DEFAULT_VM.relatedDocs,
    seals: fallbackData?.seals || DEFAULT_VM.seals,
  }
}

function buildRelatedDocs(review, fallback) {
  if (Array.isArray(review.relatedDocs) && review.relatedDocs.length) return review.relatedDocs
  const docs = []
  if (review.assessmentId || review.assessmentVersionId) {
    docs.push({ label: '实施评估', to: `/assessments/${review.assessmentId || review.assessmentVersionId}` })
  }
  if (review.resourceCostId) {
    docs.push({ label: '资源成本', to: `/resource-costs/${review.resourceCostId}` })
  }
  if (review.requirementId || review.globalVersionCode) {
    docs.push({ label: '需求', to: `/requirements/${review.requirementId || review.globalVersionCode}` })
  }
  return docs.length ? docs : fallback
}

function resultError(error) {
  return error?.message || '操作失败，请稍后重试'
}

export default function useReviewDetail(reviewId, {
  enabled = isAuthenticated(),
  fallbackData = null,
} = {}) {
  const fallback = useMemo(() => mergeFallback(fallbackData), [fallbackData])
  const [vm, setVm] = useState(() => ({ ...fallback, loading: Boolean(enabled), error: null }))
  const [meta, setMeta] = useState({ review: null, versionId: fallback.versionId || '', teamId: fallback.teamId || 'TEAM-001' })
  const [actionLoading, setActionLoading] = useState({})

  const withAction = useCallback(async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      await task()
      return { success: true, error: null }
    } catch (error) {
      return { success: false, error: resultError(error) }
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  useEffect(() => {
    if (!enabled || !reviewId) {
      setVm({ ...fallback, loading: false, error: null })
      setMeta({ review: null, versionId: fallback.versionId || '', teamId: fallback.teamId || 'TEAM-001' })
      return undefined
    }

    let cancelled = false
    const safeGet = (path, params) => apiClient.get(path, params).catch((error) => ({ __error: error }))

    setVm((current) => ({ ...current, loading: true, error: null }))

    async function load() {
      try {
        const reviewPayload = await apiClient.get(`/pm/reviews/${reviewId}`)
        if (cancelled) return

        const review = unwrap(reviewPayload) || {}
        const versionId = review.versionId || review.assessmentVersionId || review.globalVersionCode || fallback.versionId || reviewId
        const teamId = review.teamId || review.team?.teamId || fallback.teamId || 'TEAM-001'

        const [deliverablesPayload, handoffsPayload, commentsPayload, sealsPayload] = await Promise.all([
          safeGet(`/pm/versions/${versionId}/deliverables`),
          safeGet('/pm/handoffs', { version: versionId, toRole: 'PM' }),
          safeGet(`/teams/${teamId}/reviews/${reviewId}/comments`),
          safeGet(`/pm/versions/${versionId}/seal`),
        ])
        if (cancelled) return

        const checklist = normalizeChecklist(review.checklist)
        const passed = checklist.filter((item) => item.status === '通过').length
        const total = checklist.length || fallback.checklist.length

        setMeta({ review, versionId, teamId })
        setVm({
          header: {
            versionLabel: review.versionLabel || review.title || review.globalVersionCode || fallback.header.versionLabel,
            initiator: displayUser(review.initiator || review.createdBy || review.initiatorUser, fallback.header.initiator),
            reviewers: review.reviewers || displayUser(review.reviewer || review.reviewerUser, fallback.header.reviewers),
            deadline: formatDate(review.deadline) || fallback.header.deadline,
            remainingDays: daysUntil(review.deadline) || fallback.header.remainingDays,
          },
          checklist,
          comments: normalizeComments(asArray(commentsPayload, 'comments')).length
            ? normalizeComments(asArray(commentsPayload, 'comments'))
            : fallback.comments,
          deliverables: normalizeDeliverables(asArray(deliverablesPayload, 'deliverables'), fallback.deliverables),
          completeness: {
            percent: total ? Math.round((passed / total) * 100) : 0,
            passed,
            total,
          },
          handoff: normalizeHandoff(asArray(handoffsPayload, 'handoffs'), fallback.handoff),
          relatedDocs: buildRelatedDocs(review, fallback.relatedDocs),
          reviewStatus: mapReviewStatus(review),
          seals: normalizeSeals(sealsPayload, fallback.seals),
          loading: false,
          error: null,
        })
      } catch (error) {
        if (cancelled) return
        setVm({ ...fallback, loading: false, error })
      }
    }

    load()
    return () => { cancelled = true }
  }, [enabled, fallback, reviewId])

  const generateOne = useCallback((deliverableId) => withAction(`generate:${deliverableId}`, async () => {
    if (enabled) {
      const payload = await apiClient.post('/pm/deliverables/generate', {
        deliverableIds: [deliverableId],
        assessmentVersionId: meta.versionId,
      })
      const mapped = normalizeDeliverables(asArray(payload, 'deliverables'), [])
      if (mapped.length) {
        setVm((current) => ({ ...current, deliverables: current.deliverables.map((item) => item.id === deliverableId ? { ...item, ...mapped[0], id: item.id } : item) }))
        return
      }
    }
    setVm((current) => ({
      ...current,
      deliverables: current.deliverables.map((item) => item.id === deliverableId ? { ...item, status: 'generated', generatedAt: nowLabel() } : item),
    }))
  }), [enabled, meta.versionId, withAction])

  const generateAll = useCallback(() => withAction('generateAll', async () => {
    const pendingIds = vm.deliverables.filter((item) => item.status === 'pending').map((item) => item.id)
    if (enabled) {
      const payload = await apiClient.post('/pm/deliverables/generate', {
        deliverableIds: pendingIds,
        assessmentVersionId: meta.versionId,
      })
      const mapped = normalizeDeliverables(asArray(payload, 'deliverables'), [])
      if (mapped.length) {
        setVm((current) => ({ ...current, deliverables: mapped }))
        return
      }
    }
    setVm((current) => ({
      ...current,
      deliverables: current.deliverables.map((item) => item.status === 'pending' ? { ...item, status: 'generated', generatedAt: nowLabel() } : item),
    }))
  }), [enabled, meta.versionId, vm.deliverables, withAction])

  const sealDeliverable = useCallback((deliverableId, sealId) => withAction(`seal:${deliverableId}`, async () => {
    const seal = vm.seals.find((item) => item.id === sealId) || vm.seals[0]
    if (enabled) {
      await apiClient.post('/pm/seal', {
        deliverableId,
        sealId,
        assessmentVersionId: meta.versionId,
        artifactsSnapshot: { deliverableIds: [deliverableId] },
      })
    }
    setVm((current) => ({
      ...current,
      deliverables: current.deliverables.map((item) => item.id === deliverableId ? { ...item, status: 'sealed', sealName: seal?.name || '' } : item),
    }))
  }), [enabled, meta.versionId, vm.seals, withAction])

  const rejectReview = useCallback((reason) => withAction('rejectReview', async () => {
    if (enabled) {
      await apiClient.patch(`/pm/reviews/${reviewId}`, {
        verdict: 'reject',
        reason,
        rejectionReasons: [{ field: 'review', reason }],
        notes: reason,
      })
    }
    setVm((current) => ({ ...current, reviewStatus: 'rejected' }))
  }), [enabled, reviewId, withAction])

  const approveReview = useCallback(() => withAction('approveReview', async () => {
    if (enabled) await apiClient.patch(`/pm/reviews/${reviewId}`, { verdict: 'pass' })
    setVm((current) => ({ ...current, reviewStatus: 'approved' }))
  }), [enabled, reviewId, withAction])

  const addComment = useCallback((text) => withAction('addComment', async () => {
    let nextComment = { name: '当前用户', time: nowLabel(), text, avatarInitial: '当' }
    if (enabled) {
      const payload = await apiClient.post(`/teams/${meta.teamId}/reviews/${reviewId}/comments`, { text, content: text })
      nextComment = normalizeComments([unwrap(payload) || { content: text, createdAt: new Date().toISOString() }])[0]
    }
    setVm((current) => ({ ...current, comments: [...current.comments, nextComment] }))
  }), [enabled, meta.teamId, reviewId, withAction])

  const initiateHandoff = useCallback(() => withAction('initiateHandoff', async () => {
    if (enabled) {
      await apiClient.post('/pm/handoffs', {
        assessmentVersionId: meta.versionId,
        fromRole: vm.handoff.fromRole || 'IMPL',
        toRole: vm.handoff.toRole || 'PM',
        notes: `Review ${reviewId} handoff`,
      })
    }
  }), [enabled, meta.versionId, reviewId, vm.handoff, withAction])

  return {
    ...vm,
    actionLoading,
    actions: {
      generateOne,
      generateAll,
      sealDeliverable,
      rejectReview,
      approveReview,
      addComment,
      initiateHandoff,
    },
  }
}
