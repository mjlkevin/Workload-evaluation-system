import React, { useState } from 'react'

export default function CustomStepper({ baseDays, initialCustomDays, reasonStatus }) {
  const [customDays, setCustomDays] = useState(initialCustomDays ?? baseDays)
  const delta = customDays - baseDays

  const numColor =
    delta > 0 ? 'var(--accent-ink)' : delta < 0 ? 'var(--teal)' : 'var(--ink-3)'

  const dotColor =
    reasonStatus === 'pending'
      ? 'var(--err)'
      : reasonStatus === 'saved'
        ? 'var(--ok)'
        : 'transparent'

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          border: '1px solid var(--line)',
          borderRadius: 7,
          padding: '2px 4px',
          background: '#fff',
        }}
      >
        <button
          style={{
            width: 20,
            height: 20,
            border: 0,
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            borderRadius: 5,
            display: 'grid',
            placeItems: 'center',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'var(--bg-2)'
            e.target.style.color = 'var(--brand)'
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'transparent'
            e.target.style.color = 'var(--ink-2)'
          }}
          onClick={() => setCustomDays((v) => Math.max(0, v - 1))}
        >
          −
        </button>
        <span
          className="mono"
          style={{
            minWidth: 26,
            textAlign: 'center',
            fontWeight: 600,
            fontSize: 12,
            color: numColor,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {customDays}
        </span>
        <button
          style={{
            width: 20,
            height: 20,
            border: 0,
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            borderRadius: 5,
            display: 'grid',
            placeItems: 'center',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'var(--bg-2)'
            e.target.style.color = 'var(--brand)'
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'transparent'
            e.target.style.color = 'var(--ink-2)'
          }}
          onClick={() => setCustomDays((v) => v + 1)}
        >
          +
        </button>
      </div>

      {/* delta badge */}
      {delta !== 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '1px 6px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            border: `1px solid ${delta > 0 ? 'var(--accent-soft)' : 'var(--teal-soft)'}`,
            background: delta > 0 ? 'var(--accent-soft)' : 'var(--teal-soft)',
            color: delta > 0 ? 'var(--accent-ink)' : 'var(--teal)',
          }}
        >
          {delta > 0 ? '+' : ''}{delta}
        </span>
      )}

      {/* reason status dot */}
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          boxShadow: dotColor !== 'transparent' ? '0 0 0 2px #fff, 0 0 0 3px var(--ok)' : 'none',
        }}
        title={
          reasonStatus === 'pending'
            ? '原因待填'
            : reasonStatus === 'saved'
              ? '原因已保存'
              : ''
        }
      />
    </div>
  )
}
