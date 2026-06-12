import React, { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'
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

export default function AiHomeWorkbench({ currentUser }) {
  const preset = useMemo(() => getAiHomePreset(currentUser?.businessRole), [currentUser?.businessRole])
  const [composer, setComposer] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [messages, setMessages] = useState([])
  const [activeWorkflowKey, setActiveWorkflowKey] = useState('')
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef(null)

  function chooseFile() {
    fileInputRef.current?.click()
  }

  function startWorkflow(workflow) {
    setActiveWorkflowKey(workflow.key)
    setComposer(`${workflow.title}：${workflow.desc}`)
  }

  async function sendMessage() {
    const text = composer.trim()
    if ((!text && !selectedFile) || sending) return
    const userMessage = { role: 'user', text: text || '请解析这个文件并启动工作流。', fileName: selectedFile?.name }
    setMessages((prev) => [...prev, userMessage])
    setComposer('')
    setSending(true)
    try {
      const payload = await apiClient.post('/ai/home-workbench/chat', {
        workflowKey: activeWorkflowKey,
        messages: [...messages, userMessage].map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.text,
        })),
      })
      const data = unwrap(payload) || {}
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: data.answer || 'AI 已收到，但暂未返回有效内容。',
        model: data.model,
      }])
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: `AI 对话暂未完成：${err.message || '请求失败'}`,
        error: true,
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr) 300px', gap: 16, minHeight: 'calc(100vh - 168px)' }}>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <section style={{ ...panel, padding: 16 }}>
          <RoleBadge>{preset.label}</RoleBadge>
          <h2 style={{ margin: '12px 0 8px', fontSize: 18, lineHeight: 1.35 }}>{preset.headline}</h2>
          <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.7 }}>{preset.emptyHint}</p>
        </section>

        <section style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 800 }}>推荐工作流</div>
          <div style={{ padding: 10, display: 'grid', gap: 8 }}>
            {preset.workflows.map((workflow) => (
              <button
                key={workflow.key}
                type="button"
                onClick={() => startWorkflow(workflow)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: '#fff',
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

      <section style={{ ...panel, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ minHeight: 48, padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <RoleBadge>AI 工作台</RoleBadge>
          <span style={{ color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.systemPrompt}</span>
        </div>

        <div style={{ flex: 1, padding: 18, overflowY: 'auto', background: 'linear-gradient(180deg,#fff,var(--bg-soft))' }}>
          {!messages.length && (
            <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 28, background: '#fff' }}>
              <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{preset.headline}</h2>
              <p style={{ margin: '0 0 16px', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.8 }}>{preset.emptyHint}</p>
              <button className="btn btn-pri" type="button" onClick={chooseFile}>选择文件</button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 14 }}>
            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <article key={`${message.role}-${index}`} style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  {!isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,var(--brand),var(--accent))', color: '#fff', fontWeight: 800 }}>AI</div>}
                  <div style={{ maxWidth: '76%', padding: 14, borderRadius: 12, border: '1px solid var(--line)', background: isUser ? 'var(--brand)' : '#fff', color: isUser ? '#fff' : 'var(--ink)', boxShadow: 'var(--shadow-1)' }}>
                    <div style={{ fontSize: 13, lineHeight: 1.7 }}>{message.text}</div>
                    {message.fileName && <div style={{ marginTop: 10, padding: 8, borderRadius: 8, background: isUser ? 'rgba(255,255,255,.16)' : 'var(--bg-soft)', fontSize: 12 }}>{message.fileName}</div>}
                  </div>
                  {isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', fontWeight: 800 }}>我</div>}
                </article>
              )
            })}
          </div>
        </div>

        <div style={{ padding: 14, borderTop: '1px solid var(--line)', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, border: '1px solid var(--line)', borderRadius: 12, padding: 8 }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{ display: 'none' }} onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
            <button className="btn btn-out" type="button" onClick={chooseFile} style={{ height: 36, minWidth: 40 }}>＋</button>
            <textarea
              rows="1"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder={preset.placeholder}
              style={{ flex: 1, border: 0, outline: 'none', resize: 'none', minHeight: 34, padding: '8px 4px', fontFamily: 'inherit', fontSize: 13 }}
            />
            <button className="btn btn-pri" type="button" onClick={sendMessage} disabled={sending} style={{ height: 36, minWidth: 44 }}>{sending ? '…' : '➤'}</button>
          </div>
          {selectedFile && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>已附加：{selectedFile.name}</div>}
        </div>
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <ResultCard title="沉淀结果">
          {messages.length ? '当前对话已生成初步工作流结果，可继续补充问题或进入下游页面。' : '对话开始后，这里会沉淀项目草稿、需求包、待确认问题和评估输入。'}
        </ResultCard>
        <ResultCard title="当前文件">
          {selectedFile?.name || '尚未上传文件'}
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
