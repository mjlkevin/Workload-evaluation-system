import React, { useState, useMemo, useCallback } from 'react'
import PageShell from './Layout/PageShell.jsx'

/**
 * 通用列表页 · §6.4 / §6.4.1（决策 B 修订）
 *
 * 行交互（PB-R1 标准）:
 *  - 单击：单选当前行（清除其他）
 *  - ⌘/Ctrl + 单击：toggle 当前行
 *  - Shift + 单击：从锚点区间选择（限当前页可见行）
 *  - 双击：onRowClick(row) — 通常用于跳转详情
 *  - checkbox 点击：toggle 单条（不影响其他）
 *
 * 分页契约（前端插批，替代原 12 行硬截断）:
 *  - 客户端分页，默认每页 pageSize=10，无虚拟滚动：列表数据为
 *    用户创建的业务记录（几十至几百条），页内全量渲染代价可忽略；
 *    且四种选择交互依赖 DOM 行稳定存在，虚拟滚动会使 Shift 范围选择
 *    与可访问性复杂化，收益不成立。
 *  - 底部始终显示「共 N 条 · 显示 a-b」，让用户知道数据存在。
 *  - 跨页选择结论：**切页保留选中**。selected 以行键集合跨页存活，
 *    工具栏计数与批量操作（onBulkAction 收到全部选中行）跨页累计；
 *    表头全选 checkbox 只作用于当前页；搜索/筛选使结果集缩小导致
 *    当前页越界时自动钳制回有效页。
 *
 * filterTags:
 *  - { key, label, predicate?(row): bool }
 *  - 不传 predicate 时默认匹配 row.status === key（key === 'all' 不过滤）
 */
export default function ListPage({
  title,
  subtitle,
  crumb,
  actions,
  filterTags,
  columns,
  data = [],
  loading = false,
  loadingText = '正在加载…',
  error = null,
  errorText = '加载失败，请稍后重试',
  onRetry,
  feedback = null,
  emptyText = '暂无数据',
  emptyIcon = '📭',
  emptyAction,
  rowKey = 'id',
  pageSize = 10,
  onRowClick,
  bulkActions = [
    { key: 'preview', label: '👁 预览', mode: 'single' },
    { key: 'edit', label: '✏ 修改', mode: 'single' },
    { key: 'history', label: '🕘 历史', mode: 'single' },
    { key: 'delete', label: '🗑 删除', mode: 'multi', danger: true },
  ],
  onBulkAction,
  kpiCards = null,
  sidebar = null,
}) {
  const [selected, setSelected] = useState(new Set())
  const [anchorId, setAnchorId] = useState(null)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [page, setPage] = useState(1)

  // ---------- filter + search ----------
  const filtered = useMemo(() => {
    let rows = data
    if (activeFilter !== 'all' && filterTags) {
      const tag = filterTags.find((t) => t.key === activeFilter)
      const pred = tag?.predicate ?? ((r) => r.status === activeFilter)
      rows = rows.filter(pred)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((r) =>
        columns.some((c) => {
          const v = c.getter ? c.getter(r) : r[c.key]
          return String(v).toLowerCase().includes(q)
        })
      )
    }
    return rows
  }, [data, search, columns, activeFilter, filterTags])

  // ---------- 分页（前端插批：去除 slice(0, 12) 硬截断） ----------
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  // 结果集缩小（搜索/筛选/外部删除）导致越界时钳制回有效页
  const currentPage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  )

  // ---------- selection (PB-R1 标准；跨页保留选中) ----------
  const handleRowClick = useCallback(
    (e, row, idx) => {
      // checkbox 自身的 onClick 已 stopPropagation，这里只处理 cell click
      const id = row[rowKey]
      // Shift 范围选择限当前页可见行
      const visibleIds = pageRows.map((r) => r[rowKey])

      if (e.shiftKey && anchorId !== null && visibleIds.includes(anchorId)) {
        const a = visibleIds.indexOf(anchorId)
        const b = idx
        const [s, t] = a <= b ? [a, b] : [b, a]
        const next = new Set()
        for (let i = s; i <= t; i++) next.add(visibleIds[i])
        setSelected(next)
      } else if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        setAnchorId(id)
      } else {
        setSelected(new Set([id]))
        setAnchorId(id)
      }
    },
    [pageRows, anchorId, rowKey]
  )

  const toggleOne = useCallback(
    (id) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setAnchorId(id)
    },
    []
  )

  const selectAll = (checked) => {
    // 全选只作用于当前页；跨页已选不受影响
    setSelected((prev) => {
      const next = new Set(prev)
      pageRows.forEach((r) => {
        if (checked) next.add(r[rowKey])
        else next.delete(r[rowKey])
      })
      return next
    })
    setAnchorId(checked && pageRows.length ? pageRows[0][rowKey] : null)
  }

  const clearSelection = () => {
    setSelected(new Set())
    setAnchorId(null)
  }

  // ---------- bulk action handler ----------
  const triggerBulk = (action) => {
    if (onBulkAction) {
      // 跨页选择保留：批量操作覆盖全部选中行，不限当前页
      const rows = filtered.filter((r) => selected.has(r[rowKey]))
      onBulkAction(action.key, rows)
    } else {
      alert(`Phase A · 静态 mock · 操作 [${action.label}] · 选中 ${selected.size} 条`)
    }
  }

  const selCount = selected.size
  const showFloat = selCount > 0
  const rangeStart = filtered.length ? (currentPage - 1) * pageSize + 1 : 0
  const rangeEnd = Math.min(currentPage * pageSize, filtered.length)

  return (
    <PageShell crumb={crumb} title={title} subtitle={subtitle} actions={actions}>
      <div className={sidebar ? 'home-grid' : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* KPI Cards — 取数未完成或失败时不出：卡上每个数字都是 rows 的汇总，
          这时候的 0 与无条件亮的绿点都是在把「不知道」说成「没有」。 */}
      {!loading && !error && kpiCards && kpiCards.length > 0 && (
        <div className="home-kpi">
          {kpiCards.map((k, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 26, height: 26, borderRadius: 6, background: k.icBg || 'var(--brand-soft)', color: k.icCo || 'var(--brand-ink)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{k.ic}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{k.lb}</span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', marginLeft: 'auto' }} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1.05, marginBottom: 4 }}>{k.num}</div>
              <div style={{ height: 4, borderRadius: 999, background: 'var(--bg-soft)', marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${k.pct ?? 0}%`, borderRadius: 999, background: k.barColor || 'var(--brand)', transition: 'width .4s ease' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4 }}>{k.sub || '加载中...'}</div>
            </div>
          ))}
        </div>
      )}

      {/* toolbar — 单行：左 sel-count + bulk actions / 右 filter + search */}
      <div
        className="toolbar-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 14px',
          background: 'var(--bg-soft)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: selCount > 0 ? 'var(--brand-ink)' : 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            fontWeight: 700,
            padding: '0 4px',
            cursor: selCount > 0 ? 'pointer' : 'default',
          }}
          onClick={selCount > 0 ? clearSelection : undefined}
          title={selCount > 0 ? '清除选中' : undefined}
        >
          已选 {selCount}
        </span>

        {/* bulk actions（始终展示，未选时禁用 = 决策 B 修订） */}
        <div style={{ display: 'flex', gap: 4, paddingRight: 12, borderRight: '1px solid var(--line)' }}>
          {bulkActions.map((act) => {
            const enabled =
              act.mode === 'multi' ? selCount > 0 : selCount === 1
            return (
              <button type="button"
                key={act.key}
                onClick={() => enabled && triggerBulk(act)}
                disabled={!enabled}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: act.danger ? 'var(--err)' : 'var(--ink-2)',
                  background: 'transparent',
                  border: 'none',
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  opacity: enabled ? 1 : 0.5,
                  fontFamily: 'inherit',
                }}
              >
                {act.label}
              </button>
            )
          })}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {filterTags?.map((tag) => (
            <button type="button"
              key={tag.key}
              aria-pressed={activeFilter === tag.key}
              onClick={() => setActiveFilter(tag.key)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                border: 0,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: activeFilter === tag.key ? 'var(--brand)' : 'var(--surface, #fff)',
                color: activeFilter === tag.key ? '#fff' : 'var(--ink-2)',
                boxShadow: activeFilter === tag.key ? 'none' : 'inset 0 0 0 1px var(--line)',
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
              width: 200,
              outline: 'none',
              background: '#fff',
            }}
          />
        </div>
      </div>

      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '10px 12px',
            marginBottom: 12,
            borderRadius: 'var(--r-md)',
            background: 'var(--info-soft)',
            color: 'var(--info)',
            fontSize: 12,
          }}
        >
          {loadingText}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 12px',
            marginBottom: 12,
            border: '1px solid var(--err)',
            borderRadius: 'var(--r-md)',
            background: 'var(--err-soft)',
            color: 'var(--err)',
            fontSize: 12,
          }}
        >
          <span>{errorText}</span>
          {onRetry && (
            <button type="button" className="btn btn-out" onClick={onRetry}>
              重试
            </button>
          )}
        </div>
      )}

      {feedback?.message && (
        <div
          role={feedback.role || 'status'}
          aria-live={feedback.role === 'alert' ? 'assertive' : 'polite'}
          style={{
            padding: '10px 12px',
            marginBottom: 12,
            borderRadius: 'var(--r-md)',
            background: feedback.role === 'alert' ? 'var(--err-soft)' : 'var(--info-soft)',
            color: feedback.role === 'alert' ? 'var(--err)' : 'var(--info)',
            fontSize: 12,
          }}
        >
          {feedback.message}
        </div>
      )}

      {/* table */}
      {!loading && !error && filtered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            color: 'var(--ink-3)',
            border: '2px dashed var(--line)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--surface, #fff)',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>{emptyIcon}</div>
          <div style={{ fontSize: 13, marginBottom: emptyAction ? 12 : 0 }}>{emptyText}</div>
          {emptyAction}
        </div>
      ) : filtered.length > 0 ? (
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
                    aria-label="选择当前结果"
                    checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r[rowKey]))}
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
              {pageRows.map((row, idx) => {
                const isSel = selected.has(row[rowKey])
                return (
                  <tr
                    key={row[rowKey] ?? idx}
                    onClick={(e) => handleRowClick(e, row, idx)}
                    onDoubleClick={() => onRowClick?.(row)}
                    style={{
                      cursor: 'pointer',
                      background: isSel ? 'var(--brand-soft)' : 'transparent',
                      userSelect: 'none',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px',
                        borderTop: idx > 0 ? '1px solid var(--line)' : 0,
                        textAlign: 'center',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择 ${row[rowKey]}`}
                        checked={isSel}
                        onChange={() => toggleOne(row[rowKey])}
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
      ) : null}

      {/* pager — 前端插批：真实分页控件，始终显示总数 */}
      {!loading && !error && <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'space-between',
          paddingTop: 10,
          fontSize: 12,
          color: 'var(--ink-3)',
        }}
      >
        <span>
          共 {data.length} 条{filtered.length < data.length && `（筛选后 ${filtered.length} 条）`} · 显示 {rangeStart}-{rangeEnd}{showFloat && ` · 已选 ${selCount}`}
        </span>
        {filtered.length > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalPages > 1 && <button
            type="button"
            aria-label="上一页"
            className="btn btn-ghost"
            style={{ height: 26, padding: '0 8px', fontSize: 12 }}
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >‹</button>}
          <span>{currentPage} / {totalPages}</span>
          {totalPages > 1 && <button
            type="button"
            aria-label="下一页"
            className="btn btn-ghost"
            style={{ height: 26, padding: '0 8px', fontSize: 12 }}
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >›</button>}
        </span>}
      </div>}
      </div>

      {/* Sidebar */}
      {sidebar && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {sidebar}
        </div>
      )}
      </div>
    </PageShell>
  )
}
