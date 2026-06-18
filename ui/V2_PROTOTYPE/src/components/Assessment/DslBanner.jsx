import React, { useState } from 'react'

export default function DslBanner({ dsl, onAutoFix }) {
  const [open, setOpen] = useState(false)
  if (!dsl?.issues?.length) return null

  const handleAutoFix = () => {
    if (onAutoFix) {
      onAutoFix(dsl.issues)
      return
    }
    alert('Phase B · 将根据 DSL 违规项自动补齐依赖 SKU')
  }

  return (
    <div
      style={{
        background: 'var(--err-soft, #fee2e2)',
        borderLeft: '4px solid var(--err, #dc2626)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        margin: '0 24px',
        borderRadius: '0 var(--r-md) var(--r-md) 0',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--err, #dc2626)', fontWeight: 600 }}>
          ⚠ DSL 校验未通过 · {dsl.issues.length} 条违反 · 修复后才能签入 / 导出
        </div>
        {open && (
          <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--err-ink, #991b1b)', lineHeight: 1.7 }}>
            {dsl.issues.map((d, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    background: 'var(--err)',
                    color: '#fff',
                  }}
                >
                  ! {d.ruleId}
                </span>
                <span>
                  {d.type} · {d.message}
                  {d.blocking && <b> [阻断]</b>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button type="button"
          onClick={handleAutoFix}
          style={{
            height: 28,
            padding: '0 12px',
            borderRadius: 999,
            border: 0,
            background: 'var(--err, #dc2626)',
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          一键修复
        </button>
        <button type="button"
          onClick={() => setOpen(!open)}
          style={{
            fontSize: 12,
            color: 'var(--err-ink, #991b1b)',
            cursor: 'pointer',
            background: 'transparent',
            border: 0,
            fontFamily: 'inherit',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {open ? '收起详情 ▴' : '展开详情 ▾'}
        </button>
      </div>
    </div>
  )
}
