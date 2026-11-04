import { useLayoutEffect, useRef } from 'react'
import BusinessExecutionMessage from '../BusinessExecutionMessage.jsx'
import { BusinessRunActions } from '../BusinessExecutionControls.jsx'
import MessageBubble from './MessageBubble.jsx'
import SessionBusinessRecords from './SessionBusinessRecords.jsx'
import { normalizeProjectionSource } from '../../utils/messageFormatter.js'
import { RoleBadge } from './MessageBits.jsx'

export default function MessageList({ messages, paneRef, activeWorkflow, centerTitle, centerHint, outputState, onChooseFile, bubbleProps, sessionId, sending, business, session, onConfirmSessionAction, confirmingSessionActionId }) {
  const localRef = useRef(null)
  const scrollRef = paneRef ?? localRef
  const following = useRef(true)
  const summaryActivation = useRef(null)
  const previousSession = useRef(sessionId)
  useLayoutEffect(() => {
    const pane = scrollRef.current
    if (previousSession.current !== sessionId) following.current = true
    previousSession.current = sessionId
    if (pane && following.current) pane.scrollTop = pane.scrollHeight
  }, [messages, sending, sessionId, scrollRef])
  const seenRoots = new Set()
  return (
    <div ref={scrollRef} onScroll={event => {
      const pane = event.currentTarget
      following.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 80
    }} onClickCapture={event => {
      // Native summary activation emits click for both pointer and keyboard input.
      const summary = event.target instanceof Element ? event.target.closest('summary') : null
      if (summary?.parentElement instanceof HTMLDetailsElement) summaryActivation.current = summary.parentElement
    }} onToggleCapture={event => {
      if (!(event.target instanceof HTMLDetailsElement) || summaryActivation.current !== event.target) return
      summaryActivation.current = null
      const pane = event.currentTarget
      // Opening lazy details grows after this event; pause before children mount.
      following.current = !event.target.open && pane.scrollHeight - pane.clientHeight - pane.scrollTop < 80
    }} data-testid="ai-home-message-pane" style={{ flex: 1, minHeight: 0, padding: '24px 28px', overflowY: 'auto', background: 'var(--surface)' }}>
      {business?.error && <p role="alert" className="mb-3 rounded-md bg-err-soft p-3 text-sm text-err-ink">{business.error}</p>}
      {business?.loading && <p role="status" className="mb-3 text-xs text-ink-2">正在更新业务记录…</p>}
      {!messages.length && !business?.runs?.length && !business?.error && (
        <div className="ai-empty-state">
          <div className="ai-empty-state__icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="13" x2="13" y2="13" />
            </svg>
          </div>
          {activeWorkflow && <RoleBadge>当前工作流：{activeWorkflow.title}</RoleBadge>}
          <h2 className="ai-empty-state__title">{centerTitle}</h2>
          <p className="ai-empty-state__desc">{centerHint}</p>
          {activeWorkflow && (
            <div className="ai-empty-state__tags">
              {outputState.outputs.map((item) => <span key={item} className="tag brd">{item}</span>)}
            </div>
          )}
          <div className="ai-empty-state__actions">
            <button className="btn btn-pri" type="button" onClick={onChooseFile}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              选择文件开始
            </button>
            <span className="ai-empty-state__hint">或直接输入问题</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {messages.map((message, index) => {
          if (message.type !== 'business') {
            const source = message.role === 'user' && normalizeProjectionSource(message.projectionSource)
            const invocation = source && business?.runs?.find(run => run.sessionId === sessionId && run.runId === source.runId)?.businessExecution
            return <MessageBubble key={message.id || `${message.role}-${index}`} message={message} index={index} {...bubbleProps} invocation={invocation} />
          }
          const run = business?.runs?.find(item => item.runId === message.currentRunId)
          const first = !seenRoots.has(message.rootRunId)
          seenRoots.add(message.rootRunId)
          return (
            <div key={message.id} className="grid min-w-0 gap-3">
              {first && run && <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <h2 className="m-0 text-sm font-semibold">{run.businessExecution.target.name}</h2>
                <BusinessRunActions run={run} busy={business.busy} onRetry={business.retry} onStop={business.stop} />
                <details className="w-full text-xs text-ink-2">
                  <summary>执行信息</summary>
                  {run.businessExecution.target.versionId && <p>版本：{run.businessExecution.target.versionId}</p>}
                  <p>执行根：{message.rootRunId}</p>
                  <p>当前执行：{run.runId}</p>
                  {run.createdAt && <p>开始时间：{run.createdAt}</p>}
                </details>
              </header>}
              <BusinessExecutionMessage entry={message} run={run} busy={business?.busy} onInput={business?.submitInput} onDecision={business?.decide} />
            </div>
          )
        })}
        <SessionBusinessRecords session={session} messages={messages} bubbleProps={bubbleProps} onConfirmAction={onConfirmSessionAction} confirmingActionId={confirmingSessionActionId} />
      </div>
    </div>
  )
}
