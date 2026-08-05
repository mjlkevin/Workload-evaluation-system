import { useLayoutEffect, useMemo, useState } from 'react'
import { summarizeCompanyProfile } from '../../../../api/ai.js'
import {
  firstBusinessValue,
  inferCustomerNameFromFileName,
  isFilledBusinessValue,
  normalizePendingText,
  pickArray,
  stripPendingMarker,
} from '../../utils/harnessPayload.js'

/**
 * 报告卡片草稿状态：可编辑业务字段、客户主体检索、补充提交。
 * 依赖 extractReportCardData 的派生结果，保持与原卡片行为一致。
 */
export default function useReportDraft({ artifact, content, project, understandingProject, editableMissingFields, artifactIdentity, onSubmitSupplement }) {
  const baseDraft = useMemo(() => {
    const coreProject = content.project || {}
    const missingAnswerMap = {}
    const questionAnswerMap = {}
    editableMissingFields.forEach((item) => {
      const row = item || {}
      const key = row.field || row.reason
      if (key) missingAnswerMap[key] = ''
    })
    pickArray(content.clarificationQuestions).forEach((item) => {
      const row = item || {}
      const key = row.question || row.reason
      if (key) questionAnswerMap[key] = ''
    })
    return {
      projectName: firstBusinessValue(coreProject.projectName, content.projectName, understandingProject.projectName),
      customerName: firstBusinessValue(coreProject.customerName, content.customerName, understandingProject.customerName, inferCustomerNameFromFileName(content.sourceFile)),
      industry: firstBusinessValue(coreProject.industry, content.industry, understandingProject.industry),
      location: '',
      enterpriseProfile: '',
      enterpriseRevenue: '',
      itStatus: '',
      missingAnswers: missingAnswerMap,
      questionAnswers: questionAnswerMap,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactIdentity])
  const [draft, setDraft] = useState(baseDraft)
  const [dirtyFields, setDirtyFields] = useState({})
  const [editingKey, setEditingKey] = useState('')
  const [lookupState, setLookupState] = useState({ loading: false, candidates: [], error: '', selectedName: '', dialogOpen: false })
  const [submitState, setSubmitState] = useState({ loading: false, error: '' })

  useLayoutEffect(() => {
    setDraft(baseDraft)
    setDirtyFields({})
    setEditingKey('')
    setLookupState({ loading: false, candidates: [], error: '', selectedName: '', dialogOpen: false })
    setSubmitState({ loading: false, error: '' })
  }, [baseDraft])

  function updateDraftValue(fieldKey, value) {
    setDraft((prev) => {
      if (fieldKey.startsWith('missing:')) {
        const key = fieldKey.slice('missing:'.length)
        return { ...prev, missingAnswers: { ...prev.missingAnswers, [key]: value } }
      }
      if (fieldKey.startsWith('question:')) {
        const key = fieldKey.slice('question:'.length)
        return { ...prev, questionAnswers: { ...prev.questionAnswers, [key]: value } }
      }
      return { ...prev, [fieldKey]: value }
    })
    setDirtyFields((prev) => ({ ...prev, [fieldKey]: true }))
  }

  function finishDraftEdit() {
    setEditingKey('')
  }

  function applyCompanyProfile(profile, selectedName = '') {
    const nextValues = {
      customerName: profile.customerName || profile.displayName || selectedName || draft.customerName,
      industry: profile.customerIndustry || profile.industry || draft.industry,
      location: profile.location || draft.location,
      enterpriseProfile: profile.enterpriseProfile || draft.enterpriseProfile,
      enterpriseRevenue: profile.enterpriseRevenue || draft.enterpriseRevenue,
      itStatus: profile.itStatus || draft.itStatus,
    }
    setDraft((prev) => ({ ...prev, ...nextValues }))
    setDirtyFields((prev) => ({
      ...prev,
      customerName: true,
      industry: Boolean(nextValues.industry) || prev.industry,
      location: Boolean(nextValues.location) || prev.location,
      enterpriseProfile: Boolean(nextValues.enterpriseProfile) || prev.enterpriseProfile,
      enterpriseRevenue: Boolean(nextValues.enterpriseRevenue) || prev.enterpriseRevenue,
      itStatus: Boolean(nextValues.itStatus) || prev.itStatus,
    }))
    setLookupState({ loading: false, candidates: [], error: '', selectedName: nextValues.customerName || selectedName })
  }

  async function lookupCustomer() {
    const customerName = stripPendingMarker(draft.customerName || project.customerName || content.customerName)
    if (!customerName) {
      setLookupState({ loading: false, candidates: [], error: '请先补充客户简称或名称片段', selectedName: lookupState.selectedName })
      return
    }
    setLookupState((prev) => ({ ...prev, loading: true, error: '', candidates: [] }))
    try {
      const profile = await summarizeCompanyProfile({
        customerName,
        customerIndustry: stripPendingMarker(draft.industry),
      })
      const candidates = pickArray(profile?.disambiguationCandidates)
      if (profile?.mode === 'disambiguation' && candidates.length) {
        setLookupState({ loading: false, candidates, error: '', selectedName: '', dialogOpen: true })
      } else {
        applyCompanyProfile(profile || {}, profile?.customerName || customerName)
      }
    } catch (err) {
      setLookupState({ loading: false, candidates: [], error: `客户主体检索失败：${err.message || '请求失败'}`, selectedName: '' })
    }
  }

  async function selectCustomerCandidate(candidate) {
    const displayName = candidate.displayName || candidate.customerName || candidate.name || candidate.title || ''
    if (!displayName) return
    const customerName = stripPendingMarker(draft.customerName || displayName)
    setLookupState((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const profile = await summarizeCompanyProfile({
        customerName: customerName || displayName,
        customerIndustry: stripPendingMarker(draft.industry),
        disambiguationChoice: {
          displayName,
          summary: candidate.summary || candidate.description || '',
        },
      })
      applyCompanyProfile({ ...candidate, ...profile, customerName: profile?.customerName || displayName }, displayName)
      setLookupState((prev) => ({ ...prev, dialogOpen: false }))
    } catch (err) {
      applyCompanyProfile({ ...candidate, customerName: displayName }, displayName)
      setLookupState((prev) => ({ ...prev, loading: false, error: `主体详情补全失败：${err.message || '请求失败'}`, dialogOpen: false }))
    }
  }

  function buildSupplementAnswers() {
    const answers = []
    const add = (field, value, extra = {}) => {
      const text = normalizePendingText(value)
      if (!text) return
      answers.push({ field, value: text, source: 'structured_card_inline', ...extra })
    }
    const addBusiness = (field, value) => add(field, stripPendingMarker(value))
    if (dirtyFields.projectName || isFilledBusinessValue(draft.projectName)) addBusiness('projectName', draft.projectName)
    if (dirtyFields.customerName || isFilledBusinessValue(draft.customerName)) addBusiness('customerName', draft.customerName)
    if (dirtyFields.industry || isFilledBusinessValue(draft.industry)) addBusiness('industry', draft.industry)
    if (dirtyFields.location) add('location', draft.location)
    if (dirtyFields.enterpriseProfile) add('enterpriseProfile', draft.enterpriseProfile)
    if (dirtyFields.enterpriseRevenue) add('enterpriseRevenue', draft.enterpriseRevenue)
    if (dirtyFields.itStatus) add('itStatus', draft.itStatus)
    Object.entries(draft.missingAnswers || {}).forEach(([field, value]) => add(field, value))
    Object.entries(draft.questionAnswers || {}).forEach(([field, value]) => add(field, value))
    return answers
  }

  async function submitStructuredSupplement() {
    const answers = buildSupplementAnswers()
    if (!answers.length || !onSubmitSupplement) return
    setSubmitState({ loading: true, error: '' })
    try {
      await onSubmitSupplement(artifact, answers)
      setSubmitState({ loading: false, error: '' })
    } catch (err) {
      setSubmitState({ loading: false, error: `提交补充失败：${err.message || '请求失败'}` })
    }
  }

  return {
    draft,
    editingKey,
    setEditingKey,
    lookupState,
    setLookupState,
    submitState,
    updateDraftValue,
    finishDraftEdit,
    lookupCustomer,
    selectCustomerCandidate,
    supplementAnswers: buildSupplementAnswers(),
    submitStructuredSupplement,
  }
}
