import InteractiveFormCard from '../../../../components/AiWorkbench/InteractiveFormCard.jsx'
import { pickArray } from '../../utils/harnessPayload.js'
import ModelRunTrace from '../StatusPanel/ModelRunTrace.jsx'
import ReportViewer from '../WorkspacePanel/ReportViewer.jsx'
import DraftLinker from '../WorkspacePanel/DraftLinker.jsx'
import AttachmentCard from './AttachmentCard.jsx'
import RichAiMessage from './RichAiMessage.jsx'
import LoadingState from './LoadingState.jsx'
import { CopyMessageButton, MessageTimestamp } from './MessageBits.jsx'

export default function MessageBubble({
  message,
  index,
  sending,
  confirmingActionId,
  onOptionSelect,
  onFormSubmit,
  onHarnessAction,
  onStructuredSupplement,
  onSuggestedAction,
  goLogin,
  copyDraft,
  onToggleThought,
}) {
  const isUser = message.role === 'user'
  const hasArtifacts = !isUser && !message.error && pickArray(message.artifacts).length > 0
  // RP-056：复制控件 + 时间戳移出气泡，置于气泡下方右侧（悬浮消息行显隐）
  const showMetaBar = !message.loading && !message.error && Boolean(message.text)
  return (
    <article className="ai-msg-row" style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && <div className="ai-avatar ai-avatar--bot" aria-hidden="true">AI</div>}
      <div className="ai-msg-col" style={{ width: hasArtifacts ? 'min(100%, 1080px)' : undefined, maxWidth: hasArtifacts ? 'calc(100% - 44px)' : '76%' }}>
      <div className={`ai-bubble-wrap${isUser ? ' ai-bubble--user' : message.error ? ' ai-bubble--error' : ' ai-bubble--ai'}`} style={{ padding: 14, borderRadius: 12, position: 'relative' }}>
        {/* ISS-2026-08-10-005：思考块移到回答正文上方（对标业内：思考在上、回答在下）；
            折叠态「已思考」（可点开），流式期间「思考中…」并实时展开。 */}
        {!isUser && !message.error && Array.isArray(message.thoughts) && message.thoughts.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {message.thoughts.map((thought, idx) => (
              <div key={`thought-${idx}`} style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => onToggleThought?.(message.id, idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <span>{thought.collapsed ? '▶' : '▼'}</span>
                  <span>{thought.collapsed ? '已思考' : (message.streaming ? '思考中…' : '思考过程')}</span>
                </button>
                {!thought.collapsed && (
                  <div style={{
                    marginTop: 4,
                    padding: '8px 10px',
                    background: 'var(--accent-soft)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--ink-2)',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {thought.text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {message.loading ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.7 }}>{message.text}</div>
            <div style={{ marginTop: 6 }}>
              <LoadingState />
            </div>
          </div>
        ) : (
          isUser || message.error
            ? <div style={{ fontSize: 13, lineHeight: 1.7 }}>{message.text}</div>
            : <RichAiMessage text={message.text} optionDisabled={sending} onOptionSelect={onOptionSelect} />
        )}
        {/* MS3 chip 活数据链路：knowledgeTool / toolCalls / memoryRef 任一存在即渲染 trace 区 */}
        {!isUser && !message.error && (message.knowledgeTool || message.toolCalls?.length || message.memoryRef) && (
          <ModelRunTrace
            knowledgeTool={message.knowledgeTool}
            toolCalls={message.toolCalls}
            memoryRef={message.memoryRef}
          />
        )}
        {!isUser && !message.error && message.formBlock && (
          <InteractiveFormCard
            formBlock={message.formBlock}
            disabled={sending}
            onSubmit={onFormSubmit}
          />
        )}
        {!isUser && !message.error && pickArray(message.artifacts).map((artifact) => (
          <ReportViewer
            key={artifact.harnessArtifactId || artifact.artifactId || artifact.title}
            artifact={artifact}
            onAction={onHarnessAction}
            onSubmitSupplement={onStructuredSupplement}
            confirmingActionId={confirmingActionId}
          />
        ))}
        {!isUser && !message.error && pickArray(message.suggestedActions).length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {message.suggestedActions.map((action) => {
              const actionKey = action.id || action.actionId || action.actionType
              const isConfirmingSuggestedAction = confirmingActionId === actionKey
              return (
                <button
                  key={actionKey}
                  className="btn btn-out"
                  type="button"
                  disabled={action.disabled || isConfirmingSuggestedAction}
                  onClick={() => onSuggestedAction?.(action, actionKey)}
                  style={{ height: 30 }}
                >
                  {isConfirmingSuggestedAction ? '执行中…' : action.label}
                </button>
              )
            })}
          </div>
        )}
        {!isUser && !message.error && message.actions && (
          <DraftLinker actions={message.actions} />
        )}
        {message.file && <div style={{ marginTop: 10 }}><AttachmentCard file={message.file} state="sent" compact inverted={isUser} /></div>}
        {message.action === 'login_required' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn btn-pri" type="button" onClick={goLogin} style={{ height: 30 }}>重新登录</button>
            <button className="btn btn-out" type="button" onClick={copyDraft} style={{ height: 30 }}>复制草稿</button>
          </div>
        )}
      </div>
      {showMetaBar && (
        <div className="ai-msg-meta">
          <CopyMessageButton text={message.text} />
          <MessageTimestamp createdAt={message.createdAt} />
        </div>
      )}
      </div>
      {isUser && <div className="ai-avatar ai-avatar--user" aria-hidden="true">我</div>}
    </article>
  )
}
