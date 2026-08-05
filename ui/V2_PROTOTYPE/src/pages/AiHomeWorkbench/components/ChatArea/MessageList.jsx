import MessageBubble from './MessageBubble.jsx'
import { RoleBadge } from './MessageBits.jsx'

export default function MessageList({ messages, paneRef, activeWorkflow, centerTitle, centerHint, outputState, onChooseFile, bubbleProps }) {
  return (
    <div ref={paneRef} data-testid="ai-home-message-pane" style={{ flex: 1, minHeight: 0, padding: '24px 28px', overflowY: 'auto', background: '#fff' }}>
      {!messages.length && (
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
        {messages.map((message, index) => (
          <MessageBubble key={message.id || `${message.role}-${index}`} message={message} index={index} {...bubbleProps} />
        ))}
      </div>
    </div>
  )
}
