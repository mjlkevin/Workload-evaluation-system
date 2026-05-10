import React, { useState } from 'react'

export default function PathBreadcrumb({ path }) {
  const [expanded, setExpanded] = useState('cloud')
  const [showAllClouds, setShowAllClouds] = useState(false)
  const { quoteMode, preset, cloudProducts, allCloudProducts } = path

  const layers = [
    { key: 'quote', label: '报价模式', value: quoteMode, color: 'var(--brand)' },
    { key: 'preset', label: '预置', value: preset, color: 'var(--brand)' },
    { key: 'cloud', label: '云产品', value: cloudProducts.join(' + '), color: 'var(--accent)' },
  ]

  const MAX_VISIBLE = 12
  const hasOverflow = allCloudProducts.length > MAX_VISIBLE
  const visibleClouds = showAllClouds ? allCloudProducts : allCloudProducts.slice(0, MAX_VISIBLE)
  const overflowCount = allCloudProducts.length - MAX_VISIBLE

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        padding: '12px 16px',
        marginBottom: 12,
      }}
    >
      {/* breadcrumb path */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}>评估路径</span>
        {layers.map((layer, idx) => (
          <React.Fragment key={layer.key}>
            {idx > 0 && <span style={{ color: 'var(--ink-4)' }}>›</span>}
            <button
              onClick={() => setExpanded(expanded === layer.key ? null : layer.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: layer.color,
                color: '#fff',
                border: 0,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {layer.label} · <b>{layer.value}</b> <span style={{ fontSize: 10 }}>▾</span>
            </button>
          </React.Fragment>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
          命中 {cloudProducts.length}/{allCloudProducts.length} 云产品 · {allCloudProducts.length * 2} 条 SKU
        </span>
      </div>

      {/* expanded cloud chips */}
      {expanded === 'cloud' && (
        <div
          style={{
            borderTop: '1px dashed var(--line)',
            marginTop: 10,
            paddingTop: 10,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 8 }}>云产品</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {visibleClouds.map((name) => {
              const selected = cloudProducts.includes(name)
              return (
                <span
                  key={name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    background: selected ? 'var(--accent)' : 'var(--bg-2)',
                    color: selected ? '#fff' : 'var(--ink-3)',
                    border: '1px solid var(--line)',
                    cursor: 'pointer',
                    opacity: selected ? 1 : 0.55,
                  }}
                >
                  {name}
                </span>
              )
            })}
            {hasOverflow && !showAllClouds && (
              <span
                onClick={() => setShowAllClouds(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--bg-soft)',
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line)',
                  cursor: 'pointer',
                }}
              >
                + {overflowCount} 项子云产品
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
