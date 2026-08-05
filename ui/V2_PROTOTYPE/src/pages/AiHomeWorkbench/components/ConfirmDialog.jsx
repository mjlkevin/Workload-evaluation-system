export default function ConfirmDialog({ title, message, detail, error = '', confirmLabel = '确认', cancelLabel = '取消', confirming = false, onCancel, onConfirm }) {
  return (
    <div
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && !confirming && onCancel?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(15,23,42,0.42)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-home-confirm-title"
        style={{
          width: 'min(440px, 100%)',
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 24px 64px rgba(15,23,42,0.24)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--err-soft)',
            color: 'var(--err)',
            fontWeight: 900,
          }}>!</span>
          <strong id="ai-home-confirm-title" style={{ fontSize: 14 }}>{title}</strong>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.7 }}>{message}</p>
          {detail && (
            <div style={{
              padding: '10px 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-soft)',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              fontSize: 12.5,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {detail}
            </div>
          )}
          <p style={{ margin: 0, color: 'var(--err)', fontSize: 12 }}>删除后不可恢复。</p>
          {error && (
            <div role="alert" style={{
              padding: '9px 11px',
              borderRadius: 'var(--r-md)',
              background: 'var(--err-soft)',
              border: '1px solid #fecaca',
              color: 'var(--err)',
              fontSize: 12,
              lineHeight: 1.55,
            }}>
              {error}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--bg-soft)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={onCancel} disabled={confirming}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-dan" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={onConfirm} disabled={confirming}>
            {confirming ? '删除中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
