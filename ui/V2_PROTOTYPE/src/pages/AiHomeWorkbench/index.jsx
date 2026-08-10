import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CompanyLookupDialog from '../../components/AiWorkbench/CompanyLookupDialog.jsx'
import SessionRail from '../../components/AiWorkbench/SessionRail.jsx'
import { useBackgroundRuns } from '../../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../../hooks/useSessionRuntimeStore.js'
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
  // ISS-2026-08-10-001（ISS-003 复验残留）：「重挂载对账」一次性窗口——
  // 本挂载周期内完成首次评估即关闭，不依赖卸载前 ref（重挂载后 ref 已清空）。
  const remountReconcileCheckedRef = useRef(false)
  useEffect(() => {
    const runs = workbench.unifiedView?.runs || []
    const previous = prevRunStatusesRef.current
    // ISS-2026-08-10-001：run 键兼容统一视图的 runId（后端真实字段）与 id（既有 mock），
    // 原 run.id 单键在真实数据下全为 undefined，会把跨 run 状态误判为同一 run 迁移。
    const runKey = (run) => run.runId || run.id
    const next = new Map(runs.map((run) => [runKey(run), run.status]))
    const wasActive = (status) => ['queued', 'running', 'recovering', 'waiting'].includes(status)
    const completedInBackground = runs.some((run) => wasActive(previous.get(runKey(run))) && run.status === 'completed')
      || [...previous.entries()].some(([id, status]) => wasActive(status) && !next.has(id))
    prevRunStatusesRef.current = next
    if (completedInBackground) workbench.loadSessions?.().catch(() => {})
    // ISS-2026-08-10-001：重挂载后统一视图已含近期已完成 run（后端增补数据源），
    // 本地存在该会话未完成进行中占位（卸载快照）时触发一次 loadSessions 对账。
    const activeSessionId = workbench.activeSession?.sessionId || ''
    if (!remountReconcileCheckedRef.current && runs.length && activeSessionId) {
      remountReconcileCheckedRef.current = true
      const storedMessages = sessionRuntimeStore.getSessionMessages(activeSessionId) || []
      const hasUnfinishedLocal = storedMessages.some((message) => message.loading || message.streaming)
      if (hasUnfinishedLocal && runs.some((run) => run.status === 'completed')) {
        workbench.loadSessions?.().catch(() => {})
      }
    }
  }, [workbench.unifiedView?.runs, workbench.activeSession?.sessionId])

  // ISS-2026-08-10-002（右下角全局「后台任务」角标不计数）：Shell 层 provider 缺
  // 「新 run 创建」刷新触发——提交成功后经 context 节流入口 notifyRunsChanged 通知一次，
  // provider 刷新活跃列表并为新 run 建立 SSE，角标计数 / 终态通知 / SessionRail 徽标
  // 链路随之恢复；只触发列表刷新，零 cancel 硬口径不变。
  const sendMessageWithRunsNotify = useCallback(async (...args) => {
    const result = await chat.sendMessage(...args)
    backgroundRuns.notifyRunsChanged?.()
    return result
  }, [chat, backgroundRuns])

  // ISS-2026-08-10-002：统一视图发现新 runId（挂载首拉 / 页签返回重拉 / 对账重拉）时
  // 同步通知 provider——顶栏与右下角两个独立数据源对账，避免顶栏有计数、右下角恒 0。
  const knownUnifiedRunIdsRef = useRef(new Set())
  useEffect(() => {
    const runs = workbench.unifiedView?.runs || []
    const next = new Set(runs.map((run) => run.runId || run.id).filter(Boolean))
    let discoveredNew = false
    next.forEach((runId) => { if (!knownUnifiedRunIdsRef.current.has(runId)) discoveredNew = true })
    knownUnifiedRunIdsRef.current = next
    if (discoveredNew) backgroundRuns.notifyRunsChanged?.()
  }, [workbench.unifiedView?.runs, backgroundRuns])

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

      <ChatArea preset={workbench.preset} workbench={{ ...workbench, backgroundRuns }} chat={{ ...chat, sendMessage: sendMessageWithRunsNotify }} harness={harness} />

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

