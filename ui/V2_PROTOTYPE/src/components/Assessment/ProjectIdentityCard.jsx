import React, { useState } from 'react'

export default function ProjectIdentityCard({ data }) {
  const [productLines, setProductLines] = useState(data.productLines || [])
  const [showAdd, setShowAdd] = useState(false)

  const options = ['金蝶AI星空', '金蝶云·苍穹', '金蝶云·星瀚', '金蝶EAS']
  const isReadonly = data.vcs?.isReadonly ?? false

  const cardBg = isReadonly
    ? 'linear-gradient(135deg, #ecfdf5 0%, #fff 100%)'
    : 'linear-gradient(135deg, oklch(0.98 0.025 262) 0%, #fff 100%)'
  const leftBorder = isReadonly ? '3px solid #10b981' : '3px solid var(--brand, #4f46e5)'

  return (
    <div
      style={{
        background: cardBg,
        border: isReadonly ? '1px solid #a7f3d0' : '1px solid var(--line, #e5e7eb)',
        borderLeft: leftBorder,
        borderRadius: 'var(--r-lg, 12px)',
        padding: '16px 18px',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      {/* 项目名称 */}
      <div style={{ flex: '1 1 280px', minWidth: 240 }}>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3, #6b7280)', fontWeight: 500, letterSpacing: '0.04em' }}>
          项目名称
        </div>
        <input
          defaultValue={data.projectName}
          disabled={isReadonly}
          style={{
            marginTop: 4,
            fontSize: 17,
            fontWeight: 600,
            border: 0,
            background: 'transparent',
            padding: '2px 0',
            width: '100%',
            color: 'var(--ink, #1f2937)',
            outline: 'none',
          }}
        />
      </div>

      {/* 产品线 */}
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3, #6b7280)', fontWeight: 500 }}>产品线</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {productLines.map((pl) => (
            <span
              key={pl}
              className="pl starry"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--brand-soft, #e0e7ff)',
                color: 'var(--brand, #4f46e5)',
              }}
            >
              {pl}
            </span>
          ))}
          {!isReadonly && (
            <>
              <button
                onClick={() => setShowAdd(!showAdd)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  border: '1.5px dashed var(--brand)',
                  background: 'var(--brand-soft)',
                  color: 'var(--brand)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: 0,
                }}
                title="添加产品线"
              >
                +
              </button>
              {showAdd && (
                <div
                  style={{
                    position: 'absolute',
                    background: '#fff',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: 8,
                    boxShadow: 'var(--shadow-2)',
                    zIndex: 30,
                    marginTop: 4,
                  }}
                >
                  {options
                    .filter((o) => !productLines.includes(o))
                    .map((o) => (
                      <div
                        key={o}
                        style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderRadius: 6 }}
                        onClick={() => {
                          setProductLines([...productLines, o])
                          setShowAdd(false)
                        }}
                        onMouseEnter={(e) => (e.target.style.background = 'var(--bg-soft)')}
                        onMouseLeave={(e) => (e.target.style.background = 'transparent')}
                      >
                        {o}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 需求来源 */}
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3, #6b7280)', fontWeight: 500 }}>需求来源</div>
        <div style={{ marginTop: 6 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              alert('Mock：需求单据详情\n\n编号：' + data.requirementSource?.code + '\n版本：' + data.requirementSource?.version + '\n标题：' + data.requirementSource?.title)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--info-soft, #dbeafe)',
              color: 'var(--info, #2563eb)',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.target.style.textDecoration = 'underline' }}
            onMouseLeave={(e) => { e.target.style.textDecoration = 'none' }}
          >
            {data.requirementSource?.code} · {data.requirementSource?.version}
          </a>
        </div>
      </div>

      {/* 当前生效版本 */}
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3, #6b7280)', fontWeight: 500 }}>当前生效版本</div>
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--ok-soft, #d1fae5)',
              color: 'var(--ok-ink, #047857)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {data.versionCode}
          </span>
        </div>
      </div>

      {/* 检入检出状态 */}
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3, #6b7280)', fontWeight: 500 }}>检入检出状态</div>
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: isReadonly ? '#ecfdf5' : 'var(--accent-soft, #ffedd5)',
              color: isReadonly ? '#047857' : 'var(--accent-ink, #c2410c)',
            }}
          >
            {isReadonly ? '已检入 · 只读' : '已检出'}
            <span style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.8 }}>
              （{data.vcs?.checkedOutBy} · {data.vcs?.checkedOutAt?.slice(0, 10)}）
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
