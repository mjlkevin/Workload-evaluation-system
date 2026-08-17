import { fileKind, fileSizeLabel } from '../../utils/harnessPayload.js'

export default function AttachmentCard({ file, state = 'pending', onRemove, compact = false, inverted = false }) {
  if (!file?.name) return null
  const kind = fileKind(file)
  const size = fileSizeLabel(file.size)
  const status = state === 'sent' ? '已发送' : '已附加，将随下一条消息发送'
  const meta = [kind, size, status].filter(Boolean).join(' · ')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '8px 10px' : '9px 10px',
        border: inverted ? '1px solid rgba(255,255,255,.28)' : '1px solid var(--line)',
        borderRadius: 10,
        background: inverted ? 'rgba(255,255,255,.14)' : 'var(--bg-soft)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 40,
          height: 34,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: inverted ? 'rgba(255,255,255,.18)' : '#fff',
          border: inverted ? '1px solid rgba(255,255,255,.26)' : '1px solid var(--line)',
          color: inverted ? '#fff' : 'var(--brand)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 850,
        }}
      >
        {kind}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 750, color: inverted ? '#fff' : 'var(--ink)' }}>
          {file.name}
        </div>
        <div style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: inverted ? 'rgba(255,255,255,.78)' : 'var(--ink-3)' }}>
          {meta}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          aria-label="移除附件"
          title="移除附件"
          onClick={onRemove}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: '#fff',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
