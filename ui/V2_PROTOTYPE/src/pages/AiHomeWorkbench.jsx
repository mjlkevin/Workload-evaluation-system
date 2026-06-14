import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'
import ArtifactPanel from '../components/AiWorkbench/ArtifactPanel.jsx'
import SessionRail from '../components/AiWorkbench/SessionRail.jsx'
import { useAiSessions } from '../hooks/useAiSessions.js'
import { getAiHomePreset } from './aiHomePresets.js'

const panel = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: '#fff',
  boxShadow: 'var(--shadow-1)',
}

function RoleBadge({ children }) {
  return <span className="bdg brd" style={{ fontSize: 11, padding: '2px 8px' }}><span className="dot" />{children}</span>
}

function ResultCard({ title, children }) {
  return (
    <section style={{ ...panel, overflow: 'hidden' }}>
      <h3 style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>{title}</h3>
      <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>{children}</div>
    </section>
  )
}

function getWorkflowOutputs(workflow) {
  if (!workflow) {
    return {
      title: '沉淀结果',
      empty: '对话开始后，这里会沉淀项目草稿、需求包、待确认问题和评估输入。',
      outputs: ['需求包草稿', '待确认问题', '实施评估输入', '风险假设'],
    }
  }

  if (workflow.key.includes('question')) {
    return {
      title: '待确认问题',
      empty: '将沉淀客户回问清单、缺失资料和影响评估口径的关键假设。',
      outputs: ['客户回问清单', '缺失资料', '范围假设', '风险提示'],
    }
  }

  if (workflow.key.includes('assessment') || workflow.key.includes('scope')) {
    return {
      title: '实施评估输入',
      empty: '将沉淀模块建议、实施范围、复杂度和风险假设，便于进入实施评估。',
      outputs: ['模块建议', '范围边界', '复杂度依据', '风险假设'],
    }
  }

  if (workflow.key.includes('file') || workflow.key.includes('project')) {
    return {
      title: '需求包草稿',
      empty: '将沉淀业务主题、需求条目、待确认问题和下游评估入口。',
      outputs: ['业务主题', '需求条目', '待确认问题', '评估入口'],
    }
  }

  return {
    title: workflow.title,
    empty: `将围绕「${workflow.title}」沉淀可接力的结构化结果。`,
    outputs: ['关键结论', '待办动作', '下游入口', '风险提示'],
  }
}

function LoadingDots() {
  return (
    <span className="ai-home-loading-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function fileKind(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name
  const ext = String(name || 'FILE').split('.').pop()?.trim().toUpperCase()
  return ext && ext !== name ? ext.slice(0, 4) : 'FILE'
}

function fileSizeLabel(size) {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function AttachmentCard({ file, state = 'pending', onRemove, compact = false, inverted = false }) {
  if (!file?.name) return null
  const kind = fileKind(file)
  const size = fileSizeLabel(file.size)
  const status = state === 'sent' ? '已发送' : '已附加，将随下一条消息发送'
  const meta = [kind, size, status].filter(Boolean).join(' · ')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '8px 10px' : '9px 10px',
        border: inverted ? '1px solid rgba(255,255,255,.28)' : '1px solid var(--line)',
        borderRadius: 10,
        background: inverted ? 'rgba(255,255,255,.14)' : 'var(--bg-soft)',
        boxShadow: compact || inverted ? 'none' : '0 1px 0 rgba(15,23,42,.03)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 40,
          height: 34,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: inverted ? 'rgba(255,255,255,.18)' : '#fff',
          border: inverted ? '1px solid rgba(255,255,255,.26)' : '1px solid var(--line)',
          color: inverted ? '#fff' : 'var(--brand)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 850,
        }}
      >
        {kind}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 750, color: inverted ? '#fff' : 'var(--ink)' }}>
          {file.name}
        </div>
        <div style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: inverted ? 'rgba(255,255,255,.78)' : 'var(--ink-3)' }}>
          {meta}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          aria-label="移除附件"
          title="移除附件"
          onClick={onRemove}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: '#fff',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function renderInlineMarkdown(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>
    }
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
  })
}

function parseMarkdownBlocks(text) {
  const blocks = []
  const paragraphLines = []
  let currentList = null

  function flushParagraph() {
    const paragraph = paragraphLines.join(' ').trim()
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph })
    paragraphLines.length = 0
  }

  function flushList() {
    if (currentList?.items.length) blocks.push(currentList)
    currentList = null
  }

  text.replace(/\r\n/g, '\n').split('\n').forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      return
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    const listType = orderedMatch ? 'orderedList' : unorderedMatch ? 'unorderedList' : null

    if (listType) {
      flushParagraph()
      if (!currentList || currentList.type !== listType) {
        flushList()
        currentList = { type: listType, items: [] }
      }
      currentList.items.push(orderedMatch?.[1] || unorderedMatch?.[1])
      return
    }

    flushList()
    paragraphLines.push(line)
  })

  flushParagraph()
  flushList()
  return blocks.length ? blocks : [{ type: 'paragraph', text }]
}

function RichAiMessage({ text }) {
  return (
    <div className="ai-message-rich">
      {parseMarkdownBlocks(text).map((block, blockIndex) => {
        if (block.type === 'orderedList' || block.type === 'unorderedList') {
          const ListTag = block.type === 'orderedList' ? 'ol' : 'ul'
          return (
            <ListTag key={`list-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`item-${blockIndex}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `item-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          )
        }

        return (
          <p key={`paragraph-${blockIndex}`}>
            {renderInlineMarkdown(block.text, `paragraph-${blockIndex}`)}
          </p>
        )
      })}
    </div>
  )
}

function mapSessionMessages(session) {
  if (!Array.isArray(session?.messages)) return []
  const attachmentsById = new Map((Array.isArray(session.attachments) ? session.attachments : [])
    .filter((attachment) => attachment?.attachmentId && attachment?.name)
    .map((attachment) => [attachment.attachmentId, attachment]))
  return session.messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message, index) => {
      const file = (Array.isArray(message.attachmentIds) ? message.attachmentIds : [])
        .map((attachmentId) => attachmentsById.get(attachmentId))
        .find(Boolean)
      return {
        id: message.messageId || `${session.sessionId}-${index}`,
        role: message.role,
        text: message.content || '',
        file: file ? { name: file.name, size: file.size, type: file.type } : undefined,
      }
    })
    .filter((message) => message.text)
}

function sameMessageList(left, right) {
  if (left.length !== right.length) return false
  return left.every((message, index) => (
    message.role === right[index]?.role &&
    message.text === right[index]?.text &&
    message.file?.name === right[index]?.file?.name &&
    message.file?.size === right[index]?.file?.size &&
    message.file?.type === right[index]?.file?.type
  ))
}

function withCurrentUserFile(sessionMessages, userMessage) {
  if (!userMessage?.file) return sessionMessages
  const lastUserIndex = sessionMessages.map((message) => message.role).lastIndexOf('user')
  if (lastUserIndex < 0) return sessionMessages
  return sessionMessages.map((message, index) => (
    index === lastUserIndex && message.text === userMessage.text
      ? { ...message, file: userMessage.file }
      : message
  ))
}

export default function AiHomeWorkbench({ currentUser }) {
  const preset = useMemo(() => getAiHomePreset(currentUser?.businessRole), [currentUser?.businessRole])
  const workflowsByKey = useMemo(() => new Map(preset.workflows.map((workflow) => [workflow.key, workflow])), [preset.workflows])
  const {
    sessions,
    activeSession,
    loadingSessions,
    loadSessions,
    createSession,
    upsertSession,
    setActiveSession,
  } = useAiSessions()
  const [composer, setComposer] = useState('')
  const [draftBeforeLogin, setDraftBeforeLogin] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [messages, setMessages] = useState([])
  const [activeWorkflowKey, setActiveWorkflowKey] = useState('')
  const [sending, setSending] = useState(false)
  const [confirmingActionId, setConfirmingActionId] = useState('')
  const fileInputRef = useRef(null)
  const activeWorkflow = workflowsByKey.get(activeWorkflowKey)
  const centerTitle = activeWorkflow?.title || preset.headline
  const centerHint = activeWorkflow?.desc || preset.emptyHint
  const outputState = getWorkflowOutputs(activeWorkflow)

  useEffect(() => {
    loadSessions().catch(() => {})
  }, [loadSessions])

  useEffect(() => {
    if (activeSession?.workflowKey && !activeWorkflowKey) {
      setActiveWorkflowKey(activeSession.workflowKey === 'free_chat' ? '' : activeSession.workflowKey)
    }
  }, [activeSession?.workflowKey, activeWorkflowKey])

  useEffect(() => {
    if (sending || !activeSession) return
    const sessionMessages = mapSessionMessages(activeSession)
    setMessages((prev) => {
      if (prev.some((message) => message.loading || message.error || message.action)) return prev
      if (sessionMessages.length === 0 && prev.length > 0) return prev
      return sameMessageList(prev, sessionMessages) ? prev : sessionMessages
    })
  }, [activeSession, sending])

  function chooseFile() {
    fileInputRef.current?.click()
  }

  async function createStandardDraftFromFile(file) {
    const session = activeSession || await createSession({
      title: file.name,
      domain: 'standard_governance',
      workflowKey: 'standard_governance',
      status: 'standard_review',
    })
    const payload = await apiClient.post(`/ai-sessions/${session.sessionId}/standard-drafts`, {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    }, { suppressUnauthorizedRedirect: true })
    const data = unwrap(payload)
    if (data?.session) upsertSession(data.session)
  }

  function attachFile(file) {
    setSelectedFile(file || null)
    if (file && activeWorkflowKey === 'standard_governance') {
      createStandardDraftFromFile(file).catch((err) => {
        setMessages((prev) => [...prev, {
          id: `standard-error-${Date.now()}`,
          role: 'assistant',
          text: `标准文件解析暂未完成：${err.message || '请求失败'}`,
          error: true,
        }])
      })
    }
  }

  function removeSelectedFile() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startWorkflow(workflow) {
    setActiveWorkflowKey(workflow.key)
    setComposer(`${workflow.title}：${workflow.desc}`)
  }

  function startNewSession() {
    setActiveSession(null)
    setMessages([])
    setActiveWorkflowKey('')
  }

  function selectSession(session) {
    setActiveSession(session)
    setActiveWorkflowKey(session?.workflowKey && session.workflowKey !== 'free_chat' ? session.workflowKey : '')
  }

  async function confirmPendingAction(action) {
    if (action?.actionType !== 'create_project_evaluation') return
    if (confirmingActionId) return
    setConfirmingActionId(action.actionId || action.title || 'confirming')
    const payload = action.payload || {}
    try {
      const response = await apiClient.post('/project-evaluations', {
        projectName: payload.projectName || activeSession?.title || '未命名项目评估',
        customerName: payload.customerName || '',
        industry: payload.industry || '',
        currentStage: payload.currentStage || 'project_discovery',
        projectStatus: 'draft',
        createdFromSessionId: activeSession?.sessionId,
      }, { suppressUnauthorizedRedirect: true })
      const project = unwrap(response)?.project
      if (!project || !activeSession) return
      upsertSession({
        ...activeSession,
        pendingActions: (activeSession.pendingActions || []).map((item) => (
          item.actionId === action.actionId ? { ...item, status: 'executed', result: { projectId: project.projectId } } : item
        )),
        linkedRecords: {
          ...(activeSession.linkedRecords || {}),
          projectId: project.projectId,
          projectName: project.projectName,
        },
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setConfirmingActionId('')
    }
  }

  async function sendMessage() {
    const text = composer.trim()
    if ((!text && !selectedFile) || sending) return
    const fileSnapshot = selectedFile
      ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
      : null
    const userMessage = { role: 'user', text: text || '请解析这个文件并启动工作流。', file: fileSnapshot }
    const loadingId = `ai-loading-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const loadingMessage = { id: loadingId, role: 'assistant', text: '正在理解你的问题', loading: true }
    const outboundMessages = [...messages, userMessage]
      .filter((message) => !message.loading && !message.error)
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.text,
        attachments: message.file ? [message.file] : [],
      }))

    setMessages((prev) => [...prev, userMessage, loadingMessage])
    setComposer('')
    removeSelectedFile()
    setDraftBeforeLogin(text)
    setSending(true)
    try {
      const workflowKey = activeWorkflowKey || activeSession?.workflowKey || 'free_chat'
      const session = activeSession || await createSession({
        title: text.slice(0, 40) || fileSnapshot?.name || 'AI 工作台会话',
        workflowKey,
        status: workflowKey === 'free_chat' ? 'temporary_chat' : 'rough_estimate',
      })
      const payload = await apiClient.post('/ai/home-workbench/chat', {
        sessionId: session?.sessionId,
        workflowKey,
        messages: outboundMessages,
      }, { suppressUnauthorizedRedirect: true })
      const data = unwrap(payload) || {}
      if (data.session) {
        upsertSession(data.session)
        const sessionMessages = withCurrentUserFile(mapSessionMessages(data.session), userMessage)
        if (sessionMessages.length) {
          setMessages((prev) => sameMessageList(prev, sessionMessages) ? prev : sessionMessages)
        }
      } else {
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId
            ? {
                id: loadingId,
                role: 'assistant',
                text: data.answer || 'AI 已收到，但暂未返回有效内容。',
                model: data.model,
              }
            : message
        )))
      }
    } catch (err) {
      setMessages((prev) => prev.map((message) => (
        message.id === loadingId
          ? {
              id: loadingId,
              role: 'assistant',
              text: err.status === 401
                ? '登录已过期，请重新登录后继续发送。你的草稿已保留在当前对话里。'
                : `AI 对话暂未完成：${err.message || '请求失败'}`,
              error: true,
              action: err.status === 401 ? 'login_required' : undefined,
            }
          : message
      )))
    } finally {
      setSending(false)
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    sendMessage()
  }

  async function copyDraft() {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const draft = draftBeforeLogin || lastUserMessage?.text || ''
    if (draft) await navigator.clipboard?.writeText?.(draft)
  }

  function goLogin() {
    window.location.href = '/login'
  }

  return (
    <div className="ai-home-workbench" data-testid="ai-home-workbench" style={{ display: 'grid', gap: 16, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <aside className="ai-home-rail" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        <section style={{ ...panel, padding: 16 }}>
          <RoleBadge>{preset.label}</RoleBadge>
          <h2 style={{ margin: '12px 0 8px', fontSize: 18, lineHeight: 1.35 }}>{preset.headline}</h2>
          <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.7 }}>{preset.emptyHint}</p>
        </section>

        <SessionRail
          sessions={sessions}
          activeSessionId={activeSession?.sessionId}
          onSelect={selectSession}
          onNew={startNewSession}
        />

        <section style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 800 }}>推荐工作流</div>
          <div style={{ padding: 10, display: 'grid', gap: 8 }}>
            {preset.workflows.map((workflow) => (
              <button
                key={workflow.key}
                type="button"
                onClick={() => startWorkflow(workflow)}
                aria-pressed={activeWorkflowKey === workflow.key}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: activeWorkflowKey === workflow.key ? '1px solid var(--accent)' : '1px solid var(--line)',
                  borderRadius: 8,
                  background: activeWorkflowKey === workflow.key ? 'var(--accent-soft)' : '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <b style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)' }}>{workflow.title}</b>
                <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{workflow.desc}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section style={{ ...panel, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ minHeight: 48, padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <RoleBadge>AI 工作台</RoleBadge>
          <span style={{ color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.systemPrompt}</span>
          {loadingSessions && <span className="tag" style={{ marginLeft: 'auto' }}>加载会话</span>}
        </div>

        <div data-testid="ai-home-message-pane" style={{ flex: 1, minHeight: 0, padding: 18, overflowY: 'auto', background: 'linear-gradient(180deg,#fff,var(--bg-soft))' }}>
          {!messages.length && (
            <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 28, background: '#fff' }}>
              {activeWorkflow && <RoleBadge>当前工作流：{activeWorkflow.title}</RoleBadge>}
              <h2 style={{ margin: activeWorkflow ? '12px 0 8px' : '0 0 8px', fontSize: 22 }}>{centerTitle}</h2>
              <p style={{ margin: '0 0 16px', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.8 }}>{centerHint}</p>
              {activeWorkflow && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                  {outputState.outputs.map((item) => <span key={item} className="tag brd">{item}</span>)}
                </div>
              )}
              <button className="btn btn-pri" type="button" onClick={chooseFile}>选择文件</button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 14 }}>
            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <article key={message.id || `${message.role}-${index}`} style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  {!isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,var(--brand),var(--accent))', color: '#fff', fontWeight: 800 }}>AI</div>}
                  <div style={{ maxWidth: '76%', padding: 14, borderRadius: 12, border: message.error ? '1px solid color-mix(in oklab, var(--err) 28%, var(--line))' : '1px solid var(--line)', background: isUser ? 'var(--brand)' : message.error ? '#fff7f7' : '#fff', color: isUser ? '#fff' : message.error ? 'var(--err)' : 'var(--ink)', boxShadow: 'var(--shadow-1)' }}>
                    {message.loading ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.7 }}>{message.text}</div>
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12 }}>
                          <LoadingDots />
                          <span>正在调用模型并组织回复</span>
                        </div>
                      </div>
                    ) : (
                      isUser || message.error
                        ? <div style={{ fontSize: 13, lineHeight: 1.7 }}>{message.text}</div>
                        : <RichAiMessage text={message.text} />
                    )}
                    {message.file && <div style={{ marginTop: 10 }}><AttachmentCard file={message.file} state="sent" compact inverted={isUser} /></div>}
                    {message.action === 'login_required' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button className="btn btn-pri" type="button" onClick={goLogin} style={{ height: 30 }}>重新登录</button>
                        <button className="btn btn-out" type="button" onClick={copyDraft} style={{ height: 30 }}>复制草稿</button>
                      </div>
                    )}
                  </div>
                  {isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', fontWeight: 800 }}>我</div>}
                </article>
              )
            })}
          </div>
        </div>

        <div style={{ padding: 14, borderTop: '1px solid var(--line)', background: '#fff' }}>
          <div style={{ display: 'grid', gap: 8, border: '1px solid var(--line)', borderRadius: 12, padding: 8 }}>
            {selectedFile && <AttachmentCard file={selectedFile} onRemove={removeSelectedFile} />}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{ display: 'none' }} onChange={(event) => attachFile(event.target.files?.[0] || null)} />
              <button className="btn btn-out" type="button" onClick={chooseFile} aria-label={selectedFile ? '替换附件' : '附加文件'} title={selectedFile ? '替换附件' : '附加文件'} style={{ height: 36, minWidth: 40 }}>＋</button>
              <textarea
                rows="1"
                aria-label="AI 工作台输入"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={preset.placeholder}
                style={{ flex: 1, border: 0, outline: 'none', resize: 'vertical', height: 54, minHeight: 38, maxHeight: 120, padding: '8px 4px', fontFamily: 'inherit', fontSize: 13, lineHeight: '18px', overflowY: 'auto' }}
              />
              <button className="btn btn-pri" type="button" onClick={sendMessage} disabled={sending} aria-label="发送消息" title="发送消息" style={{ height: 36, minWidth: 44 }}>{sending ? '…' : '➤'}</button>
            </div>
          </div>
        </div>
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        <ArtifactPanel session={activeSession} onConfirmAction={confirmPendingAction} confirmingActionId={confirmingActionId} />
        <ResultCard title={outputState.title}>
          {messages.length ? '当前对话已生成初步工作流结果，可继续补充问题或进入下游页面。' : outputState.empty}
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {outputState.outputs.map((item) => <span key={item} className="tag">{item}</span>)}
          </div>
        </ResultCard>
        <ResultCard title="当前文件">
          {selectedFile ? <AttachmentCard file={selectedFile} compact /> : '尚未上传文件'}
        </ResultCard>
        <ResultCard title="快捷入口">
          <div style={{ display: 'grid', gap: 8 }}>
            <Link className="btn btn-out" to="/requirements">需求列表</Link>
            <Link className="btn btn-out" to="/assessments">实施评估</Link>
            {preset.key === 'admin' && <Link className="btn btn-out" to="/users">用户管理</Link>}
          </div>
        </ResultCard>
      </aside>
    </div>
  )
}
