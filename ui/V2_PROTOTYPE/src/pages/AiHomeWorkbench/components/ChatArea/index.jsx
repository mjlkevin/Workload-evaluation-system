import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HoverBadge } from './MessageBits.jsx'
import MessageList from './MessageList.jsx'
import Composer from './Composer.jsx'
import AiDegradationNotice from './AiDegradationNotice.jsx'
import RunToolTray from './RunToolTray.jsx'
import { apiClient } from '../../../../api/client.js'

const panel = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: '#fff',
  boxShadow: 'var(--shadow-1)',
}

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
export default function ChatArea({ preset, workbench, chat, harness }) {
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
    toolActionState: chat.toolActionState,
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

      {draftMemoryCount > 0 && (
        <div
          role="status"
          aria-label="待确认记忆提示"
          style={{
            margin: '0 20px',
            padding: '8px 12px',
            border: '1px solid color-mix(in oklab, var(--warn) 40%, var(--line))',
            borderRadius: 8,
            background: 'var(--warn-soft)',
            color: 'var(--ink-2)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>本次会话产生了 {draftMemoryCount} 条待确认记忆</span>
          <Link to="/system/memory?status=draft" style={{ marginLeft: 'auto', color: 'var(--brand)', fontWeight: 700 }}>
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
        onStop={() => activeRun && workbench.backgroundRuns?.cancelRun?.(activeRun.runId || activeRun.id)}
        activeRun={activeRun}
      />
    </section>
  )
}
