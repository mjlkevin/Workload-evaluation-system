import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '../../hooks/useToast.jsx'
import { useSessionViews } from '../../hooks/useSessionRuntimeStore.js'

// RP-047 Batch D（Step 5）：会话运行状态七态徽标（文本+图标+颜色三通道，不只依赖颜色）
const RUN_STATUS_BADGE = {
  queued: { label: '排队中', icon: '◌', className: 'ai-session-badge ai-session-badge--queued' },
  running: { label: '执行中', icon: '▶', className: 'ai-session-badge ai-session-badge--running' },
  recovering: { label: '恢复中', icon: '↻', className: 'ai-session-badge ai-session-badge--recovering' },
  waiting: { label: '等待确认', icon: '!', className: 'ai-session-badge ai-session-badge--waiting' },
  // cancelling 为过渡态（等待安全边界停止），并入执行中展示
  cancelling: { label: '执行中', icon: '▶', className: 'ai-session-badge ai-session-badge--running' },
  failed: { label: '失败', icon: '✕', className: 'ai-session-badge ai-session-badge--failed' },
  cancelled: { label: '已取消', icon: '⊘', className: 'ai-session-badge ai-session-badge--cancelled' },
}

function getSessionBadge(view) {
  const status = view?.runStatus
  if (status && RUN_STATUS_BADGE[status]) return RUN_STATUS_BADGE[status]
  if (status === 'completed' && view?.unread) {
    return { label: '已完成未读', icon: '●', className: 'ai-session-badge ai-session-badge--unread' }
  }
  return null
}

/** 格式化会话发起时间为简短可读格式 */
function formatSessionTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const pad = (n) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (isToday) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()
  if (isYesterday) return `昨天 ${time}`
  const isThisYear = d.getFullYear() === now.getFullYear()
  if (isThisYear) return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}

export default function SessionRail({ sessions = [], activeSessionId, onSelect, onNew, onDelete, onRename, sessionRuns = {}, onStop }) {
  const [ctxMenu, setCtxMenu] = useState(null) // { sessionId, session, x, y }
  const [renameTarget, setRenameTarget] = useState(null) // session object or null
  const [renameValue, setRenameValue] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)
  const menuRef = useRef(null)
  const renameInputRef = useRef(null)
  const toast = useToast()
  const sessionViews = useSessionViews()

  const closeMenu = useCallback(() => setCtxMenu(null), [])

  useEffect(() => {
    if (!ctxMenu) return
    const handle = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return
      closeMenu()
    }
    const timer = setTimeout(() => {
      window.addEventListener('click', handle)
      window.addEventListener('contextmenu', handle)
      window.addEventListener('scroll', handle, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', handle)
      window.removeEventListener('contextmenu', handle)
      window.removeEventListener('scroll', handle, true)
    }
  }, [ctxMenu, closeMenu])

  const handleContextMenu = (e, session) => {
    e.preventDefault()
    e.stopPropagation()
    // 视口边界检测
    const menuW = 170
    const menuH = 130
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
    setCtxMenu({ sessionId: session.sessionId, session, x, y })
  }

  const handleCopySessionId = async () => {
    if (!ctxMenu) return
    const id = ctxMenu.sessionId
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = id
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    toast.success('Session ID 已复制', { detail: id, duration: 4000 })
    closeMenu()
  }

  const handleDeleteSession = () => {
    if (!ctxMenu) return
    onDelete?.(ctxMenu.session)
    closeMenu()
  }

  const handleOpenRename = () => {
    if (!ctxMenu) return
    setRenameTarget(ctxMenu.session)
    setRenameValue(ctxMenu.session?.title || '')
    closeMenu()
    // 自动聚焦输入框
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  const handleCloseRename = () => {
    if (renameSubmitting) return
    setRenameTarget(null)
    setRenameValue('')
  }

  const handleConfirmRename = async () => {
    if (!renameTarget || renameSubmitting) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      toast.error('会话标题不能为空')
      return
    }
    if (trimmed === renameTarget.title) {
      setRenameTarget(null)
      setRenameValue('')
      return
    }
    setRenameSubmitting(true)
    try {
      const result = await onRename?.(renameTarget.sessionId, trimmed)
      if (result) {
        toast.success('会话已重命名')
      } else {
        toast.error('重命名失败，请重试')
      }
    } catch (err) {
      toast.error(`重命名失败：${err.message || '网络错误'}`)
    } finally {
      setRenameSubmitting(false)
      setRenameTarget(null)
      setRenameValue('')
    }
  }

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleConfirmRename()
    } else if (e.key === 'Escape') {
      handleCloseRename()
    }
  }

  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', boxShadow: 'var(--shadow-1)', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13 }}>会话</b>
        <button type="button" className="btn btn-out" onClick={onNew} style={{ marginLeft: 'auto', height: 28, minWidth: 34 }} aria-label="新建会话" title="新建会话">＋</button>
      </div>
      <div className="ai-session-list" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {sessions.length ? sessions.map((session) => {
          const active = activeSessionId === session.sessionId
          const title = session.title || '未命名会话'
          // G4：会话有活跃 Run 时行内出现“停止”入口（唯一 cancel 路径的第一步）
          const run = sessionRuns[session.sessionId]
          const badge = getSessionBadge(sessionViews[session.sessionId])
          return (
            <div
              key={session.sessionId}
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(session)}
              onContextMenu={(e) => handleContextMenu(e, session)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(session) }}
              aria-pressed={active}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                width: '100%',
                minWidth: 0,
                textAlign: 'left',
                border: active ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                background: active ? 'var(--accent-soft)' : '#fff',
                borderRadius: 8,
                padding: '10px 12px',
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>{title}</span>
                {run && (
                  <button
                    type="button"
                    aria-label={`停止后台任务：${run.title || run.runId}`}
                    title="停止后台任务"
                    onClick={(e) => { e.stopPropagation(); onStop?.(session) }}
                    style={{
                      flexShrink: 0,
                      height: 20,
                      padding: '0 8px',
                      border: '1px solid var(--err, #dc2626)',
                      borderRadius: 6,
                      background: 'var(--err-soft, #fef2f2)',
                      color: 'var(--err, #dc2626)',
                      fontSize: 10.5,
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    停止
                  </button>
                )}
              </div>
              {(session.createdAt || badge) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
                  {session.createdAt && (
                    <span style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.3, letterSpacing: '0.01em' }}>
                      {formatSessionTime(session.createdAt)}
                    </span>
                  )}
                  {badge && (
                    <span className={badge.className}>
                      <span aria-hidden="true">{badge.icon}</span>
                      <span>{badge.label}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        }) : <span style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 4px' }}>暂无历史会话</span>}
      </div>

      {/* 右键菜单通过 Portal 渲染到 body，避免被 overflow:hidden 裁剪 */}
      {ctxMenu && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 2147483647,
            minWidth: 164,
            background: '#fff',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.06)',
            padding: '6px 0',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={handleCopySessionId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 14px',
              border: 'none',
              background: 'transparent',
              fontSize: 12.5,
              color: 'var(--ink)',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-soft, #f3f4f6)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--ink-3)' }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            复制 Session ID
          </button>
          <button
            type="button"
            onClick={handleOpenRename}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 14px',
              border: 'none',
              background: 'transparent',
              fontSize: 12.5,
              color: 'var(--ink)',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-soft, #f3f4f6)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--ink-3)' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            重命名会话
          </button>
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <button
            type="button"
            onClick={handleDeleteSession}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 14px',
              border: 'none',
              background: 'transparent',
              fontSize: 12.5,
              color: 'var(--err, #dc2626)',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            删除会话
          </button>
        </div>,
        document.body
      )}

      {/* 重命名模态弹窗 */}
      {renameTarget && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,.35)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseRename() }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 12px 40px rgba(0,0,0,.18)',
              padding: '24px 28px',
              width: 380,
              maxWidth: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <b style={{ fontSize: 14, color: 'var(--ink)' }}>重命名会话</b>
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              maxLength={80}
              placeholder="输入新的会话标题"
              style={{
                width: '100%',
                height: 36,
                padding: '0 12px',
                border: '1px solid var(--line)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--ink)',
                background: 'var(--bg-soft, #f9fafb)',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={handleCloseRename}
                disabled={renameSubmitting}
                className="btn btn-out"
                style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmRename}
                disabled={renameSubmitting || !renameValue.trim()}
                className="btn btn-primary"
                style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}
              >
                {renameSubmitting ? '保存中…' : '确认'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  )
}
