import React, { useState } from 'react'
import DaysCell from './DaysCell.jsx'
import CustomStepper from './CustomStepper.jsx'

export default function SkuTable({ groups }) {
  const [selectedRows, setSelectedRows] = useState(new Set())

  const toggleRow = (groupIdx, childIdx) => {
    const key = `${groupIdx}-${childIdx}`
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      {groups.map((g, gi) => {
        // Count selected in this group
        const groupSelected = g.children.filter((_, ci) =>
          selectedRows.has(`${gi}-${ci}`)
        ).length

        return (
          <div
            key={gi}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              marginBottom: 12,
              overflow: 'hidden',
            }}
          >
            {/* Group header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderBottom: '1px solid var(--line)',
                background: 'var(--bg-soft)',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>云产品：{g.name}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 'auto' }}>
                已检入 · 仅显示已勾选 ·{' '}
                <b style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  已选 {groupSelected}/{g.total}
                </b>{' '}
                · <b style={{ color: 'var(--brand)', fontWeight: 600 }}>{g.days} 人天</b> · {g.module}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
                  自定义人天
                </button>
                <button className="btn sm" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
                  全选
                </button>
                <button className="btn sm ghost" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
                  全不选
                </button>
              </div>
            </div>

            {/* Table */}
            <div style={{ overflow: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'separate',
                  borderSpacing: 0,
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr>
                    <th style={{ width: 40, padding: '10px' }}></th>
                    <th style={{ width: 120, padding: '10px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>SKU</th>
                    <th style={{ padding: '10px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>实施要点</th>
                    <th style={{ width: 280, padding: '10px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>实施要点内容说明</th>
                    <th style={{ padding: '10px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>评估说明</th>
                    <th style={{ width: 90, padding: '10px', textAlign: 'right', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>标准人天</th>
                    <th style={{ width: 140, padding: '10px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>自定义人天</th>
                  </tr>
                </thead>
                <tbody>
                  {g.children.map((it, ci) => {
                    const key = `${gi}-${ci}`
                    const isSelected = selectedRows.has(key)
                    const isFirst = ci === 0
                    const rowSpan = g.children.length

                    return (
                      <tr
                        key={key}
                        onClick={() => toggleRow(gi, ci)}
                        style={{
                          cursor: 'pointer',
                          boxShadow: isSelected ? 'inset 3px 0 0 var(--brand)' : 'none',
                          background: isSelected ? 'oklch(0.42 0.14 262 / 0.06)' : 'transparent',
                        }}
                      >
                        <td style={{ textAlign: 'center', padding: '10px', borderTop: '1px solid var(--line)' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 14,
                              height: 14,
                              borderRadius: 3,
                              border: '1.5px solid var(--line-2)',
                              background: isSelected ? 'var(--brand)' : '#fff',
                            }}
                          />
                        </td>
                        {/* rowSpan SKU column */}
                        {isFirst && (
                          <td
                            rowSpan={rowSpan}
                            style={{
                              background: 'var(--bg-2)',
                              fontWeight: 600,
                              color: 'var(--ink)',
                              fontSize: 12,
                              borderRight: '1px solid var(--line)',
                              borderTop: '1px solid var(--line)',
                              verticalAlign: 'middle',
                              textAlign: 'center',
                              padding: '10px',
                            }}
                          >
                            {g.name}
                          </td>
                        )}
                        <td style={{ padding: '10px', borderTop: '1px solid var(--line)' }}>
                          <div style={{ fontWeight: 500, color: isSelected ? 'var(--ink)' : 'var(--ink-3)' }}>
                            {it.name}
                          </div>
                          <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2 }}>· {it.module}</div>
                        </td>
                        <td style={{ color: 'var(--ink-2)', fontSize: 12, padding: '10px', borderTop: '1px solid var(--line)' }}>
                          {it.description}
                        </td>
                        <td style={{ color: 'var(--ink-2)', fontSize: 12, padding: '10px', borderTop: '1px solid var(--line)' }}>
                          {it.assessmentNote}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px', borderTop: '1px solid var(--line)' }}>
                          <DaysCell value={it.baseDays} />
                        </td>
                        <td style={{ padding: '10px', borderTop: '1px solid var(--line)' }}>
                          <CustomStepper
                            baseDays={it.baseDays}
                            initialCustomDays={it.customDays}
                            reasonStatus={it.reasonStatus}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
