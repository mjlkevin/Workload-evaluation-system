import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../../api/client.js'
import { unwrapSingle } from '../../api/utils.js'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from './SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from './SystemObjectDialog.jsx'
const STAGE_LABELS = { 'ms1-bm25-rrf': 'MS1 · BM25 基线' }
function GuardMeta({ guard, durationMs }) {
  if (!guard) return null
  const label = guard.truncatedBy === 'maxItems' ? '条目数超限截断' : guard.truncatedBy === 'charBudget' ? '字符预算截断' : '未触发截断'
  return <span>耗时 {durationMs ?? '—'}ms · {label} · 丢弃 {guard.droppedCount ?? 0} 条 · 输出 {guard.totalChars ?? 0} 字符{guard.timedOut && ' · 已超时降级'}</span>
}
export default function KnowledgeRetrievalDiagnosePanel() {
  const [diagnose, setDiagnose] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selected, setSelected] = useState(null)
  const diagnoseSequence = useRef(0)
  const searchSequence = useRef(0)
  const searchBusy = useRef(false)
  const input = useRef(null)
  const loadDiagnose = useCallback(async () => {
    const sequence = ++diagnoseSequence.current
    setLoading(true); setError('')
    try {
      const payload = await apiClient.get('/knowledge/diagnose')
      if (sequence === diagnoseSequence.current) setDiagnose(unwrapSingle(payload))
    } catch (failure) {
      if (sequence === diagnoseSequence.current) setError(`诊断加载失败：${failure?.message || '请重试'}`)
    } finally { if (sequence === diagnoseSequence.current) setLoading(false) }
  }, [])
  useEffect(() => {
    loadDiagnose()
    return () => { diagnoseSequence.current += 1; searchSequence.current += 1 }
  }, [loadDiagnose])
  const editQuery = (value) => {
    searchSequence.current += 1; searchBusy.current = false
    setQuery(value); setSearchResult(null); setSearchError(''); setSearching(false); setSelected(null)
  }
  const runSearch = async () => {
    const value = query.trim()
    if (!value || searchBusy.current) return
    const sequence = ++searchSequence.current
    searchBusy.current = true; setSearching(true); setSearchError(''); setSelected(null)
    try {
      const payload = await apiClient.get('/knowledge/search', { q: value, limit: 5 })
      if (sequence === searchSequence.current) setSearchResult(unwrapSingle(payload))
    } catch (failure) {
      if (sequence === searchSequence.current) { setSearchError(`检索失败：${failure?.message || '请重试'}`); setSearchResult(null) }
    } finally { if (sequence === searchSequence.current) { searchBusy.current = false; setSearching(false) } }
  }
  const result = searchResult || (!query.trim() && !error && !loading ? diagnose?.sample : null)
  const rows = (result?.items || []).map((item) => ({ ...item, id: item.entry.id }))
  const corpus = diagnose?.corpus
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-6 text-ink-2">
      <span>{loading ? '正在加载诊断…' : error ? '诊断暂不可用' : `语料 ${corpus?.total ?? 0} 条（生效 ${corpus?.active ?? 0} · 归档 ${corpus?.archived ?? 0}） · 阶段：${STAGE_LABELS[diagnose?.stage] || diagnose?.stage || '—'}`}</span>
      <button type="button" className={systemButton} onClick={loadDiagnose} disabled={loading}>{loading ? '刷新中…' : '↻ 刷新'}</button>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-err-soft p-3 text-sm leading-6 text-err-ink"><span>{error}</span><button type="button" className={systemButton} onClick={loadDiagnose}>重试诊断</button></div>}
    {!error && !loading && diagnose?.guard && <p className="m-0 text-xs leading-6 text-ink-2">预算护栏：最多 {diagnose.guard.maxItems} 条 · 字符预算 {diagnose.guard.charBudget} · 超时 {diagnose.guard.timeoutMs}ms（超限截断并留痕）</p>}
    <div role="search" aria-label="知识库检索试查" className="flex flex-wrap items-center gap-3 rounded-lg border border-solid border-line bg-surface p-3">
      <input ref={input} className={`${systemInput} flex-1`} placeholder="输入中文术语试查，如：售前估算 / 人天口径" aria-label="检索关键词" value={query} onChange={(event) => editQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); runSearch() } }} />
      <button type="button" className={systemPrimaryButton} onClick={runSearch} disabled={searching || !query.trim()}>{searching ? '检索中...' : '检索'}</button>
      {query && <button type="button" className={systemTextButton} onClick={() => editQuery('')}>查看样例</button>}
    </div>
    {searchError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-err-soft p-3 text-sm leading-6 text-err-ink"><span>{searchError}</span><button type="button" className={systemButton} onClick={runSearch}>重试检索</button></div> : searching ? <div role="status" className="p-6 text-center text-sm text-ink-2">正在检索…</div> : result ? <div className="space-y-3">
      <div className="flex flex-wrap justify-between gap-3 text-xs leading-6 text-ink-2"><span>{searchResult ? '查询' : '样例查询'}「{result.query}」· 命中 {rows.length} 条 · 分词：{(result.tokens || []).join(' / ') || '—'}</span><GuardMeta guard={result.guard} durationMs={result.durationMs} /></div>
      <SystemObjectList title="检索结果" rows={rows} showSearch={false} emptyText="未检索到相关条目" columns={[
        { key: 'title', label: '标题', render: (row) => <div><span className="font-medium">{row.entry.title}</span><div className="max-w-64 truncate font-mono text-xs text-ink-2">{row.entry.id}</div></div> },
        { key: 'category', label: '分类', hideBelow: 'md', render: (row) => row.entry.category || '—' },
        { key: 'score', label: '分数', render: (row) => <span className="font-mono text-xs tabular-nums">{typeof row.score === 'number' ? row.score.toFixed(3) : '—'}</span> },
        { key: 'source', label: '来源', hideBelow: 'md', render: (row) => <SystemBadge tone="brand">{row.source === 'bm25' ? 'BM25' : row.source || '—'}</SystemBadge> },
        { key: 'content', label: '内容摘要', hideBelow: 'lg', render: (row) => <span className="block max-w-72 truncate text-xs text-ink-2">{row.entry.content}</span> },
        { key: 'actions', label: '操作', className: 'w-20 whitespace-nowrap', render: (row) => <button type="button" aria-label={`查看 ${row.entry.title}`} className={systemTextButton} onClick={() => setSelected(row)}>查看</button> },
      ]} />
    </div> : !loading && !error && <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-2">{query.trim() ? '输入关键词后按 Enter 或点击检索' : '暂无诊断数据'}</div>}
    <SystemObjectDialog open={Boolean(selected)} title="检索条目详情" description={selected?.entry.title} onClose={() => setSelected(null)} fallbackFocusRef={input}>
      {selected && <div className="space-y-5"><SystemObjectFacts items={[
        { label: '条目 ID', value: selected.entry.id }, { label: '分类', value: selected.entry.category }, { label: '状态', value: selected.entry.status }, { label: '来源', value: selected.source === 'bm25' ? 'BM25' : selected.source }, { label: '分数', value: String(selected.score ?? '—') }, { label: '标签', value: (selected.entry.tags || []).join(' · ') || '—' }, { label: '创建时间', value: selected.entry.createdAt }, { label: '更新时间', value: selected.entry.updatedAt },
      ]} /><div><h3 className="mb-2 mt-0 text-sm font-semibold text-ink">返回内容</h3><p className="m-0 whitespace-pre-wrap text-sm leading-7 text-ink wrap-anywhere">{selected.entry.content || '—'}</p></div></div>}
    </SystemObjectDialog>
  </div>
}
