import { useMemo, useState } from 'react'

export const systemButton = 'inline-flex h-9 shrink-0 appearance-none items-center justify-center gap-2 rounded-md border border-solid border-line-2 bg-surface px-3 font-sans text-sm font-medium leading-5 text-ink-2 cursor-pointer hover:bg-bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
export const systemPrimaryButton = `${systemButton.replace('border-line-2 bg-surface', 'border-brand bg-brand').replace('text-ink-2', 'text-white').replace('hover:bg-bg-soft', 'hover:bg-brand-ink')}`
export const systemTextButton = 'inline-flex h-8 shrink-0 appearance-none items-center justify-center rounded-sm border-0 bg-transparent px-2 font-sans text-xs font-medium leading-5 text-brand-ink cursor-pointer hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
export const systemInput = 'h-9 min-w-0 w-full appearance-none rounded-md border border-solid border-line-2 bg-surface px-3 font-sans text-sm leading-5 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:bg-bg-soft disabled:text-ink-2'

export function SystemBadge({ children, tone = 'neutral', title }) {
  const tones = { neutral: 'bg-bg-soft text-ink-2', brand: 'bg-brand-soft text-brand-ink', ok: 'bg-ok-soft text-ok-ink', warn: 'bg-warn-soft text-warn-ink' }
  return <span title={title} className={`inline-flex max-w-full items-center rounded-sm px-2 py-0.5 text-xs font-medium leading-5 ${tones[tone] || tones.neutral}`}>{children}</span>
}

const visibility = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }

/** Embedded system list. Pagination follows ListPage's 10-row/clamped-page contract. */
export default function SystemObjectList({ title, tableLabel = `${title}列表`, showSearch = true, rows, columns, rowKey = 'id', searchText = (row) => Object.values(row).join(' '), filters = [], filterAllLabel = '全部状态', loading = false, error, onRetry, searchInputRef, emptyText = `暂无${title}`, actions }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => {
    const option = filters.find((entry) => entry.value === filter)
    const keyword = query.trim().toLowerCase()
    return rows.filter((row) => (!option || option.matches(row)) && (!keyword || searchText(row).toLowerCase().includes(keyword)))
  }, [rows, filters, filter, query, searchText])
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * 10, current * 10)
  const reset = () => { setQuery(''); setFilter('all'); setPage(1) }
  const filteredActive = query.trim() !== '' || filter !== 'all'

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {showSearch && <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-solid border-line-2 bg-surface px-3 text-ink-2 focus-within:outline-2 focus-within:outline-brand">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input ref={searchInputRef} type="search" aria-label={`搜索${title}`} placeholder={`搜索${title}…`} className="h-full min-w-0 w-full appearance-none border-0 bg-transparent p-0 font-sans text-sm leading-5 text-ink outline-none placeholder:text-ink-2" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
        </div>}
        {filters.length > 0 && <select aria-label={`筛选${title}`} className={`${systemInput.replace('w-full', 'w-auto')} shrink-0`} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="all">{filterAllLabel}</option>{filters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
        {filteredActive && <button type="button" className={systemTextButton} onClick={reset}>重置筛选</button>}
        {actions}
      </div>
      {loading ? <div role="status" className="rounded-lg border border-solid border-line bg-surface p-8 text-center text-sm text-ink-2">正在加载{title}…</div> : error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-solid border-err/30 bg-err-soft p-4 text-sm text-err-ink"><span>{error}</span>{onRetry && <button type="button" className={systemButton} onClick={onRetry}>重试</button>}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface px-4 py-10 text-center text-sm leading-6 text-ink-2">{filteredActive ? `没有匹配的${title}` : emptyText}</div>
      ) : (
        <div role="region" aria-label={`${title}列表滚动区域`} tabIndex={0} className="min-w-0 overflow-x-auto rounded-lg border border-solid border-line bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <table aria-label={tableLabel} className="w-full border-collapse text-left">
            <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={`h-10 border-0 border-b border-solid border-line bg-bg-soft px-4 text-xs font-semibold leading-5 text-ink-2 ${visibility[column.hideBelow] || ''} ${column.className || ''}`}>{column.label}</th>)}</tr></thead>
            <tbody>{visible.map((row) => <tr key={row[rowKey]} className="hover:bg-bg-soft">{columns.map((column) => <td key={column.key} className={`border-0 border-b border-solid border-line px-4 py-2 align-middle text-sm leading-5 text-ink ${visibility[column.hideBelow] || ''} ${column.className || ''}`}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {!loading && !error && <div className="flex flex-wrap items-center justify-between gap-3 pr-24 text-xs leading-6 tabular-nums text-ink-2" aria-live="polite">
        <span>共 {rows.length} 条{filteredActive && `（筛选后 ${filtered.length} 条）`} · 显示 {filtered.length ? (current - 1) * 10 + 1 : 0}-{Math.min(current * 10, filtered.length)}</span>
        {filtered.length > 0 && <nav aria-label={`${title}分页`} className="flex items-center gap-2"><button type="button" aria-label="上一页" className={systemTextButton} disabled={current <= 1} onClick={() => setPage(current - 1)}>上一页</button><span>{current} / {pages}</span><button type="button" aria-label="下一页" className={systemTextButton} disabled={current >= pages} onClick={() => setPage(current + 1)}>下一页</button></nav>}
      </div>}
    </div>
  )
}
