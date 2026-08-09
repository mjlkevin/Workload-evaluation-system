import AttachmentCard from './AttachmentCard.jsx'

export default function Composer({ composer, setComposer, sending, selectedFile, placeholder, fileInputRef, onChooseFile, onAttachFile, onRemoveFile, onSend, onStop, activeRun }) {
  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    onSend()
  }

  return (
    <div className="ai-composer">
      <div className="ai-composer__inner">
        {selectedFile && <AttachmentCard file={selectedFile} onRemove={onRemoveFile} />}
        {/* O8：Run 进行中显示停止按钮 */}
        {activeRun && sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12, color: 'var(--ink-3)' }}>
            <span className="ai-composer__sending">···</span>
            <span>AI 正在回复</span>
            <button
              type="button"
              className="btn btn-out"
              style={{ height: 24, padding: '0 10px', fontSize: 11, marginLeft: 'auto' }}
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              停止
            </button>
          </div>
        )}
        <div className="ai-composer__row">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{ display: 'none' }} onChange={(event) => onAttachFile(event.target.files?.[0] || null)} />
          <button className="ai-composer__attach" type="button" onClick={onChooseFile} aria-label={selectedFile ? '替换附件' : '附加文件'} title={selectedFile ? '替换附件' : '附加文件'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <textarea
            rows="3"
            aria-label="AI 工作台输入"
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={placeholder}
            className="ai-composer__textarea"
          />
          <button className="ai-composer__send" type="button" onClick={onSend} disabled={sending} aria-label="发送消息" title="发送消息">
            {sending && !activeRun ? (
              <span className="ai-composer__sending">···</span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
