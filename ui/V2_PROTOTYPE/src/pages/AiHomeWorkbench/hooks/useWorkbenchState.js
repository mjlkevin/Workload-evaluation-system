import { useEffect, useMemo, useState } from 'react'
import { summarizeCompanyProfile } from '../../../api/ai.js'
import { useAiSessions } from '../../../hooks/useAiSessions.js'
import { getAiHomePreset } from '../../aiHomePresets.js'
import { pickArray, stripPendingMarker } from '../utils/harnessPayload.js'
import { getWorkflowOutputs } from '../utils/workflowOutputs.js'

const WORKSPACE_PANEL_COLLAPSED_KEY = 'wes-ai-workspace-panel-collapsed'

function readWorkspacePanelCollapsed() {
  try {
    return localStorage.getItem(WORKSPACE_PANEL_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * 收敛 AI 工作台分散的 useState：预设/工作流、会话列表、输入草稿、
 * 附件选择、工作区折叠、会话删除确认、客户主体检索。
 * callbacks.onActiveSessionDeleted 用于删除当前会话后清空消息区。
 */
export default function useWorkbenchState(currentUser, callbacks = {}) {
  const preset = useMemo(() => getAiHomePreset(currentUser?.businessRole), [currentUser?.businessRole])
  const workflowsByKey = useMemo(() => new Map(preset.workflows.map((workflow) => [workflow.key, workflow])), [preset.workflows])
  const sessionsApi = useAiSessions()
  const { activeSession, loadSessions, setActiveSession } = sessionsApi
  const [composer, setComposer] = useState('')
  const [draftBeforeLogin, setDraftBeforeLogin] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [activeWorkflowKey, setActiveWorkflowKey] = useState('')
  const [deleteTargetSession, setDeleteTargetSession] = useState(null)
  const [deletingSessionId, setDeletingSessionId] = useState('')
  const [deleteSessionError, setDeleteSessionError] = useState('')
  const [workspacePanelCollapsed, setWorkspacePanelCollapsed] = useState(readWorkspacePanelCollapsed)
  const [workbenchCompanyLookupOpen, setWorkbenchCompanyLookupOpen] = useState(false)
  const [workbenchCompanyLookupLoading, setWorkbenchCompanyLookupLoading] = useState(false)
  const [workbenchCompanyCandidates, setWorkbenchCompanyCandidates] = useState([])
  const [workbenchCompanyLookupError, setWorkbenchCompanyLookupError] = useState('')

  const activeWorkflow = workflowsByKey.get(activeWorkflowKey)
  const centerTitle = activeWorkflow?.title || preset.headline
  const centerHint = activeWorkflow?.desc || preset.emptyHint
  const outputState = getWorkflowOutputs(activeWorkflow)

  useEffect(() => {
    loadSessions().catch(() => {})
  }, [loadSessions])

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_PANEL_COLLAPSED_KEY, workspacePanelCollapsed ? 'true' : 'false')
    } catch {
      // localStorage may be unavailable in private or embedded contexts.
    }
  }, [workspacePanelCollapsed])

  useEffect(() => {
    if (activeSession?.workflowKey && !activeWorkflowKey) {
      setActiveWorkflowKey(activeSession.workflowKey === 'free_chat' ? '' : activeSession.workflowKey)
    }
  }, [activeSession?.workflowKey, activeWorkflowKey])

  function startWorkflow(workflow) {
    setActiveWorkflowKey(workflow.key)
    setComposer(`${workflow.title}：${workflow.desc}`)
  }

  function startNewSession() {
    setActiveSession(null)
    setActiveWorkflowKey('')
  }

  function selectSession(session) {
    setActiveSession(session)
    setActiveWorkflowKey(session?.workflowKey && session.workflowKey !== 'free_chat' ? session.workflowKey : '')
  }

  function requestDeleteSession(session) {
    if (!session?.sessionId) return
    setDeleteSessionError('')
    setDeleteTargetSession(session)
  }

  function cancelDeleteSession() {
    if (deletingSessionId) return
    setDeleteSessionError('')
    setDeleteTargetSession(null)
  }

  async function confirmDeleteSession() {
    const session = deleteTargetSession
    if (!session?.sessionId || deletingSessionId) return
    setDeleteSessionError('')
    setDeletingSessionId(session.sessionId)
    try {
      await sessionsApi.deleteSession(session.sessionId)
      if (activeSession?.sessionId === session.sessionId) {
        setActiveWorkflowKey('')
        callbacks.onActiveSessionDeleted?.()
      }
      setDeleteTargetSession(null)
    } catch (err) {
      setDeleteSessionError(`删除失败：${err.message || '请求失败'}`)
    } finally {
      setDeletingSessionId('')
    }
  }

  async function openWorkbenchCompanyLookup(prefillName) {
    setWorkbenchCompanyLookupOpen(true)
    setWorkbenchCompanyLookupLoading(true)
    setWorkbenchCompanyCandidates([])
    setWorkbenchCompanyLookupError('')
    // RP-008: 优先使用 suggestedAction 传入的客户名，其次从 session linkedRecords 推断
    const linkedCustomer = activeSession?.linkedRecords?.customerName || ''
    const customerName = stripPendingMarker(prefillName || linkedCustomer) || '客户'
    try {
      const profile = await summarizeCompanyProfile({ customerName })
      const candidates = pickArray(profile?.disambiguationCandidates)
      if (profile?.mode === 'disambiguation' && candidates.length) {
        setWorkbenchCompanyCandidates(candidates)
      } else if (profile?.customerName) {
        setWorkbenchCompanyCandidates([{
          displayName: profile.customerName,
          industry: profile.customerIndustry || '',
          location: profile.location || '',
          summary: profile.enterpriseProfile || '',
        }])
      }
    } catch (err) {
      setWorkbenchCompanyLookupError(`客户主体检索失败：${err.message || '请求失败'}`)
    } finally {
      setWorkbenchCompanyLookupLoading(false)
    }
  }

  function resetWorkbenchCompanyLookup() {
    setWorkbenchCompanyLookupOpen(false)
    setWorkbenchCompanyCandidates([])
    setWorkbenchCompanyLookupError('')
  }

  return {
    preset,
    activeWorkflow,
    activeWorkflowKey,
    centerTitle,
    centerHint,
    outputState,
    ...sessionsApi,
    composer,
    setComposer,
    draftBeforeLogin,
    setDraftBeforeLogin,
    selectedFile,
    setSelectedFile,
    workspacePanelCollapsed,
    toggleWorkspacePanel: () => setWorkspacePanelCollapsed((value) => !value),
    startWorkflow,
    startNewSession,
    selectSession,
    deleteTargetSession,
    deletingSessionId,
    deleteSessionError,
    requestDeleteSession,
    cancelDeleteSession,
    confirmDeleteSession,
    workbenchCompanyLookupOpen,
    workbenchCompanyLookupLoading,
    workbenchCompanyCandidates,
    workbenchCompanyLookupError,
    openWorkbenchCompanyLookup,
    resetWorkbenchCompanyLookup,
  }
}
