import React, { useState } from 'react'

export default function AdvancedCollapsible({ context }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        marginTop: 10,
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        fontSize: 12,
        color: 'var(--ink-3, #6b7280)',
      }}
    >
      <span
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
          ▸
        </span>
        模板与规则集
        <span
          className="bdg muted"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            background: 'var(--bg-soft, #f3f4f6)',
            color: 'var(--ink-3, #6b7280)',
          }}
        >
          {context.template} · {context.ruleSet}
        </span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        ▸ 检出锁定记录
      </span>

      {open && (
        <div
          style={{
            width: '100%',
            marginTop: 8,
            padding: '10px 14px',
            background: 'var(--bg-soft, #f3f4f6)',
            borderRadius: 'var(--r-md, 8px)',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>模板</div>
            <select
              defaultValue={context.template}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '6px 10px',
                background: '#fff',
                font: 'inherit',
                fontSize: 13,
                width: '100%',
              }}
            >
              <option>实施评估标准版</option>
              <option>轻量实施版</option>
              <option>企业定制版</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>规则集</div>
            <select
              defaultValue={context.ruleSet}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '6px 10px',
                background: '#fff',
                font: 'inherit',
                fontSize: 13,
                width: '100%',
              }}
            >
              <option>DSL-2026-Q2</option>
              <option>DSL-2026-Q1</option>
              <option>自定义规则集</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
