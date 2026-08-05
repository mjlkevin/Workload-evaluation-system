import { pickArray } from '../../utils/harnessPayload.js'

export function ReportPill({ children, tone = 'soft' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 24,
      padding: '2px 8px',
      borderRadius: 7,
      border: tone === 'warn' ? '1px solid #fed7aa' : '1px solid var(--line)',
      background: tone === 'warn' ? '#fff7ed' : 'var(--bg-soft)',
      color: tone === 'warn' ? '#9a3412' : 'var(--ink-2)',
      fontSize: 11.5,
      fontWeight: 700,
    }}>
      {children}
    </span>
  )
}

export function ReportList({ title, items, empty = '待补充' }) {
  const rows = pickArray(items)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: '#fff', minWidth: 0 }}>
      <b style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>{title}</b>
      {rows.length ? (
        <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 6, color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.55 }}>
          {rows.map((item, index) => <li key={`${title}-${index}`}>{String(item)}</li>)}
        </ul>
      ) : (
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{empty}</span>
      )}
    </div>
  )
}

export function ResultCard({ title, children }) {
  return (
    <section className="ai-result-card">
      <div className="ai-result-card__head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span>{title}</span>
      </div>
      <div className="ai-result-card__body">{children}</div>
    </section>
  )
}
