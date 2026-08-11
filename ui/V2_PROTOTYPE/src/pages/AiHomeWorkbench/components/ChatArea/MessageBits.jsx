import { useState } from 'react'

/**
 * ISS-2026-08-11-004 / RP-056：消息时间格式化——
 * 当天消息显示 HH:MM；跨天显示 MM-DD HH:MM。
 */
export function formatMessageTime(createdAt) {
  if (!createdAt) return ''
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  return sameDay ? hhmm : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm}`
}

/* RP-056：消息时间戳（复制控件右侧，随悬浮操作栏一并显隐） */
export function MessageTimestamp({ createdAt }) {
  const label = formatMessageTime(createdAt)
  if (!label) return null
  return <time className="ai-msg-time" dateTime={createdAt}>{label}</time>
}

/* ── Copy Session ID Icon ── */
export function CopyMessageButton({ text }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  const handleCopy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard API not available */
    }
  }
  return (
    <div className="ai-msg-actions">
      <button
        type="button"
        onClick={handleCopy}
        className="ai-msg-action-btn"
        title={copied ? '已复制' : '复制'}
        aria-label="复制消息"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
        <span className="ai-msg-action-label">{copied ? '已复制' : '复制'}</span>
      </button>
    </div>
  )
}

export function RoleBadge({ children }) {
  return <span className="bdg brd" style={{ fontSize: 11, padding: '2px 8px' }}><span className="dot" />{children}</span>
}

export function HoverBadge({ label, tooltip, variant = 'brd' }) {
  const [show, setShow] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className={`bdg ${variant}`} style={{ fontSize: 11, padding: '2px 8px', cursor: 'default' }}>
        <span className="dot" />{label}
      </span>
      {show && tooltip && (
        <span
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 90,
            maxWidth: 320,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--ink)',
            color: '#fff',
            fontSize: 11.5,
            lineHeight: 1.6,
            boxShadow: '0 4px 12px rgba(0,0,0,.18)',
            whiteSpace: 'normal',
            pointerEvents: 'none',
            animation: 'ai-badge-fade-in .15s ease',
          }}
        >
          {tooltip}
        </span>
      )}
    </span>
  )
}

export function LoadingDots() {
  return (
    <span className="ai-home-loading-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}
