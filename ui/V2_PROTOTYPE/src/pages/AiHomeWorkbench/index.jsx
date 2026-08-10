import { useEffect, useMemo, useRef, useState } from 'react'
import CompanyLookupDialog from '../../components/AiWorkbench/CompanyLookupDialog.jsx'
import SessionRail from '../../components/AiWorkbench/SessionRail.jsx'
import { useBackgroundRuns } from '../../hooks/useBackgroundRuns.jsx'
import useChatMessages from './hooks/useChatMessages.js'
import useHarnessRun from './hooks/useHarnessRun.js'
import useWorkbenchState from './hooks/useWorkbenchState.js'
import ChatArea from './components/ChatArea/index.jsx'
import WorkflowTemplates from './components/ChatArea/WorkflowTemplates.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import WorkspacePanel from './components/WorkspacePanel/index.jsx'

/**
 * AI 工作台入口：纯布局组装。状态与行为全部收敛在 hooks/ 与 components/。
 */
export default function AiHomeWorkbench({ currentUser }) {
  const chatRef = useRef(null)
  const workbench = useWorkbenchState(currentUser, {
    onActiveSessionDeleted: () => chatRef.current?.resetMessages(),
  })
  const chat = useChatMessages(workbench)
  chatRef.current = chat
  const harness = useHarnessRun(workbench, chat)
  chat.bindHarness(harness)

  // RP-047 Batch D（G4 明确停止）：活跃 Run 按 sessionId 映射到会话行；
  // cancel 唯一入口仅由用户显式点击停止并经二次确认后触发。
  const backgroundRuns = useBackgroundRuns()
  const sessionRuns = useMemo(() => {
    const map = {}
    backgroundRuns.runs.forEach((run) => { if (run.sessionId) map[run.sessionId] = run })
    return map
  }, [backgroundRuns.runs])
  const activeRun = workbench.activeSession ? sessionRuns[workbench.activeSession.sessionId] : null
  const [stopTargetRun, setStopTargetRun] = useState(null)
  const [stoppingRun, setStoppingRun] = useState(false)
  const [stopError, setStopError] = useState('')

  // ISS-2026-08-09-003 C3（离页返回旧缓存渲染、AI 回复不显示）：「后台任务」角标
  // 接入统一视图 runs 的活跃/已完成计数——O5 接口已一次取齐 runs，不再只看活跃数。
  const runCounts = useMemo(() => {
    const runs = workbench.unifiedView?.runs || []
    return {
      active: runs.filter((run) => ['queued', 'running', 'recovering', 'waiting'].includes(run.status)).length,
      completed: runs.filter((run) => run.status === 'completed').length,
    }
  }, [workbench.unifiedView?.runs])

  // ISS-2026-08-09-003 C3：离页期间完成的 run（由活跃转 completed，或从活跃列表消失）
  // 在统一视图刷新后触发 C2 对账重拉——后端 messages 为准补回迟到回复。
  const prevRunStatusesRef = useRef(new Map())
  useEffect(() => {
    const runs = workbench.unifiedView?.runs || []
    const previous = prevRunStatusesRef.current
    const next = new Map(runs.map((run) => [run.id, run.status]))
    const wasActive = (status) => ['queued', 'running', 'recovering', 'waiting'].includes(status)
    const completedInBackground = runs.some((run) => wasActive(previous.get(run.id)) && run.status === 'completed')
      || [...previous.entries()].some(([id, status]) => wasActive(status) && !next.has(id))
    prevRunStatusesRef.current = next
    if (completedInBackground) workbench.loadSessions?.().catch(() => {})
  }, [workbench.unifiedView?.runs])

  function requestStopRun(run) {
    if (!run) return
    setStopError('')
    setStopTargetRun(run)
  }

  function handleStopSession(session) {
    requestStopRun(sessionRuns[session?.sessionId])
  }

  async function handleConfirmStopRun() {
    if (!stopTargetRun || stoppingRun) return
    setStoppingRun(true)
    setStopError('')
    try {
      await backgroundRuns.cancelRun(stopTargetRun.runId)
      setStopTargetRun(null)
    } catch (err) {
      setStopError(err?.message || '停止失败，请重试')
    } finally {
      setStoppingRun(false)
    }
  }

  function handleStartNewSession() {
    chat.resetMessages()
    workbench.startNewSession()
  }

  function handleWorkbenchCompanySelect(candidate) {
    const displayName = candidate.displayName || candidate.customerName || candidate.name || candidate.title || '候选主体'
    workbench.resetWorkbenchCompanyLookup()
    chat.appendMessage({
      id: `company-selected-${Date.now()}`,
      role: 'assistant',
      text: `已选择客户主体：${displayName}`,
    })
  }

  return (
    <div className={`ai-home-workbench${workbench.workspacePanelCollapsed ? ' ai-home-workbench--inspector-collapsed' : ''}`} data-testid="ai-home-workbench" style={{ display: 'grid', gap: 16, height: '100%', minHeight: 0, overflow: 'hidden', padding: '12px 16px' }}>
      <h1 className="sr-only">AI 工作台</h1>
      <aside className="ai-home-rail" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {(runCounts.active > 0 || runCounts.completed > 0) && (
          <div
            className="ai-home-runs-badge"
            role="status"
            style={{ display: 'flex', alignItems: 'center', minHeight: 34, padding: '6px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-2)', fontSize: 12, color: 'var(--ink-2)' }}
          >
            {`后台任务 进行中 ${runCounts.active} · 已完成 ${runCounts.completed}`}
          </div>
        )}
        {activeRun && (
          <div className="ai-home-stop-bar" role="status">
            <span className="ai-home-stop-bar-text">后台任务执行中：{activeRun.title || activeRun.runId}</span>
            <button type="button" className="btn btn-out" style={{ height: 26, padding: '0 12px', fontSize: 12, flexShrink: 0 }} onClick={() => requestStopRun(activeRun)}>停止任务</button>
          </div>
        )}
        <SessionRail
          sessions={workbench.sessions}
          activeSessionId={workbench.activeSession?.sessionId}
          onSelect={workbench.selectSession}
          onNew={handleStartNewSession}
          onDelete={workbench.requestDeleteSession}
          onRename={workbench.renameSession}
          sessionRuns={sessionRuns}
          onStop={handleStopSession}
        />
        <WorkflowTemplates
          workflows={workbench.preset.workflows}
          activeWorkflowKey={workbench.activeWorkflowKey}
          onStartWorkflow={workbench.startWorkflow}
        />
      </aside>

      <ChatArea preset={workbench.preset} workbench={{ ...workbench, backgroundRuns }} chat={chat} harness={harness} />

      <WorkspacePanel
        collapsed={workbench.workspacePanelCollapsed}
        onToggle={workbench.toggleWorkspacePanel}
        session={workbench.activeSession}
        sending={chat.sending}
        onConfirmAction={harness.confirmPendingAction}
        confirmingActionId={harness.confirmingActionId}
        messageCount={chat.messages.length}
        outputState={workbench.outputState}
      />

      {workbench.deleteTargetSession && (
        <ConfirmDialog
          title="删除会话"
          message="确定要彻底删除这个 AI 会话吗？"
          detail={workbench.deleteTargetSession.title || '未命名会话'}
          error={workbench.deleteSessionError}
          confirmLabel="确认删除"
          confirming={workbench.deletingSessionId === workbench.deleteTargetSession.sessionId}
          onCancel={workbench.cancelDeleteSession}
          onConfirm={workbench.confirmDeleteSession}
        />
      )}
      {stopTargetRun && (
        <ConfirmDialog
          title="停止任务"
          message="确定要停止这个后台任务吗？"
          detail={stopTargetRun.title || stopTargetRun.runId}
          warning="停止后任务终止执行，已产出的内容不会丢失。"
          error={stopError}
          confirmLabel="确认停止"
          busyLabel="停止中…"
          confirming={stoppingRun}
          onCancel={() => { if (!stoppingRun) setStopTargetRun(null) }}
          onConfirm={handleConfirmStopRun}
        />
      )}
      <CompanyLookupDialog
        open={workbench.workbenchCompanyLookupOpen}
        loading={workbench.workbenchCompanyLookupLoading}
        candidates={workbench.workbenchCompanyCandidates}
        error={workbench.workbenchCompanyLookupError}
        onClose={workbench.resetWorkbenchCompanyLookup}
        onSelect={handleWorkbenchCompanySelect}
      />
    </div>
  )
}

