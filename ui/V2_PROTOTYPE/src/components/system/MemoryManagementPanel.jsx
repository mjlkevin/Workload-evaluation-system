import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../../api/client.js'
import { useToast } from '../../hooks/useToast.jsx'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from './SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from './SystemObjectDialog.jsx'

const STATUS_MAP = {
  draft: { label: '待确认', tone: 'warn' },
  active: { label: '已生效', tone: 'ok' },
  archived: { label: '已归档', tone: 'neutral' },
}
const PAGE_SIZE = 50
const EMPTY = { atoms: [], scenes: [], totalAtoms: null, totalScenes: null, page: 0, hasMore: false }
const TYPE_FILTERS = [
  { value: 'atom', label: '原子事实', matches: (row) => row.kind === 'atom' },
  { value: 'scene', label: '场景块', matches: (row) => row.kind === 'scene' },
]
const titleOf = (item, kind) => kind === 'atom' ? item.factKey : item.sceneTitle
const totalOf = (value) => Number.isInteger(value) && value >= 0 ? value : null
const mergeItems = (previous, incoming, idKey) => [...new Map([...previous, ...incoming].map((item) => [item[idKey], item])).values()]

export default function MemoryManagementPanel() {
  const [memory, setMemory] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const requestVersion = useRef(0)
  const busyRef = useRef(false)
  const searchInputRef = useRef(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedStatus = searchParams.get('status')
  const filter = Object.hasOwn(STATUS_MAP, requestedStatus) ? requestedStatus : 'all'
  const projectId = searchParams.get('projectId') || undefined
  const toast = useToast()

  const fetchMemory = useCallback(async (page = 1) => {
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get('/memory', { projectId, status: filter === 'all' ? undefined : filter, page, pageSize: PAGE_SIZE })
      if (version !== requestVersion.current) return
      const data = res?.data || {}
      const atoms = data.atoms || []
      const scenes = data.scenes || []
      const totalAtoms = totalOf(data.totalAtoms)
      const totalScenes = totalOf(data.totalScenes)
      // Each collection has its own LIMIT/OFFSET, sharing the requested page.
      const hasMore = (totalAtoms === null ? atoms.length === PAGE_SIZE : page * PAGE_SIZE < totalAtoms)
        || (totalScenes === null ? scenes.length === PAGE_SIZE : page * PAGE_SIZE < totalScenes)
      setMemory((previous) => ({
        atoms: page === 1 ? atoms : mergeItems(previous.atoms, atoms, 'memoryAtomId'),
        scenes: page === 1 ? scenes : mergeItems(previous.scenes, scenes, 'memorySceneId'),
        totalAtoms, totalScenes, page, hasMore,
      }))
    } catch (err) {
      if (version !== requestVersion.current) return
      setMemory(EMPTY)
      setError(err?.message || '记忆数据加载失败')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [filter, projectId])

  useEffect(() => {
    setSelected(null)
    setActionError('')
    setMemory(EMPTY)
    fetchMemory()
    return () => { requestVersion.current++ }
  }, [fetchMemory])

  const handleAction = async (action) => {
    if (busyRef.current || !selected) return
    busyRef.current = true
    setBusy(true)
    setActionError('')
    const version = requestVersion.current
    const { kind, item } = selected
    const id = kind === 'atom' ? item.memoryAtomId : item.memorySceneId
    try {
      await apiClient.post(`/memory/${kind === 'atom' ? 'atoms' : 'scenes'}/${action}`, { memoryIds: [id] })
      if (version !== requestVersion.current) return
      toast.success(action === 'confirm' ? '已确认生效' : '已归档')
      setSelected(null)
      await fetchMemory()
    } catch (err) {
      if (version === requestVersion.current) setActionError(err?.message || (action === 'confirm' ? '确认失败' : '归档失败'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const rows = [
    ...memory.scenes.map((item) => ({ id: `scene:${item.memorySceneId}`, kind: 'scene', title: titleOf(item, 'scene'), summary: item.sceneSummary, item })),
    ...memory.atoms.map((item) => ({ id: `atom:${item.memoryAtomId}`, kind: 'atom', title: titleOf(item, 'atom'), summary: item.factText, item })),
  ]
  const columns = [
    { key: 'title', label: '记忆', className: 'min-w-48', render: (row) => <div className="max-w-xl"><div className="font-medium wrap-anywhere">{row.title}</div><div className="mt-1 line-clamp-2 text-xs leading-5 text-ink-2 wrap-anywhere">{row.summary}</div></div> },
    { key: 'kind', label: '类型', className: 'whitespace-nowrap', render: (row) => <SystemBadge tone={row.kind === 'scene' ? 'brand' : 'neutral'}>{row.kind === 'scene' ? '场景块' : '原子事实'}</SystemBadge> },
    { key: 'status', label: '状态', className: 'whitespace-nowrap', render: (row) => <SystemBadge tone={STATUS_MAP[row.item.status]?.tone}>{STATUS_MAP[row.item.status]?.label || row.item.status || '未知'}</SystemBadge> },
    { key: 'actions', label: '操作', className: 'w-20 whitespace-nowrap', render: (row) => <button type="button" className={systemTextButton} aria-label={`查看${row.title}`} onClick={() => { setActionError(''); setSelected(row) }}>查看</button> },
  ]
  const selectedTitle = selected?.title || ''
  const item = selected?.item
  const knownTotal = memory.totalAtoms !== null && memory.totalScenes !== null
  const facts = item ? [
    { label: '类型', value: selected.kind === 'scene' ? '场景块' : '原子事实' },
    { label: '状态', value: STATUS_MAP[item.status]?.label || item.status },
    { label: '记忆 ID', value: selected.kind === 'scene' ? item.memorySceneId : item.memoryAtomId },
    ...(selected.kind === 'atom' ? [{ label: '置信度', value: item.confidence == null ? '—' : `${item.confidence}%` }] : []),
    ...[['projectId', '项目 ID'], ['ownerUserId', '所属用户 ID'], ['sourceType', '来源'], ['harnessRunId', '来源运行 ID'], ['createdAt', '创建时间'], ['updatedAt', '更新时间'], ['confirmedAt', '确认时间'], ['archivedAt', '归档时间']].filter(([key]) => item[key] != null).map(([key, label]) => ({ label, value: item[key] })),
  ] : []

  return (
    <div className="min-w-0 space-y-3">
      {!loading && !error && <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-6 text-ink-2" aria-live="polite">
        <div><span>{knownTotal ? `已加载 ${rows.length} / ${memory.totalAtoms + memory.totalScenes} 条记忆` : `已加载 ${rows.length} 条记忆（总数暂不可用）`}</span><span> · {memory.atoms.length} 条原子事实 · {memory.scenes.length} 个场景块</span></div>
        {memory.hasMore && <span>搜索和类型筛选仅覆盖已加载记忆</span>}
      </div>}
      <SystemObjectList title="已加载记忆" rows={rows} columns={columns} filters={TYPE_FILTERS} filterAllLabel="全部类型" searchInputRef={searchInputRef} searchText={(row) => `${row.title} ${row.summary} ${row.item.projectId || ''} ${row.item.memoryAtomId || row.item.memorySceneId}`} loading={loading} error={error} onRetry={() => fetchMemory()} emptyText="暂无记忆数据" actions={<>
        <select aria-label="记忆状态" className={`${systemInput.replace('w-full', 'w-auto')} shrink-0`} value={filter} disabled={busy || loading} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value === 'all') next.delete('status'); else next.set('status', event.target.value); setSearchParams(next, { replace: true }) }}>
          <option value="all">全部状态</option>{Object.entries(STATUS_MAP).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
        </select>
        <button type="button" className={systemButton} onClick={() => fetchMemory()} disabled={loading || busy}>{loading ? '刷新中…' : '刷新'}</button>
      </>} />
      {!error && memory.hasMore && <div className="flex justify-start pr-24"><button type="button" className={systemButton} disabled={loading || busy} onClick={() => fetchMemory(memory.page + 1)}>{loading ? '加载中…' : '加载更多记忆'}</button></div>}
      <SystemObjectDialog open={!!selected} title={`记忆详情：${selectedTitle}`} description="查看完整记忆后，可确认生效或归档当前记忆。" busy={busy} fallbackFocusRef={searchInputRef} onClose={() => setSelected(null)} footer={(close) => <>
        <button type="button" className={systemButton} disabled={busy} onClick={close}>关闭</button>
        {item?.status !== 'archived' && <button type="button" className={`${systemButton} text-err-ink`} disabled={busy} aria-label={`归档：${selectedTitle}`} onClick={() => handleAction('archive')}>{busy ? '处理中…' : '归档'}</button>}
        {item?.status === 'draft' && <button type="button" className={systemPrimaryButton} disabled={busy} aria-label={`确认生效：${selectedTitle}`} onClick={() => handleAction('confirm')}>{busy ? '处理中…' : '确认生效'}</button>}
      </>}>
        {item && <div className="min-w-0 space-y-5">
          <div className="rounded-md bg-bg-soft p-4 text-sm leading-6 whitespace-pre-wrap wrap-anywhere">{selected.summary}</div>
          <SystemObjectFacts items={facts} />
          {selected.kind === 'scene' && <section><h3 className="mb-2 text-sm font-semibold text-ink">关联原子 · {(item.atomIds || []).length} 条</h3>{item.atomIds?.length ? <ul className="m-0 space-y-2 pl-5 text-sm leading-6 text-ink wrap-anywhere">{item.atomIds.map((id) => { const atom = memory.atoms.find((entry) => entry.memoryAtomId === id); return <li key={id}><span className="font-mono text-xs">{id}</span>{atom && <div><div className="font-medium">{atom.factKey}</div><div className="whitespace-pre-wrap">{atom.factText}</div></div>}</li> })}</ul> : <p className="m-0 text-sm text-ink-2">无关联原子</p>}</section>}
          {item.metadata && Object.keys(item.metadata).length > 0 && <section><h3 className="mb-2 text-sm font-semibold text-ink">附加信息</h3><pre className="m-0 rounded-md bg-bg-soft p-3 font-mono text-xs leading-6 text-ink whitespace-pre-wrap wrap-anywhere">{JSON.stringify(item.metadata, null, 2)}</pre></section>}
          {actionError && <div role="alert" className="rounded-md bg-err-soft p-3 text-sm leading-6 text-err-ink">{actionError}</div>}
        </div>}
      </SystemObjectDialog>
    </div>
  )
}
