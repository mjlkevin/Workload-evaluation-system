import InteractiveFormCard from '../../../../components/AiWorkbench/InteractiveFormCard.jsx'
import { pickArray } from '../../utils/harnessPayload.js'
import ThinkingTrace from './ThinkingTrace.jsx'
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
  onRetryParse,
}) {
  const isUser = message.role === 'user'
  const hasArtifacts = !isUser && !message.error && pickArray(message.artifacts).length > 0
  // RP-056：复制控件 + 时间戳移出气泡，置于文本下方，跟随角色对齐方向（悬浮消息行显隐）
  const showMetaBar = !message.loading && !message.error && Boolean(message.text)
  const metaAlign = isUser ? 'justify-end' : 'justify-start'
  return (
    <article className="ai-msg-row" style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div className="ai-msg-col" style={{ width: hasArtifacts ? 'min(100%, 1080px)' : undefined, maxWidth: hasArtifacts ? '100%' : (isUser ? '70%' : '76%') }}>
      <div
        className={`ai-bubble-wrap ${isUser ? 'text-right font-medium' : 'text-left font-normal'}${message.error ? ' border-l-2 border-err pl-2.5' : ''}`}
        style={{ position: 'relative' }}
      >
        {/* ISS-2026-08-10-005：思考轨迹移到回答正文上方（对标业内：思考在上、回答在下）；
            2026-08-17 起合并进统一的 ThinkingTrace（原 thoughts 内联块 + ModelRunTrace）。 */}
        {!isUser && !message.error && (
          <ThinkingTrace
            messageId={message.id}
            thoughts={message.thoughts}
            streaming={message.streaming}
            onToggleThought={onToggleThought}
            knowledgeTool={message.knowledgeTool}
            toolCalls={message.toolCalls}
            memoryRef={message.memoryRef}
          />
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
          <div className="mt-2.5 flex flex-wrap gap-2">
            {message.suggestedActions.map((action) => {
              const actionKey = action.id || action.actionId || action.actionType
              const isConfirmingSuggestedAction = confirmingActionId === actionKey
              return (
                <button
                  key={actionKey}
                  className={action.primary ? 'btn btn-pri' : 'btn btn-out'}
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
        {message.file && <div style={{ marginTop: 10 }}><AttachmentCard file={message.file} state="sent" compact /></div>}
        {message.action === 'login_required' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn btn-pri" type="button" onClick={goLogin} style={{ height: 30 }}>重新登录</button>
            <button className="btn btn-out" type="button" onClick={copyDraft} style={{ height: 30 }}>复制草稿</button>
          </div>
        )}
        {/* DEF-2026-08-27-003：解析超时/失败后的恢复入口——复用本轮已暂存的 File，不需重新选文件 */}
        {message.action === 'retry_parse' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              className="btn btn-out"
              type="button"
              disabled={sending}
              onClick={() => onRetryParse?.(message.retryId)}
              style={{ height: 30 }}
            >
              重试
            </button>
          </div>
        )}
      </div>
      {showMetaBar && (
        <div className={`ai-msg-meta flex ${metaAlign}`}>
          <CopyMessageButton text={message.text} />
          <MessageTimestamp createdAt={message.createdAt} />
        </div>
      )}
      </div>
    </article>
  )
}
