import SandboxArtifacts from './SandboxArtifacts.jsx'
import InteractiveFormCard from '../../../../components/AiWorkbench/InteractiveFormCard.jsx'
import { pickArray } from '../../utils/harnessPayload.js'
import ThinkingTrace from './ThinkingTrace.jsx'
import ReportViewer from '../WorkspacePanel/ReportViewer.jsx'
import DraftLinker from '../WorkspacePanel/DraftLinker.jsx'
import AttachmentCard from './AttachmentCard.jsx'
import RichAiMessage from './RichAiMessage.jsx'
import LoadingState from './LoadingState.jsx'
import AskUserForm from './AskUserForm.jsx'
import { CopyMessageButton, MessageModelName, MessageTimestamp } from './MessageBits.jsx'

export default function MessageBubble({
  message,
  index,
  invocation,
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
  onApproveToolCall,
  onRejectToolCall,
  toolActionState,
  // 批次 9：ask_user 控件的提交入口（走 inputs 端点恢复 Run，不是发消息）
  onAskUserSubmit,
}) {
  const isUser = message.role === 'user'
  const hasArtifacts = !isUser && !message.error && pickArray(message.artifacts).length > 0
  // RP-056：复制控件 + 时间戳移出气泡，置于文本下方，跟随角色对齐方向（悬浮消息行显隐）
  const showMetaBar = !message.loading && !message.error && Boolean(message.text)
  const metaAlign = isUser ? 'justify-end' : 'justify-start'
  return (
    <article aria-label={isUser ? '你发送的消息' : 'AI 回复'} className={`ai-msg-row flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`ai-msg-col ${hasArtifacts ? 'w-full max-w-full' : isUser ? 'max-w-[92%] sm:max-w-[78%]' : 'w-full max-w-full sm:max-w-[92%]'}`}>
      <div className={`mb-1 flex items-center gap-2 text-xs font-medium text-ink-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
        <span aria-hidden="true" className={`flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-xs ${isUser ? 'bg-brand-soft text-brand-ink' : 'bg-ink text-surface'}`}>{isUser ? '●' : '✦'}</span>
        <span>{isUser ? '你' : 'AI'}</span>
      </div>
      <div
        className={`ai-bubble-wrap relative min-w-0 break-words rounded-lg border px-4 py-3 text-left font-normal ${isUser ? 'whitespace-pre-wrap border-brand/10 bg-brand-soft text-ink' : 'border-line bg-surface text-ink'}${message.error ? ' border-l-2 border-l-err' : ''}`}
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
            onApproveToolCall={onApproveToolCall}
            onRejectToolCall={onRejectToolCall}
            toolActionState={toolActionState}
          />
        )}
        {isUser && invocation && <span aria-label={`${message.skillContext ? '已选择' : '已调用'} ${invocation.kind === 'skill' ? 'Skill' : '流程'} ${invocation.target.name}`} className="mb-2 inline-flex max-w-full items-center gap-2 rounded-md border border-line bg-brand-soft px-2 py-1 text-xs text-brand-ink">
          <span>{invocation.kind === 'skill' ? 'Skill' : '流程'}</span><span className="min-w-0 break-words">{invocation.target.name}</span>
        </span>}
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
        {/* 批次 9：工具调用产生的交互表单（口径来自工具痕迹，答完即消失）。
            与上面那段【遗留】文本抽取控件互不影响：那条路没有 actionId，也就无从恢复 Run。 */}
        {!isUser && !message.error && (
          <AskUserForm
            calls={message.toolCalls}
            actionState={toolActionState}
            disabled={sending}
            onSubmit={onAskUserSubmit}
          />
        )}
        {!isUser && !message.error && <SandboxArtifacts artifacts={(message.toolCalls || []).flatMap(call => call.artifacts || [])} />}
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
          {!isUser && <MessageModelName model={message.model} />}
          <MessageTimestamp createdAt={message.createdAt} />
        </div>
      )}
      </div>
    </article>
  )
}
