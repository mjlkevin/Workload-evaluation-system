import React from 'react'

export default function AiCopilot({ data }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, oklch(0.97 0.03 320) 0%, #fff 100%)',
        border: '1px solid oklch(0.82 0.10 320)',
        borderRadius: 'var(--r-md)',
        padding: 16,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 8px',
          borderRadius: 999,
          background: 'oklch(0.62 0.20 320 / 0.12)',
          color: 'oklch(0.42 0.18 320)',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.04em',
        }}
      >
        ✦ AI COPILOT
      </span>
      <p style={{ lineHeight: 1.7, color: 'var(--ink)', fontSize: 13, margin: '10px 0 0' }}>
        {data.suggestion}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {data.actions.map((label) => (
          <button type="button"
            key={label}
            className={label.includes('应用') ? 'btn btn-pri' : 'btn btn-ghost'}
            style={{
              height: 32,
              padding: '0 14px',
              fontSize: 13,
              ...(label.includes('应用')
                ? {
                    background: 'oklch(0.62 0.20 320)',
                    borderColor: 'oklch(0.62 0.20 320)',
                    color: '#fff',
                    boxShadow: '0 6px 18px oklch(0.62 0.20 320 / 0.22)',
                  }
                : {
                    color: 'oklch(0.42 0.18 320)',
                  }),
            }}
            onClick={() => alert('Phase B · 接 API 后实现')}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
