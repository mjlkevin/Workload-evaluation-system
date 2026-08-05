import { useRef } from 'react'
import CompanyLookupDialog from '../../components/AiWorkbench/CompanyLookupDialog.jsx'
import SessionRail from '../../components/AiWorkbench/SessionRail.jsx'
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
        <SessionRail
          sessions={workbench.sessions}
          activeSessionId={workbench.activeSession?.sessionId}
          onSelect={workbench.selectSession}
          onNew={handleStartNewSession}
          onDelete={workbench.requestDeleteSession}
          onRename={workbench.renameSession}
        />
        <WorkflowTemplates
          workflows={workbench.preset.workflows}
          activeWorkflowKey={workbench.activeWorkflowKey}
          onStartWorkflow={workbench.startWorkflow}
        />
      </aside>

      <ChatArea preset={workbench.preset} workbench={workbench} chat={chat} harness={harness} />

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

