export default function PendingActionCard({ action, onConfirm, confirming = false }) {
  if (!action) return null
  return (
    <div className="wes-pending-action">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--warn, #d97706)', flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        <span style={{ fontSize: 12.5, fontWeight: 800 }}>{action.title}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        此操作将写入业务系统，确认后不可自动撤销。
      </div>
      <button type="button" className="btn btn-pri" style={{ marginTop: 10, height: 30, fontSize: 12 }} disabled={confirming} onClick={() => onConfirm?.(action)}>
        {confirming ? '执行中…' : '确认执行'}
      </button>
    </div>
  )
}
