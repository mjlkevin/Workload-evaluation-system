import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import MessageList from './MessageList.jsx'
import Composer from './Composer.jsx'
import AiDegradationNotice from './AiDegradationNotice.jsx'
import RunToolTray from './RunToolTray.jsx'
import { apiClient } from '../../../../api/client.js'

/**
 * SP-2026-007 MS2-PATCH：拉取当前用户 draft 态记忆条数。
 * 工作台会话蒸馏产物默认落 projectId=default（见 harness-boot 蒸馏钩子映射）。
 * 失败静默降级为不提示，不阻塞对话主链路。
 */
async function fetchDraftMemoryCount() {
  const res = await apiClient.get('/memory', { projectId: 'default', status: 'draft', page: 1, pageSize: 50 })
  const data = res?.data || {}
  const atoms = Number.isFinite(data.totalAtoms) ? data.totalAtoms : (data.atoms || []).length
  const scenes = Number.isFinite(data.totalScenes) ? data.totalScenes : (data.scenes || []).length
  return atoms + scenes
}

/**
 * 中间对话区：头部徽标栏 + 消息列表 + 输入区。
 * workbench/chat/harness 为页面级 hook 返回值，本页私有组件直接消费。
 */
export default function ChatArea({ preset, workbench, chat, harness, conversation, business, invocation }) {
  // MS2-PATCH：run 终态（sending true→false）后若存在 draft 记忆，出提示条
  const [draftMemoryCount, setDraftMemoryCount] = useState(0)
  const sending = chat.sending
  useEffect(() => {
    if (sending) return
    let cancelled = false
    fetchDraftMemoryCount()
      .then((count) => {
        if (!cancelled) setDraftMemoryCount(count)
      })
      .catch(() => {}) // ISS-2026-08-18-005（档 3）：draft 记忆计数为提示条徽标，失败时保持 0 渲染，属非关键 UI，可静默
    return () => {
      cancelled = true
    }
  }, [sending])

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
    // DEF-2026-08-27-003：解析失败气泡的重试入口
    onRetryParse: chat.retryAttachmentParse,
    // 批次 1b：写工具的同意 / 拒绝（就地长在 chip 上，不弹窗）
    onApproveToolCall: chat.approveToolCall,
    onRejectToolCall: chat.rejectToolCall,
    // 批次 9：ask_user 控件的提交（走 inputs 端点恢复 Run，不走发消息）
    onAskUserSubmit: chat.submitInteractiveForm,
    toolActionState: chat.toolActionState,
  }

  // O8：当前活跃 Run（用于停止按钮）
  const activeRun = workbench.unifiedView?.runs?.find(
    (run) => run.sessionId === workbench.activeSession?.sessionId && ['running', 'queued', 'recovering'].includes(run.status),
  ) || null

  return (
    <section aria-label="AI 对话工作区" className="ai-chat-area flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface max-[1180px]:h-[calc(100dvh-64px)] max-[1180px]:min-h-[560px]">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-base text-brand">✦</span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-sm font-semibold text-ink">{workbench.activeSession?.title || '新会话'}</h2>
          <p className="m-0 mt-0.5 text-[11px] text-ink-2">AI 工作台</p>
        </div>
        <span className="shrink-0 rounded-sm bg-bg-2 px-2 py-1 text-[11px] font-medium text-ink-2">{preset.label}</span>
        {workbench.loadingSessions && <span role="status" className="text-xs text-ink-2">加载会话</span>}
        {workbench.sessionsError && (
          <div role="alert" className="flex w-full items-center gap-2 text-xs text-err-ink">
            <span>{workbench.sessionsError}</span>
            <button type="button" className="btn btn-out" style={{ height: 28 }} onClick={workbench.clearSessionsError}>关闭</button>
          </div>
        )}
      </header>

      <MessageList
        messages={conversation ?? chat.messages}
        sessionId={workbench.activeSession?.sessionId}
        session={workbench.activeSession}
        onConfirmSessionAction={harness.confirmPendingAction}
        confirmingSessionActionId={harness.confirmingActionId}
        business={business}
        sending={chat.sending}
        paneRef={chat.messagePaneRef}
        activeWorkflow={workbench.activeWorkflow}
        centerTitle={workbench.centerTitle}
        centerHint={workbench.centerHint}
        outputState={workbench.outputState}
        onChooseFile={chat.chooseFile}
        bubbleProps={bubbleProps}
      />

      {draftMemoryCount > 0 && (
        <div
          role="status"
          aria-label="待确认记忆提示"
          className="mx-4 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-1 pt-2 text-[11px] text-ink-2 sm:mx-6"
        >
          <span>{draftMemoryCount} 条待确认记忆</span>
          <Link to="/system/memory?status=draft" className="ml-auto rounded-sm text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">
            去确认 →
          </Link>
        </div>
      )}

      {/* 批次 0.5 · Part2：应答通道改走备用时必须可见（贴发送区，用户正要按发送键） */}
      <AiDegradationNotice notice={chat.degradationNotice} />

      {/* 批次 1b：本轮 Run 的工具痕迹（刷新后仍在）+ 写操作的同意 / 拒绝入口 */}
      <RunToolTray
        calls={chat.toolTrail}
        toolActionState={chat.toolActionState}
        onApprove={chat.approveToolCall}
        onReject={chat.rejectToolCall}
        onAskUserSubmit={chat.submitInteractiveForm}
      />

      <Composer
        selectedTask={invocation?.selectedTask}
        onSelectTask={invocation?.selectTask}
        onRemoveTask={invocation?.removeTask}
        taskScope={workbench.activeSession?.sessionId || ''}
        businessError={invocation?.error}
        composer={workbench.composer}
        setComposer={workbench.setComposer}
        sending={chat.sending || invocation?.busy}
        selectedFile={workbench.selectedFile}
        placeholder={preset.placeholder}
        fileInputRef={chat.fileInputRef}
        onChooseFile={chat.chooseFile}
        onAttachFile={invocation?.selectedTask ? workbench.setSelectedFile : chat.attachFile}
        onRemoveFile={chat.removeSelectedFile}
        onSend={invocation?.selectedTask ? invocation.send : chat.sendMessage}
        onStop={() => activeRun && workbench.backgroundRuns?.cancelRun?.(activeRun.runId || activeRun.id)}
        activeRun={activeRun}
      />
    </section>
  )
}
