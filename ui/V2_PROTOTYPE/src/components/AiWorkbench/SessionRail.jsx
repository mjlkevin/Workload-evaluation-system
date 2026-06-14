export default function SessionRail({ sessions = [], activeSessionId, onSelect, onNew }) {
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', boxShadow: 'var(--shadow-1)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13 }}>会话</b>
        <button type="button" className="btn btn-out" onClick={onNew} style={{ marginLeft: 'auto', height: 28, minWidth: 34 }} aria-label="新建会话" title="新建会话">＋</button>
      </div>
      <div style={{ padding: 10, display: 'grid', gap: 8 }}>
        {sessions.length ? sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => onSelect?.(session)}
            aria-pressed={activeSessionId === session.sessionId}
            style={{
              textAlign: 'left',
              border: activeSessionId === session.sessionId ? '1px solid var(--accent)' : '1px solid var(--line)',
              background: activeSessionId === session.sessionId ? 'var(--accent-soft)' : '#fff',
              borderRadius: 8,
              padding: '10px 12px',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <b style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title || '未命名会话'}</b>
            <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)' }}>{session.status || 'temporary_chat'}</span>
          </button>
        )) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>暂无历史会话</span>}
      </div>
    </section>
  )
}
