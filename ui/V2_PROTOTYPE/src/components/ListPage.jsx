import React, { useState, useMemo } from 'react'
import PageShell from './Layout/PageShell.jsx'

export default function ListPage({
  route,
  title,
  subtitle,
  crumb,
  actions,
  filterTags,
  columns,
  data = [],
  emptyText = '暂无数据',
  rowKey = 'id',
  onRowClick,
}) {
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')

  const filtered = useMemo(() => {
    let rows = data
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((r) =>
        columns.some((c) => {
          const v = c.getter ? c.getter(r) : r[c.key]
          return String(v).toLowerCase().includes(q)
        })
      )
    }
    return rows.slice(0, 12)
  }, [data, search, columns])

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = (checked) => {
    setSelected(new Set(checked ? filtered.map((r) => r[rowKey]) : []))
  }

  return (
    <PageShell crumb={crumb} title={title} subtitle={subtitle} actions={actions}>
      {/* toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        {selected.size > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            已选 <b>{selected.size}</b> 条
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {filterTags?.map((tag) => (
            <button
              key={tag.key}
              onClick={() => setActiveFilter(tag.key)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                border: 0,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: activeFilter === tag.key ? 'var(--brand)' : 'var(--bg-soft)',
                color: activeFilter === tag.key ? '#fff' : 'var(--ink-3)',
              }}
            >
              {tag.label}
            </button>
          ))}
          <input
            type="text"
            placeholder="搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 12,
              fontFamily: 'inherit',
              width: 160,
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* table */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 40,
            color: 'var(--ink-3)',
            border: '2px dashed var(--line)',
            borderRadius: 'var(--r-lg)',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div>{emptyText}</div>
        </div>
      ) : (
        <div style={{ overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontSize: 13,
              minWidth: 600,
            }}
          >
            <thead>
              <tr>
                <th style={{ width: 40, padding: '10px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((r) => selected.has(r[rowKey]))}
                    onChange={(e) => selectAll(e.target.checked)}
                  />
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      padding: '10px',
                      background: 'var(--bg-soft)',
                      borderBottom: '1px solid var(--line)',
                      textAlign: c.align || 'left',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--ink-3)',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const isSel = selected.has(row[rowKey])
                return (
                  <tr
                    key={row[rowKey] ?? idx}
                    onClick={() => {
                      toggleRow(row[rowKey])
                      onRowClick?.(row)
                    }}
                    style={{
                      cursor: 'pointer',
                      background: isSel ? 'var(--brand-soft)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px', borderTop: idx > 0 ? '1px solid var(--line)' : 0, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleRow(row[rowKey])}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        style={{
                          padding: '10px',
                          borderTop: idx > 0 ? '1px solid var(--line)' : 0,
                          textAlign: c.align || 'left',
                          color: c.color || 'var(--ink)',
                          whiteSpace: c.nowrap ? 'nowrap' : 'normal',
                        }}
                      >
                        {c.render ? c.render(row) : c.getter ? c.getter(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* pager */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'flex-end',
          paddingTop: 10,
          fontSize: 12,
          color: 'var(--ink-3)',
        }}
      >
        <button className="btn btn-ghost" style={{ height: 26, padding: '0 8px', fontSize: 12 }}>‹</button>
        <span>1 / 1</span>
        <button className="btn btn-ghost" style={{ height: 26, padding: '0 8px', fontSize: 12 }}>›</button>
      </div>
    </PageShell>
  )
}
