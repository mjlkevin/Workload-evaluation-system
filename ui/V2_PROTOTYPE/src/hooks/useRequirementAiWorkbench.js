import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client.js'
import { downloadJSON } from '../utils/download.js'

const DEFAULT_ACCEPTED = []
const DEFAULT_CONFIRMATION_QUESTIONS = []
const DEFAULT_FEEDBACK_RECORDS = []
const DEFAULT_PROMPT = '请解析这份原始需求文件，重点识别业务需求及问题，并生成可用于实施评估的初稿。'

function unwrapData(payload) {
  return payload?.data || payload || null
}

function unwrapItems(payload) {
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.data)) return payload.data
  return Array.isArray(payload) ? payload : []
}

function summarizeParsedFile(file, parsed) {
  const data = unwrapData(parsed) || {}
  const importData = data.requirementImportData || {}
  const businessRows = Array.isArray(importData.businessNeedRows) ? importData.businessNeedRows : []
  const valueRows = Array.isArray(importData.valuePropositionRows) ? importData.valuePropositionRows : []
  const keyRows = Array.isArray(importData.keyPointRows) ? importData.keyPointRows : []
  const inferredTopics = new Set(businessRows.map((row) => row.businessDomain || row.category).filter(Boolean)).size

  return {
    fileName: file?.name || '已上传文件',
    rawRows: businessRows.length || data.rawRows || 0,
    topics: data.topics ?? (businessRows.length ? Math.max(1, inferredTopics) : 0),
    integrationRisks: businessRows.filter((row) => String(row.standardImplemented || '').includes('未') || row.requiresCustomDev).length,
    confirmQuestions: keyRows.length,
    valueRows: valueRows.length,
    mode: data.mode || data.model || 'model',
  }
}

function isRuleFallbackValue(value) {
  const text = String(value || '').toLowerCase()
  return text.includes('rule_fallback') || text.includes('rule-fallback')
}

function isLegacyRuleFallbackEvaluation(saved) {
  return isRuleFallbackValue(saved?.mode)
    || isRuleFallbackValue(saved?.parseSummary?.mode)
    || isRuleFallbackValue(saved?.parseSummary?.model)
    || isRuleFallbackValue(saved?.lastPreview?.meta?.mode)
    || isRuleFallbackValue(saved?.lastPreview?.meta?.model)
}

function sourceFileSnapshot(selectedFile, parseSummary, savedSourceFile) {
  if (selectedFile) {
    return {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
    }
  }
  if (savedSourceFile) return savedSourceFile
  if (parseSummary?.fileName) return { name: parseSummary.fileName }
  return null
}

function uniqueCompact(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function buildAssessmentSeed({
  accepted,
  confirmationQuestions,
  feedbackRecords,
  lastPreview,
  parseSummary,
  requirementId,
  savedSourceFile,
  selectedFile,
  userInstruction,
}) {
  const draft = lastPreview?.assessmentDraft || {}
  const moduleItems = Array.isArray(draft.moduleItems) ? draft.moduleItems : []
  const cloudProducts = uniqueCompact(moduleItems.map((item) => item.cloudProduct))
  const productLines = Array.isArray(draft.productLines) && draft.productLines.length
    ? draft.productLines
    : cloudProducts

  return {
    mode: 'conversation',
    sourceRequirementVersionId: requirementId,
    generatedAt: new Date().toISOString(),
    sourceFile: sourceFileSnapshot(selectedFile, parseSummary, savedSourceFile),
    parseSummary,
    userInstruction,
    quoteMode: draft.quoteMode || '模块报价',
    productLines,
    cloudProducts,
    selectedCloudNames: cloudProducts,
    params: {
      userCount: Number(draft.userCount) || 0,
      userCountMax: 500,
      difficultyFactor: Number(draft.difficultyFactor) || 1,
      orgCount: Number(draft.orgCount) || 1,
      orgSimilarity: Number(draft.orgSimilarity) || 1,
    },
    moduleItems,
    risks: Array.isArray(draft.risks) ? draft.risks : [],
    assumptions: Array.isArray(draft.assumptions) ? draft.assumptions : [],
    acceptedInputs: accepted,
    confirmationQuestions,
    feedbackRecords,
    lastPreview,
  }
}

function buildAssessmentPayload(seed) {
  const totalSuggestedDays = seed.moduleItems.reduce((sum, item) => sum + (Number(item.suggestedDays) || 0), 0)
  const projectName = seed.sourceFile?.name
    ? `AI评估-${seed.sourceFile.name.replace(/\.[^.]+$/, '')}`
    : `AI评估-${String(seed.sourceRequirementVersionId || '需求').slice(0, 8)}`

  return {
    projectName,
    quoteMode: seed.quoteMode,
    productLines: seed.productLines,
    cloudProducts: seed.cloudProducts,
    selectedCloudNames: seed.selectedCloudNames,
    params: seed.params,
    requirementSource: {
      type: 'aiConversation',
      sourceRequirementVersionId: seed.sourceRequirementVersionId,
      sourceFile: seed.sourceFile,
      parseSummary: seed.parseSummary,
      userInstruction: seed.userInstruction,
    },
    aiAssessmentSeed: seed,
    assessmentDraft: {
      moduleItems: seed.moduleItems,
      risks: seed.risks,
      assumptions: seed.assumptions,
      totalSuggestedDays: Math.round(totalSuggestedDays * 10) / 10,
    },
    handoffNotes: {
      acceptedInputs: seed.acceptedInputs,
      confirmationQuestions: seed.confirmationQuestions,
      feedbackRecords: seed.feedbackRecords,
    },
  }
}

export default function useRequirementAiWorkbench({ requirementId } = {}) {
  const fileInputRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [composer, setComposer] = useState(DEFAULT_PROMPT)
  const [analysisRequest, setAnalysisRequest] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [accepted, setAccepted] = useState(DEFAULT_ACCEPTED)
  const [confirmationQuestions, setConfirmationQuestions] = useState(DEFAULT_CONFIRMATION_QUESTIONS)
  const [feedbackRecords, setFeedbackRecords] = useState(DEFAULT_FEEDBACK_RECORDS)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creatingAssessment, setCreatingAssessment] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [parseSummary, setParseSummary] = useState(null)
  const [lastPreview, setLastPreview] = useState(null)
  const [savedSourceFile, setSavedSourceFile] = useState(null)
  const [versionRecord, setVersionRecord] = useState(null)
  const [latestRequirement, setLatestRequirement] = useState(null)
  const [error, setError] = useState(null)
  const [errorScope, setErrorScope] = useState(null)
  const [loadStatus, setLoadStatus] = useState('idle')

  useEffect(() => {
    if (!requirementId) return undefined

    let cancelled = false
    setLoadingSaved(true)
    setLoadStatus('loading')
    apiClient.get(`/versions/${requirementId}`)
      .then((versionPayload) => {
        if (cancelled) return
        setLoadStatus('ready')
        const versionData = unwrapData(versionPayload) || {}
        const record = versionData.record || versionData
        setVersionRecord(record)
        const saved = record?.payload?.aiEvaluation
        if (!saved || typeof saved !== 'object') return
        if (saved.sourceFile) setSavedSourceFile(saved.sourceFile)
        if (saved.userInstruction) {
          setAnalysisRequest(saved.userInstruction)
          setComposer(saved.userInstruction)
        }
        if (isLegacyRuleFallbackEvaluation(saved)) {
          setParseSummary(null)
          setLastPreview(null)
          setAccepted(DEFAULT_ACCEPTED)
          setConfirmationQuestions(DEFAULT_CONFIRMATION_QUESTIONS)
          setFeedbackRecords(DEFAULT_FEEDBACK_RECORDS)
          setError('旧规则兜底结果已停用，请重新上传文件并使用模型完成分析。')
          setErrorScope('analysis')
          return
        }
        if (Array.isArray(saved.acceptedInputs)) setAccepted(saved.acceptedInputs)
        if (Array.isArray(saved.confirmationQuestions)) setConfirmationQuestions(saved.confirmationQuestions)
        if (Array.isArray(saved.feedbackRecords)) setFeedbackRecords(saved.feedbackRecords)
        if (saved.parseSummary) setParseSummary(saved.parseSummary)
        if (saved.lastPreview) setLastPreview(saved.lastPreview)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || '加载历史评估失败')
          setErrorScope('load')
          setLoadStatus(err?.status === 404 ? 'not_found' : 'error')
          if (err?.status === 404) {
            apiClient.get('/versions', { type: 'requirementImport' })
              .then((payload) => {
                if (cancelled) return
                const [latest] = unwrapItems(payload)
                if (latest) setLatestRequirement(latest)
              })
              .catch(() => {})
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSaved(false)
      })

    return () => { cancelled = true }
  }, [requirementId])

  const showToast = useCallback((text) => {
    setToast(text)
    window.setTimeout(() => setToast(''), 1500)
  }, [])

  const chooseFile = useCallback(() => fileInputRef.current?.click(), [])

  const onFileChange = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setError(null)
    setErrorScope(null)
    showToast(`已附加文件：${file.name}`)
  }, [showToast])

  const askOrRevise = useCallback((message) => {
    setFeedbackOpen(true)
    setFeedbackRecords((records) => [
      ...records,
      { key: '反馈', value: message },
    ])
    showToast(message)
  }, [showToast])

  const acceptItem = useCallback((item = {}) => {
    setAccepted((items) => [
      ...items,
      {
        title: item.title || '新采纳评估项',
        tag: item.tag || '刚刚',
        desc: item.desc || '从对话评估结果中采纳，等待 PM 进一步估算。',
      },
    ])
    showToast('已采纳到实施评估输入池')
  }, [showToast])

  const handleResultAction = useCallback((action, contextTitle = '当前评估项') => {
    if (action === 'ask') {
      askOrRevise(`已记录对「${contextTitle}」的追问`)
      return
    }
    if (action === 'revise') {
      askOrRevise(`已记录对「${contextTitle}」的修正意图`)
      return
    }
    if (action === 'evidence') {
      showToast('右侧已定位到来源依据')
      return
    }
    if (action === 'confirm') {
      const question = `请确认「${contextTitle}」的实施范围、前提假设与验收边界。`
      setConfirmationQuestions((questions) => (
        questions.includes(question)
          ? questions
          : [...questions, question]
      ))
      showToast('已加入售前待确认问题')
      return
    }
    if (action === 'accept') {
      acceptItem()
    }
  }, [acceptItem, askOrRevise, showToast])

  const analyze = useCallback(async () => {
    if (!selectedFile) {
      askOrRevise('请先附加原始需求文件')
      return
    }

    setLoading(true)
    setError(null)
    setErrorScope(null)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const userInstruction = composer.trim() || DEFAULT_PROMPT
      setAnalysisRequest(userInstruction)
      const parsed = await apiClient.upload('/ai/parse-basic-info', formData)
      const summary = summarizeParsedFile(selectedFile, parsed)
      setParseSummary(summary)

      const preview = await apiClient.post('/ai/kimi-assessment/preview', {
        requirementSnapshot: {
          requirementId,
          fileName: selectedFile.name,
          parseSummary: summary,
          userInstruction,
          parsed: unwrapData(parsed),
        },
      })
      setLastPreview(unwrapData(preview))
      showToast('文件解析与评估预览已更新')
    } catch (err) {
      setError(err?.message || '分析失败')
      setErrorScope('analysis')
      showToast(err?.message || '分析失败，已保留当前草稿')
    } finally {
      setLoading(false)
    }
  }, [askOrRevise, composer, requirementId, selectedFile, showToast])

  const saveEvaluationDraft = useCallback(async () => {
    if (!requirementId) {
      showToast('缺少需求版本 ID，无法保存')
      return
    }

    setSaving(true)
    setError(null)
    setErrorScope(null)
    try {
      const versionPayload = await apiClient.get(`/versions/${requirementId}`)
      const versionData = unwrapData(versionPayload) || {}
      const record = versionData.record || versionData
      if (record.checkoutStatus !== 'checked_out') {
        await apiClient.post(`/versions/${requirementId}/checkout`)
      }

      const currentPayload = record.payload && typeof record.payload === 'object' ? record.payload : {}
      const assessmentSeed = buildAssessmentSeed({
        accepted,
        confirmationQuestions,
        feedbackRecords,
        lastPreview,
        parseSummary,
        requirementId,
        savedSourceFile,
        selectedFile,
        userInstruction: analysisRequest || composer,
      })
      const sourceFile = sourceFileSnapshot(selectedFile, parseSummary, savedSourceFile)
      const nextPayload = {
        ...currentPayload,
        aiEvaluation: {
          ...(currentPayload.aiEvaluation || {}),
          mode: 'conversation',
          sourceFile,
          parseSummary,
          userInstruction: analysisRequest || composer,
          acceptedInputs: accepted,
          confirmationQuestions,
          feedbackRecords,
          lastPreview,
          assessmentSeed,
          updatedAt: new Date().toISOString(),
        },
      }

      await apiClient.patch(`/versions/${requirementId}/save-draft`, { payload: nextPayload })
      showToast('已保存到需求版本草稿')
    } catch (err) {
      setError(err?.message || '保存失败')
      setErrorScope('save')
      showToast(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [accepted, analysisRequest, composer, confirmationQuestions, feedbackRecords, lastPreview, parseSummary, requirementId, savedSourceFile, selectedFile, showToast])

  const createAssessmentDraft = useCallback(async () => {
    if (!requirementId) {
      showToast('缺少需求版本 ID，无法创建实施评估')
      return null
    }
    if (!lastPreview?.assessmentDraft) {
      showToast('请先发送文件生成评估预览')
      return null
    }

    setCreatingAssessment(true)
    setError(null)
    setErrorScope(null)
    try {
      const seed = buildAssessmentSeed({
        accepted,
        confirmationQuestions,
        feedbackRecords,
        lastPreview,
        parseSummary,
        requirementId,
        savedSourceFile,
        selectedFile,
        userInstruction: analysisRequest || composer,
      })
      const payload = buildAssessmentPayload(seed)
      const created = await apiClient.post('/versions', {
        type: 'assessment',
        payload,
      })
      const createdData = unwrapData(created) || {}
      const record = createdData.record || createdData
      showToast('已生成实施评估草稿')
      return record
    } catch (err) {
      setError(err?.message || '创建实施评估草稿失败')
      setErrorScope('createAssessment')
      showToast(err?.message || '创建实施评估草稿失败')
      return null
    } finally {
      setCreatingAssessment(false)
    }
  }, [accepted, analysisRequest, composer, confirmationQuestions, feedbackRecords, lastPreview, parseSummary, requirementId, savedSourceFile, selectedFile, showToast])

  const exportConversation = useCallback(() => {
    const assessmentSeed = buildAssessmentSeed({
      accepted,
      confirmationQuestions,
      feedbackRecords,
      lastPreview,
      parseSummary,
      requirementId,
      savedSourceFile,
      selectedFile,
      userInstruction: analysisRequest || composer,
    })
    downloadJSON({
      requirementId,
      exportedAt: new Date().toISOString(),
      mode: 'conversation',
      sourceFile: assessmentSeed.sourceFile,
      parseSummary,
      userInstruction: analysisRequest || composer,
      acceptedInputs: accepted,
      confirmationQuestions,
      feedbackRecords,
      lastPreview,
      assessmentSeed,
    }, `requirement-ai-evaluation-${requirementId || 'draft'}.json`)
    showToast('已导出对话式评估草稿')
  }, [accepted, analysisRequest, composer, confirmationQuestions, feedbackRecords, lastPreview, parseSummary, requirementId, savedSourceFile, selectedFile, showToast])

  return {
    accepted,
    analyze,
    acceptEvaluationInput: acceptItem,
    analysisRequest,
    chooseFile,
    composer,
    confirmationQuestions,
    createAssessmentDraft,
    creatingAssessment,
    error,
    errorScope,
    loadStatus,
    exportConversation,
    feedbackOpen,
    feedbackRecords,
    fileInputRef,
    handleResultAction,
    lastPreview,
    latestRequirement,
    loading,
    loadingSaved,
    onFileChange,
    parseSummary,
    saveEvaluationDraft,
    savedSourceFile,
    saving,
    selectedFile,
    setComposer,
    toast,
    versionRecord,
  }
}
