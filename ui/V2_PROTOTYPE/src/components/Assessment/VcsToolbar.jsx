import React, { useState } from 'react'

export default function VcsToolbar({ dsl, hasLocalChanges }) {
  const [showMore, setShowMore] = useState(false)
  const dslOk = !dsl?.issues?.length

  return (
    <div
      style={{
        marginTop: 14,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      {/* 主操作 */}
      <button className="btn btn-pri" style={{ height: 32, padding: '0 14px', fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>⇣</span> 检出以编辑
      </button>
      <button className="btn btn-out" style={{ height: 32, padding: '0 14px', fontSize: 13 }}>
        版本历史
      </button>
      <button className="btn btn-out" style={{ height: 32, padding: '0 14px', fontSize: 13 }}>
        实时校验
      </button>
      <button className="btn btn-out" style={{ height: 32, padding: '0 14px', fontSize: 13 }}>
        导出
      </button>

      {/* 状态条 */}
      <span
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11.5,
          color: 'var(--ink-3, #6b7280)',
        }}
      >
        <span
          className="bdg"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            background: dslOk ? 'var(--ok-soft, #d1fae5)' : 'var(--err-soft, #fee2e2)',
            color: dslOk ? 'var(--ok-ink, #047857)' : 'var(--err, #dc2626)',
          }}
        >
          DSL {dslOk ? '✓ 通过' : `⚠ ${dsl.issues.length} 条`}
        </span>
        <span>·</span>
        <span>未保存改动 {hasLocalChanges || 0}</span>
      </span>

      {/* 更多 */}
      <div style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost"
          style={{ height: 32, width: 32, padding: 0, fontSize: 16 }}
          onClick={() => setShowMore(!showMore)}
        >
          ⋯
        </button>
        {showMore && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              minWidth: 160,
              padding: 6,
              background: '#fff',
              border: '1px solid var(--line)',
              borderRadius: 10,
              boxShadow: 'var(--shadow-2)',
              zIndex: 40,
            }}
          >
            {['撤销检出', '升版', '强制解锁'].map((label) => (
              <button
                key={label}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 0,
                  background: 'transparent',
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: 'var(--ink)',
                  font: 'inherit',
                  fontSize: 13,
                }}
                onMouseEnter={(e) => (e.target.style.background = 'var(--bg-soft)')}
                onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
