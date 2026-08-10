import React, { useState } from 'react'

export default function PathBreadcrumb({ path }) {
  const safePath = path || {}
  const [expanded, setExpanded] = useState('cloud')
  const [showAllClouds, setShowAllClouds] = useState(false)
  const [selectedQuote, setSelectedQuote] = useState(safePath.quoteMode)
  const [selectedPreset, setSelectedPreset] = useState(safePath.preset)
  const [selectedClouds, setSelectedClouds] = useState(safePath.cloudProducts || [])
  const { quoteMode, preset } = safePath
  const allCloudProducts = safePath.allCloudProducts || []
  const quoteModes = safePath.quoteModes || ['模块报价', '标准清单报价', '范围估算']
  const presets = safePath.presets || ['标准财务供应链', '轻量财务供应链', '集团多组织模板']

  const layers = [
    { key: 'quote', label: '报价模式', value: selectedQuote || quoteMode, color: 'var(--brand)' },
    { key: 'preset', label: '预置', value: selectedPreset || preset, color: 'var(--brand)' },
    { key: 'cloud', label: '云产品', value: selectedClouds.join(' + ') || '未选择', color: 'var(--accent)' },
  ]

  const MAX_VISIBLE = 12
  const hasOverflow = allCloudProducts.length > MAX_VISIBLE
  const visibleClouds = showAllClouds ? allCloudProducts : allCloudProducts.slice(0, MAX_VISIBLE)
  const overflowCount = allCloudProducts.length - MAX_VISIBLE
  const chipStyle = (selected) => ({
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
    opacity: selected ? 1 : 0.72,
  })

  return (
    <div
      style={{
        background: 'var(--surface)',
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
            <button type="button"
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
                maxWidth: '100%',
              }}
            >
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{layer.label} · </span>
              <b style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.value}</b>
              <span style={{ fontSize: 10, flexShrink: 0 }}>▾</span>
            </button>
          </React.Fragment>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
          命中 {selectedClouds.length}/{allCloudProducts.length} 云产品 · {allCloudProducts.length * 2} 条 SKU
        </span>
      </div>

      {expanded === 'quote' && (
        <div
          style={{
            borderTop: '1px dashed var(--line)',
            marginTop: 10,
            paddingTop: 10,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 8 }}>报价模式</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {quoteModes.map((name) => (
              <span
                key={name}
                onClick={() => {
                  setSelectedQuote(name)
                  setExpanded('preset')
                }}
                style={chipStyle(name === selectedQuote)}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {expanded === 'preset' && (
        <div
          style={{
            borderTop: '1px dashed var(--line)',
            marginTop: 10,
            paddingTop: 10,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 8 }}>预置</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {presets.map((name) => (
              <span
                key={name}
                onClick={() => {
                  setSelectedPreset(name)
                  setExpanded('cloud')
                }}
                style={chipStyle(name === selectedPreset)}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

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
              const selected = selectedClouds.includes(name)
              return (
                <span
                  key={name}
                  onClick={() => {
                    setSelectedClouds((prev) =>
                      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
                    )
                  }}
                  style={chipStyle(selected)}
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
