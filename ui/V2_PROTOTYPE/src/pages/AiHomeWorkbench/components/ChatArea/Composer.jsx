import { useEffect, useId, useRef, useState } from 'react'
import ComposerTaskPicker from './ComposerTaskPicker.jsx'
import AttachmentCard from './AttachmentCard.jsx'

export default function Composer({ composer, setComposer, sending, selectedFile, placeholder, fileInputRef, onChooseFile, onAttachFile, onRemoveFile, onSend, onStop, activeRun, selectedTask, onSelectTask, onRemoveTask, taskScope, businessError }) {
  const editorRef = useRef(null)
  const listId = useId()
  const [slash, setSlash] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [items, setItems] = useState([])
  useEffect(() => { setSlash(null); setItems([]) }, [taskScope])
  function readCommand(element) {
    if (!onSelectTask || sending) return
    const end = element.selectionStart ?? element.value.length
    const match = element.value.slice(0, end).match(/(^|\s)\/([^\s/]*)$/)
    const next = match ? { start: end - match[2].length - 1, end, query: match[2] } : null
    setSlash(next); setActiveIndex(0)
  }
  function selectTask(item) {
    if (!slash || sending) return
    const next = composer.slice(0, slash.start) + composer.slice(slash.end)
    const caret = slash.start
    onSelectTask(item)
    setComposer(next); setSlash(null); setItems([])
    editorRef.current?.focus()
    requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(caret, caret) })
  }
  function handleComposerKeyDown(event) {
    if (event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229) return
    if (slash) {
      if (event.key === 'Escape' || event.key === 'Tab') { setSlash(null); setItems([]); if (event.key === 'Escape') event.preventDefault(); return }
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault()
        const count = items.length
        if (event.key === 'Enter') { if (count) selectTask(items[activeIndex]); return }
        if (count) setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
        return
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (!sending) onSend()
  }

  return (
    <div className="ai-composer">
      <div className="ai-composer__inner relative">
        {slash && <ComposerTaskPicker key={taskScope} query={slash.query} activeIndex={activeIndex} setActiveIndex={setActiveIndex} onSelect={selectTask} onItems={setItems} listId={listId} />}
        {selectedTask && <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2" aria-label="已选择业务任务">
          <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-line bg-brand-soft px-2 py-1 text-sm text-brand-ink">
            <span className="shrink-0 text-xs">{selectedTask.kind === 'skill' ? 'Skill' : '流程'}</span><span className="min-w-0 break-words">{selectedTask.name}</span>
            <button type="button" disabled={sending} className="shrink-0 rounded-sm border-0 bg-transparent px-1 text-inherit hover:bg-bg-soft" aria-label={`移除 ${selectedTask.kind === 'skill' ? 'Skill' : '流程'} ${selectedTask.name}`} onClick={() => { onRemoveTask(); editorRef.current?.focus() }}>×</button>
          </span>
        </div>}
        {businessError && <p role="alert" className="m-0 mb-2 text-sm text-err-ink">{businessError}</p>}
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
          <input ref={fileInputRef} type="file" accept={selectedTask ? ".xlsx,.txt,.md" : ".xlsx,.xls,.pdf,.docx,.txt"} disabled={sending} style={{ display: 'none' }} onChange={(event) => onAttachFile(event.target.files?.[0] || null)} />
          <button className="ai-composer__attach" type="button" onClick={onChooseFile} disabled={sending} aria-label={selectedFile ? '替换附件' : '附加文件'} title={selectedFile ? '替换附件' : '附加文件'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <textarea
            ref={editorRef}
            rows="3"
            disabled={sending}
            aria-haspopup={onSelectTask ? "listbox" : undefined}
            aria-controls={slash ? listId : undefined}
            aria-activedescendant={slash && items.length ? `${listId}-${activeIndex}` : undefined}
            aria-label="AI 工作台输入"
            value={composer}
            onChange={(event) => { setComposer(event.target.value); readCommand(event.target) }}
            onClick={event => readCommand(event.target)}
            onBlur={event => { if (!event.relatedTarget?.closest('[aria-label="技能清单"]')) setSlash(null) }}
            onKeyDown={handleComposerKeyDown}
            placeholder={selectedTask ? `给${selectedTask.name}的提示词…` : `${placeholder || "输入消息"} 输入 / 选择 Skill 或流程。`}
            className="ai-composer__textarea"
          />
          <button className="ai-composer__send" type="button" onClick={onSend} disabled={sending || !!slash} aria-label="发送消息" title="发送消息">
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
