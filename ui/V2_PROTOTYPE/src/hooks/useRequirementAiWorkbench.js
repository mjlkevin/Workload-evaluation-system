import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client.js'
import { downloadJSON } from '../utils/download.js'

const DEFAULT_ACCEPTED = []
const DEFAULT_CONFIRMATION_QUESTIONS = []
const DEFAULT_FEEDBACK_RECORDS = []
const DEFAULT_PROMPT = '请解析这份原始需求文件，重点识别业务需求及问题，并生成可用于实施评估的初稿。'
const DEFAULT_THREAD_TITLE = '需求 AI 评估对话'

function unwrapData(payload) {
  return payload?.data || payload || null
}

function unwrapItems(payload) {
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.data)) return payload.data
  return Array.isArray(payload) ? payload : []
}

function createId(prefix) {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `${prefix}_${randomId}`
}

function createMessage({ role, type = 'text', content = '', attachments = [], artifactId = '', targetArtifactId = '', targetPath = '', createdAt } = {}) {
  return {
    id: createId('msg'),
    role,
    type,
    content,
    attachments,
    artifactId,
    targetArtifactId,
    targetPath,
    createdAt: createdAt || new Date().toISOString(),
  }
}

function fileAttachmentSnapshot(file) {
  if (!file) return []
  return [{
    id: createId('att'),
    name: file.name,
    size: file.size,
    type: file.type,
  }]
}

function normalizeThreads(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((thread) => thread && typeof thread === 'object')
    .map((thread) => ({
      id: thread.id || createId('thread'),
      title: thread.title || DEFAULT_THREAD_TITLE,
      status: thread.status || 'active',
      createdAt: thread.createdAt || new Date().toISOString(),
      updatedAt: thread.updatedAt || thread.createdAt || new Date().toISOString(),
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      artifacts: thread.artifacts && typeof thread.artifacts === 'object' ? thread.artifacts : {},
    }))
}

function buildThreadState({
  activeThreadId,
  artifacts = {},
  messages = [],
  requirementId,
  sourceName,
  threads = [],
}) {
  const nextActiveThreadId = activeThreadId || threads[0]?.id || createId('thread')
  const existing = threads.find((thread) => thread.id === nextActiveThreadId)
  const now = new Date().toISOString()
  const nextThread = {
    id: nextActiveThreadId,
    title: existing?.title || sourceName || DEFAULT_THREAD_TITLE,
    status: existing?.status || 'active',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    requirementVersionId: requirementId,
    messages,
    artifacts: {
      ...(existing?.artifacts || {}),
      ...artifacts,
    },
  }
  const others = threads.filter((thread) => thread.id !== nextActiveThreadId)
  return {
    activeThreadId: nextActiveThreadId,
    threads: [nextThread, ...others],
    activeThread: nextThread,
  }
}

function deriveLatestArtifact(messages, artifacts, type) {
  const message = [...messages].reverse().find((item) => item.type === type && item.artifactId)
  return message ? artifacts?.[message.artifactId] : null
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
  activeThreadId,
  confirmationQuestions,
  feedbackRecords,
  lastPreview,
  messages,
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
    activeThreadId,
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
    messages,
  }
}

function buildAiEvaluationDraft({
  accepted,
  activeThreadId,
  analysisRequest,
  artifacts,
  composer,
  confirmationQuestions,
  feedbackRecords,
  lastPreview,
  messages,
  parseSummary,
  requirementId,
  savedSourceFile,
  selectedFile,
  threads,
}) {
  const sourceFile = sourceFileSnapshot(selectedFile, parseSummary, savedSourceFile)
  const assessmentSeed = buildAssessmentSeed({
    accepted,
    activeThreadId,
    confirmationQuestions,
    feedbackRecords,
    lastPreview,
    messages,
    parseSummary,
    requirementId,
    savedSourceFile,
    selectedFile,
    userInstruction: analysisRequest || composer,
  })
  const { activeThreadId: nextActiveThreadId, threads: nextThreads } = buildThreadState({
    activeThreadId,
    artifacts: {
      ...(parseSummary ? { latestParseSummary: parseSummary } : {}),
      ...(lastPreview ? { latestAssessmentPreview: lastPreview } : {}),
      ...(artifacts || {}),
    },
    messages,
    requirementId,
    sourceName: sourceFile?.name,
    threads,
  })

  return {
    mode: 'conversation',
    activeThreadId: nextActiveThreadId,
    threads: nextThreads,
    sourceFile,
    parseSummary,
    userInstruction: analysisRequest || composer,
    acceptedInputs: accepted,
    confirmationQuestions,
    feedbackRecords,
    lastPreview,
    assessmentSeed,
    updatedAt: new Date().toISOString(),
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
      activeThreadId: seed.activeThreadId,
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
      messages: seed.messages,
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
  const [messages, setMessages] = useState([])
  const [threads, setThreads] = useState([])
  const [activeThreadId, setActiveThreadId] = useState('')
  const [artifacts, setArtifacts] = useState({})
  const [savedSourceFile, setSavedSourceFile] = useState(null)
  const [versionRecord, setVersionRecord] = useState(null)
  const [latestRequirement, setLatestRequirement] = useState(null)
  const [error, setError] = useState(null)
  const [errorScope, setErrorScope] = useState(null)
  const [loadStatus, setLoadStatus] = useState('idle')
  // ISS-2026-08-18-005（档 1）：persist 失败页面级可见状态位——
  // 用状态位而非 toast 实现节流：连续操作失败只置一次位，不会弹一串 toast。
  const [draftPersistError, setDraftPersistError] = useState(null)

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
          setMessages([])
          setThreads([])
          setActiveThreadId('')
          setArtifacts({})
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
        const savedThreads = normalizeThreads(saved.threads)
        if (savedThreads.length) {
          const nextActiveThreadId = saved.activeThreadId || savedThreads[0].id
          const activeThread = savedThreads.find((thread) => thread.id === nextActiveThreadId) || savedThreads[0]
          setThreads(savedThreads)
          setActiveThreadId(activeThread.id)
          setMessages(activeThread.messages)
          setArtifacts(activeThread.artifacts)
          const restoredParse = deriveLatestArtifact(activeThread.messages, activeThread.artifacts, 'parse_summary')
          const restoredPreview = deriveLatestArtifact(activeThread.messages, activeThread.artifacts, 'assessment_preview')
          if (restoredParse) setParseSummary(restoredParse)
          if (restoredPreview) setLastPreview(restoredPreview)
        }
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
              .catch(() => {}) // ISS-2026-08-18-005（档 3）：404 兜底拉取版本列表为最佳努力——失败时 latestRequirement 保持 null，页面仅缺「去新建版本」入口，可静默
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

  // ISS-2026-08-18-005（档 1）：persist 成败统一汇入页面级状态位（横幅），
  // 成功清位、失败置位；配合状态位天然节流，不做逐次 toast。
  const handlePersistResult = useCallback((result) => {
    if (!result) return
    if (result.ok) setDraftPersistError(null)
    else setDraftPersistError(result.error?.message || '草稿保存失败')
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

  const persistAiEvaluationDraft = useCallback(async (overrides = {}) => {
    if (!requirementId) return { ok: false, error: new Error('缺少需求版本 ID') }

    try {
      const nextAccepted = overrides.accepted ?? accepted
      const nextConfirmationQuestions = overrides.confirmationQuestions ?? confirmationQuestions
      const nextFeedbackRecords = overrides.feedbackRecords ?? feedbackRecords
      const nextLastPreview = overrides.lastPreview ?? lastPreview
      const nextMessages = overrides.messages ?? messages
      const nextParseSummary = overrides.parseSummary ?? parseSummary
      const nextSavedSourceFile = overrides.savedSourceFile ?? savedSourceFile
      const nextSelectedFile = overrides.selectedFile ?? selectedFile
      const nextUserInstruction = overrides.userInstruction ?? analysisRequest ?? composer
      const nextActiveThreadId = overrides.activeThreadId ?? activeThreadId
      const nextThreadsInput = overrides.threads ?? threads
      const nextArtifacts = overrides.artifacts ?? artifacts

      const versionPayload = await apiClient.get(`/versions/${requirementId}`)
      const versionData = unwrapData(versionPayload) || {}
      const record = versionData.record || versionData
      if (record.checkoutStatus !== 'checked_out') {
        await apiClient.post(`/versions/${requirementId}/checkout`)
      }

      const currentPayload = record.payload && typeof record.payload === 'object' ? record.payload : {}
      const aiEvaluation = buildAiEvaluationDraft({
        accepted: nextAccepted,
        activeThreadId: nextActiveThreadId,
        analysisRequest: nextUserInstruction,
        artifacts: nextArtifacts,
        composer,
        confirmationQuestions: nextConfirmationQuestions,
        feedbackRecords: nextFeedbackRecords,
        lastPreview: nextLastPreview,
        messages: nextMessages,
        parseSummary: nextParseSummary,
        requirementId,
        savedSourceFile: nextSavedSourceFile,
        selectedFile: nextSelectedFile,
        threads: nextThreadsInput,
      })

      const nextPayload = {
        ...currentPayload,
        aiEvaluation: {
          ...(currentPayload.aiEvaluation || {}),
          ...aiEvaluation,
        },
      }

      await apiClient.patch(`/versions/${requirementId}/save-draft`, { payload: nextPayload })
      setActiveThreadId(aiEvaluation.activeThreadId)
      setThreads(aiEvaluation.threads)
      setArtifacts(aiEvaluation.threads[0]?.artifacts || {})
      return { ok: true, value: aiEvaluation }
    } catch (error) {
      // ISS-2026-08-18-005（档 1）：persist 失败不再 throw——调用处统一通过返回标志
      // 置页面级可见状态位（draftPersistError），避免依赖 .catch(() => {}) 静默吞错。
      return { ok: false, error }
    }
  }, [accepted, activeThreadId, analysisRequest, artifacts, composer, confirmationQuestions, feedbackRecords, lastPreview, messages, parseSummary, requirementId, savedSourceFile, selectedFile, threads])

  const askOrRevise = useCallback((message) => {
    setFeedbackOpen(true)
    const nextFeedbackRecords = [
      ...feedbackRecords,
      { key: '反馈', value: message },
    ]
    const nextMessages = [
      ...messages,
      createMessage({ role: 'user', type: 'inline_feedback', content: message }),
    ]
    setFeedbackRecords(nextFeedbackRecords)
    setMessages(nextMessages)
    showToast(message)
    // ISS-2026-08-18-005（档 1）：persist 失败经状态位可见；
    // 尾部 .catch 仅防 unhandled rejection（persist 内部已捕获，正常不触发）
    persistAiEvaluationDraft({ feedbackRecords: nextFeedbackRecords, messages: nextMessages })
      .then(handlePersistResult)
      .catch(() => {})
  }, [feedbackRecords, handlePersistResult, messages, persistAiEvaluationDraft, showToast])

  const acceptItem = useCallback((item = {}) => {
    const acceptedItem = {
      title: item.title || '新采纳评估项',
      tag: item.tag || '刚刚',
      desc: item.desc || '从对话评估结果中采纳，等待 PM 进一步估算。',
    }
    const nextAccepted = [...accepted, acceptedItem]
    const nextMessages = [
      ...messages,
      createMessage({ role: 'user', type: 'accept', content: `采纳：${acceptedItem.title}` }),
    ]
    setAccepted(nextAccepted)
    setMessages(nextMessages)
    showToast('已采纳到实施评估输入池')
    // ISS-2026-08-18-005（档 1）：persist 失败经状态位可见；
    // 尾部 .catch 仅防 unhandled rejection（persist 内部已捕获，正常不触发）
    persistAiEvaluationDraft({ accepted: nextAccepted, messages: nextMessages })
      .then(handlePersistResult)
      .catch(() => {})
  }, [accepted, handlePersistResult, messages, persistAiEvaluationDraft, showToast])

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
      const nextConfirmationQuestions = confirmationQuestions.includes(question)
        ? confirmationQuestions
        : [...confirmationQuestions, question]
      const nextMessages = [
        ...messages,
        createMessage({
          role: 'user',
          type: 'confirmation',
          content: question,
        }),
      ]
      setConfirmationQuestions(nextConfirmationQuestions)
      setMessages(nextMessages)
      showToast('已加入售前待确认问题')
      // ISS-2026-08-18-005（档 1）：persist 失败经状态位可见；
      // 尾部 .catch 仅防 unhandled rejection（persist 内部已捕获，正常不触发）
      persistAiEvaluationDraft({ confirmationQuestions: nextConfirmationQuestions, messages: nextMessages })
        .then(handlePersistResult)
        .catch(() => {})
      return
    }
    if (action === 'accept') {
      acceptItem()
    }
  }, [acceptItem, askOrRevise, confirmationQuestions, handlePersistResult, messages, persistAiEvaluationDraft, showToast])

  const analyze = useCallback(async () => {
    if (!selectedFile) {
      askOrRevise('请先附加原始需求文件')
      return
    }

    setLoading(true)
    setError(null)
    setErrorScope(null)
    let pendingUserMessage = null
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const userInstruction = composer.trim() || DEFAULT_PROMPT
      pendingUserMessage = createMessage({
        role: 'user',
        type: 'file_request',
        content: userInstruction,
        attachments: fileAttachmentSnapshot(selectedFile),
      })
      setAnalysisRequest(userInstruction)
      const parsed = await apiClient.upload('/ai/parse-basic-info', formData)
      const summary = summarizeParsedFile(selectedFile, parsed)
      const parseArtifactId = createId('artifact_parse')
      const parseMessage = createMessage({
        role: 'assistant',
        type: 'parse_summary',
        content: '模型识别完成',
        artifactId: parseArtifactId,
      })
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
      const previewData = unwrapData(preview)
      const previewArtifactId = createId('artifact_preview')
      const previewMessage = createMessage({
        role: 'assistant',
        type: 'assessment_preview',
        content: '实施评估结果',
        artifactId: previewArtifactId,
      })
      const nextMessages = [
        ...messages,
        pendingUserMessage,
        parseMessage,
        previewMessage,
      ]
      const nextArtifacts = {
        ...artifacts,
        [parseArtifactId]: summary,
        [previewArtifactId]: previewData,
      }
      setMessages(nextMessages)
      setArtifacts(nextArtifacts)
      setLastPreview(previewData)
      // ISS-2026-08-18-005（档 1）：analyze 成功路径的 persist 失败同样必须可见——
      // persist 改为返回标志后不再 throw，此处显式汇入状态位，避免从「可捕获」变「静默」。
      const persistResult = await persistAiEvaluationDraft({
        activeThreadId,
        artifacts: nextArtifacts,
        lastPreview: previewData,
        messages: nextMessages,
        parseSummary: summary,
        selectedFile,
        userInstruction,
      })
      handlePersistResult(persistResult)
      showToast('文件解析与评估预览已更新')
    } catch (err) {
      setError(err?.message || '分析失败')
      setErrorScope('analysis')
      const errorMessage = createMessage({
        role: 'assistant',
        type: 'error',
        content: err?.message || '分析失败',
      })
      const nextMessages = [
        ...messages,
        ...(pendingUserMessage ? [pendingUserMessage] : []),
        errorMessage,
      ]
      setMessages(nextMessages)
      // ISS-2026-08-18-005（档 1）：分析失败分支是最危险的一处——persist 失败时
      // 用户输入与错误提示会一起丢；失败必须置页面级状态位，提示用户草稿未落盘。
      // 尾部 .catch 仅防 unhandled rejection（persist 内部已捕获，正常不触发）
      persistAiEvaluationDraft({ messages: nextMessages })
        .then(handlePersistResult)
        .catch(() => {})
      showToast(err?.message || '分析失败，已保留当前草稿')
    } finally {
      setLoading(false)
    }
  }, [activeThreadId, artifacts, askOrRevise, composer, handlePersistResult, messages, persistAiEvaluationDraft, requirementId, selectedFile, showToast])

  const saveEvaluationDraft = useCallback(async () => {
    if (!requirementId) {
      showToast('缺少需求版本 ID，无法保存')
      return
    }

    setSaving(true)
    setError(null)
    setErrorScope(null)
    try {
      const persistResult = await persistAiEvaluationDraft()
      // ISS-2026-08-18-005（档 1）：persist 改为返回标志后不 throw，
      // 手动保存场景仍需失败可见——rethrow 走既有 catch → setError + errorScope('save')。
      if (persistResult && !persistResult.ok) throw persistResult.error
      showToast('已保存到需求版本草稿')
    } catch (err) {
      setError(err?.message || '保存失败')
      setErrorScope('save')
      showToast(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [persistAiEvaluationDraft, requirementId, showToast])

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
        activeThreadId,
        confirmationQuestions,
        feedbackRecords,
        lastPreview,
        messages,
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
  }, [accepted, activeThreadId, analysisRequest, composer, confirmationQuestions, feedbackRecords, lastPreview, messages, parseSummary, requirementId, savedSourceFile, selectedFile, showToast])

  const exportConversation = useCallback(() => {
    const assessmentSeed = buildAssessmentSeed({
      accepted,
      activeThreadId,
      confirmationQuestions,
      feedbackRecords,
      lastPreview,
      messages,
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
      messages,
      artifacts,
      activeThreadId,
      threads,
      assessmentSeed,
    }, `requirement-ai-evaluation-${requirementId || 'draft'}.json`)
    showToast('已导出对话式评估草稿')
  }, [accepted, activeThreadId, analysisRequest, artifacts, composer, confirmationQuestions, feedbackRecords, lastPreview, messages, parseSummary, requirementId, savedSourceFile, selectedFile, showToast, threads])

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
    draftPersistError,
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
    messages,
    artifacts,
    saveEvaluationDraft,
    savedSourceFile,
    saving,
    selectedFile,
    setComposer,
    toast,
    versionRecord,
  }
}
