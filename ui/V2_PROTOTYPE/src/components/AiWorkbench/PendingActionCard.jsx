export default function PendingActionCard({ action, onConfirm, confirming = false }) {
  if (!action) return null
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: '#fff' }}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{action.title}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        高风险写入动作，需要确认后执行。
      </div>
      <button type="button" className="btn btn-pri" style={{ marginTop: 10, height: 30 }} disabled={confirming} onClick={() => onConfirm?.(action)}>
        {confirming ? '执行中…' : '确认执行'}
      </button>
    </div>
  )
}
