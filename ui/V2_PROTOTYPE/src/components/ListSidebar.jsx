import React from 'react'

/**
 * 列表页右侧边栏 — 复用项目列表的"快速操作 + 最近动态"面板
 * @param {Array<{label:string, onClick?:Function}>} quickActions
 * @param {Array<{name:string, action:string, time:string, accent?:boolean}>} feed
 */
export default function ListSidebar({ quickActions = [], feed = [] }) {
  return (
    <>
      {quickActions.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>快速操作</div>
          {quickActions.map((q) => (
            <a
              key={q.label}
              href="#"
              onClick={(e) => { e.preventDefault(); q.onClick?.() }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', color: 'var(--ink)', textDecoration: 'none', fontSize: 12.5, borderBottom: '1px solid var(--line)' }}
            >
              {q.label}
              <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>→</span>
            </a>
          ))}
        </div>
      )}
      {feed.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>最近动态</div>
          {feed.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: f.accent ? 'var(--accent-soft)' : 'var(--brand-soft)', color: f.accent ? 'var(--accent-ink)' : 'var(--brand-ink)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{f.name[0]}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--ink)' }}>{f.name}</b> {f.action}
                <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{f.time}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
