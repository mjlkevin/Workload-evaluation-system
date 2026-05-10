import React from 'react'

function MiniBar({ value, max, color }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <>
      <div
        style={{
          height: 3,
          background: 'var(--bg-2)',
          borderRadius: 999,
          marginTop: 6,
          overflow: 'hidden',
        }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999 }} />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9.5,
          color: 'var(--ink-4)',
          marginTop: 2,
        }}
      >
        <span>0</span>
        <span>{max}</span>
      </div>
    </>
  )
}

export default function ParamMiniBar({ params }) {
  const items = [
    {
      key: 'userCount',
      label: '用户数',
      value: params.userCount,
      unit: '人',
      max: params.userCountMax || 500,
      barColor: 'var(--brand)',
      numColor: 'var(--ink)',
    },
    {
      key: 'difficultyFactor',
      label: '难度系数',
      value: params.difficultyFactor,
      unit: `+${Math.round(params.difficultyFactor * 100)}%`,
      max: 1.0,
      barColor: 'var(--accent)',
      numColor: 'var(--accent-ink)',
    },
    {
      key: 'orgCount',
      label: '组织数',
      value: params.orgCount,
      unit: '',
      max: 10,
      barColor: 'var(--brand)',
      numColor: 'var(--ink)',
      note: params.orgCount === 1 ? '单组织 · 不计推广' : `${params.orgCount} 组织`,
    },
    {
      key: 'orgSimilarity',
      label: '组织相似度',
      value: params.orgSimilarity,
      unit: '',
      max: 1.0,
      barColor: 'var(--teal)',
      numColor: 'var(--ink)',
    },
  ]

  return (
    <div
      style={{
        marginTop: 14,
        background: '#fff',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 18,
      }}
    >
      {items.map((it) => (
        <div key={it.key}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{it.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: it.numColor }}>
              {it.value}
            </span>
            {it.unit && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{it.unit}</span>}
          </div>
          {it.note ? (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>{it.note}</div>
          ) : (
            <MiniBar value={it.value} max={it.max} color={it.barColor} />
          )}
        </div>
      ))}
    </div>
  )
}
