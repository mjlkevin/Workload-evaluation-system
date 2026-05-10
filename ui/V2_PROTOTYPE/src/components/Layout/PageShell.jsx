import React from 'react'

export default function PageShell({ crumb, title, subtitle, actions, children }) {
  return (
    <div>
      <div
        className="pg-hd"
        style={{
          padding: '18px 24px 14px',
          borderBottom: '1px solid var(--line)',
          position: 'sticky',
          top: 0,
          background: 'var(--bg)',
          zIndex: 20,
        }}
      >
        {crumb && (
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 4 }}>{crumb}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h1>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>{subtitle}</p>
            )}
          </div>
          {actions && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {actions}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: '16px 24px 24px' }}>
        {children}
      </div>
    </div>
  )
}
