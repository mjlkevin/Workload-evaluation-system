import { HoverBadge } from './MessageBits.jsx'
import MessageList from './MessageList.jsx'
import Composer from './Composer.jsx'

const panel = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: '#fff',
  boxShadow: 'var(--shadow-1)',
}

/**
 * 中间对话区：头部徽标栏 + 消息列表 + 输入区。
 * workbench/chat/harness 为页面级 hook 返回值，本页私有组件直接消费。
 */
export default function ChatArea({ preset, workbench, chat, harness }) {
  const bubbleProps = {
    sending: chat.sending,
    confirmingActionId: harness.confirmingActionId,
    onOptionSelect: chat.handleInteractiveOptionSelect,
    onFormSubmit: chat.handleInteractiveFormSubmit,
    onHarnessAction: harness.handleHarnessAction,
    onStructuredSupplement: harness.handleStructuredSupplement,
    onSuggestedAction: chat.handleSuggestedAction,
    goLogin: chat.goLogin,
    copyDraft: chat.copyDraft,
    onToggleThought: chat.toggleThought,
  }

  // O8：当前活跃 Run（用于停止按钮）
  const activeRun = workbench.unifiedView?.runs?.find(
    (run) => run.sessionId === workbench.activeSession?.sessionId && ['running', 'queued', 'recovering'].includes(run.status),
  ) || null

  return (
    <section style={{ ...panel, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ minHeight: 48, padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <HoverBadge label="AI 工作台" tooltip={preset.systemPrompt} />
        <HoverBadge label={preset.label} tooltip={<><b style={{ display: 'block', marginBottom: 4 }}>{preset.headline}</b>{preset.emptyHint}</>} />
        {workbench.loadingSessions && <span className="tag" style={{ marginLeft: 'auto' }}>加载会话</span>}
        {workbench.sessionsError && (
          <div role="alert" style={{ marginLeft: 'auto', color: 'var(--err)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{workbench.sessionsError}</span>
            <button type="button" className="btn btn-out" style={{ height: 28 }} onClick={workbench.clearSessionsError}>关闭</button>
          </div>
        )}
      </div>

      <MessageList
        messages={chat.messages}
        paneRef={chat.messagePaneRef}
        activeWorkflow={workbench.activeWorkflow}
        centerTitle={workbench.centerTitle}
        centerHint={workbench.centerHint}
        outputState={workbench.outputState}
        onChooseFile={chat.chooseFile}
        bubbleProps={bubbleProps}
      />

      <Composer
        composer={workbench.composer}
        setComposer={workbench.setComposer}
        sending={chat.sending}
        selectedFile={workbench.selectedFile}
        placeholder={preset.placeholder}
        fileInputRef={chat.fileInputRef}
        onChooseFile={chat.chooseFile}
        onAttachFile={chat.attachFile}
        onRemoveFile={chat.removeSelectedFile}
        onSend={chat.sendMessage}
        onStop={() => activeRun && workbench.backgroundRuns?.cancelRun?.(activeRun.id)}
        activeRun={activeRun}
      />
    </section>
  )
}
