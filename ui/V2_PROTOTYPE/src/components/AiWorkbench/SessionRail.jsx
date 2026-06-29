export default function SessionRail({ sessions = [], activeSessionId, onSelect, onNew, onDelete }) {
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13 }}>会话</b>
        <button type="button" className="btn btn-out" onClick={onNew} style={{ marginLeft: 'auto', height: 28, minWidth: 34 }} aria-label="新建会话" title="新建会话">＋</button>
      </div>
      <div className="ai-session-list" style={{ padding: 10, display: 'grid', gap: 8, maxHeight: 240, overflowY: 'auto', minHeight: 0 }}>
        {sessions.length ? sessions.map((session) => {
          const active = activeSessionId === session.sessionId
          const title = session.title || '未命名会话'
          return (
            <div
              key={session.sessionId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
                border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
                background: active ? 'var(--accent-soft)' : '#fff',
                borderRadius: 8,
                padding: '8px 10px 8px 12px',
              }}
            >
              <button
                type="button"
                onClick={() => onSelect?.(session)}
                aria-pressed={active}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <b style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
                <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)' }}>{session.status || 'temporary_chat'}</span>
              </button>
              <button
                type="button"
                aria-label={`删除会话：${title}`}
                title={`删除会话：${title}`}
                onClick={() => onDelete?.(session)}
                style={{
                  width: 30,
                  height: 28,
                  flex: '0 0 auto',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  background: '#fff5f5',
                  color: '#b42318',
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 800,
                  lineHeight: '24px',
                }}
              >
                ×
              </button>
            </div>
          )
        }) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>暂无历史会话</span>}
      </div>
    </section>
  )
}
