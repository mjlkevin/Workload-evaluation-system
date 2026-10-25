import { useCallback, useEffect, useRef, useState } from 'react'
import { useAdminAiSessions } from '../../hooks/useAdminAiSessions.js'
import { businessRoleLabel } from '../../hooks/useUsers.js'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemTextButton } from './SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from './SystemObjectDialog.jsx'

const DOMAIN_OPTIONS = [
  { value: 'business_evaluation', label: '业务评估' },
  { value: 'standard_governance', label: '标准治理' },
]
const STATUS_OPTIONS = [
  { value: 'temporary_chat', label: '临时对话' },
  { value: 'rough_estimate', label: '粗估' },
  { value: 'project_discovery', label: '项目摸底' },
  { value: 'requirement_drafting', label: '需求起草' },
  { value: 'assessment_drafting', label: '评估起草' },
  { value: 'standard_review', label: '标准评审', tone: 'warn' },
  { value: 'standard_drafting', label: '标准起草' },
  { value: 'linked_record', label: '已关联记录', tone: 'ok' },
  { value: 'archived', label: '已归档' },
]
const DEFAULT_FILTERS = { q: '', status: '', domain: '', from: '', to: '' }
const statusMeta = (value) => STATUS_OPTIONS.find((item) => item.value === value) || { label: value || '未知' }
const domainLabel = (value) => DOMAIN_OPTIONS.find((item) => item.value === value)?.label || value || '—'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function AiSessionAuditPanel() {
  const { sessions, loading, error, loadAllSessions, invalidateSessions } = useAdminAiSessions()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [selected, setSelected] = useState(null)
  const debounceRef = useRef(null)
  const firstLoad = useRef(true)
  const searchRef = useRef(null)

  const refresh = useCallback((nextFilters) => {
    clearTimeout(debounceRef.current)
    loadAllSessions(nextFilters)
  }, [loadAllSessions])

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false
      refresh(filters)
    } else {
      debounceRef.current = setTimeout(() => refresh(filters), 250)
    }
    return () => clearTimeout(debounceRef.current)
  }, [filters, refresh])

  const changeFilters = (nextFilters) => {
    invalidateSessions()
    setSelected(null)
    setFilters(nextFilters)
  }
  const updateFilter = (key, value) => changeFilters({ ...filters, [key]: value })
  const isFiltered = Object.values(filters).some(Boolean)
  const columns = [
    { key: 'title', label: '标题', render: (row) => <div className="min-w-0"><div className="max-w-52 truncate font-medium" title={row.title}>{row.title || '未命名会话'}</div><div className="text-xs text-ink-2">{domainLabel(row.domain)}</div></div> },
    { key: 'ownerUsername', label: '用户', hideBelow: 'md', render: (row) => <div className="max-w-36 truncate" title={row.ownerUsername}>{row.ownerUsername || '—'}</div> },
    { key: 'status', label: '状态', render: (row) => <SystemBadge tone={statusMeta(row.status).tone}>{statusMeta(row.status).label}</SystemBadge> },
    { key: 'turnCount', label: '轮次', hideBelow: 'md', className: 'tabular-nums' },
    { key: 'updatedAt', label: '最后活动', hideBelow: 'lg', className: 'whitespace-nowrap tabular-nums', render: (row) => formatDateTime(row.updatedAt) },
    { key: 'action', label: '操作', className: 'w-px whitespace-nowrap', render: (row) => <button type="button" className={systemTextButton} aria-label={`查看${row.title || '未命名会话'}`} onClick={() => setSelected(row)}>查看</button> },
  ]

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-xs leading-6 text-ink-2">{loading ? '正在读取 AI 会话' : error ? 'AI 会话读取失败' : `已加载 ${sessions.length} 条 AI 会话`} · 跨用户审计 · 每次最多返回 200 条</p>
      <button type="button" className={systemButton} onClick={() => refresh(filters)} disabled={loading}>刷新</button>
    </div>
    <div role="search" aria-label="会话审计筛选" className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="min-w-0 space-y-1 text-xs font-medium text-ink-2">搜索会话<input ref={searchRef} type="search" className={systemInput} placeholder="用户名 / 标题 / 会话ID" aria-label="会话搜索" value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-xs font-medium text-ink-2">状态<select className={systemInput} aria-label="会话状态" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">全部</option>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="min-w-0 space-y-1 text-xs font-medium text-ink-2">领域<select className={systemInput} aria-label="会话领域" value={filters.domain} onChange={(event) => updateFilter('domain', event.target.value)}><option value="">全部</option>{DOMAIN_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="min-w-0 space-y-1 text-xs font-medium text-ink-2">最后活动起始日期<input type="date" className={systemInput} value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-xs font-medium text-ink-2">最后活动结束日期<input type="date" className={systemInput} value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></label>
      <button type="button" className={`${systemButton} justify-self-start`} disabled={!isFiltered} onClick={() => changeFilters(DEFAULT_FILTERS)}>重置</button>
    </div>
    <SystemObjectList key={JSON.stringify(filters)} title="已加载会话" showSearch={false} rowKey="sessionId" rows={sessions} columns={columns} loading={loading} error={error} onRetry={() => refresh(filters)} emptyText={isFiltered ? '没有符合筛选条件的会话' : '暂无 AI 会话记录'} />
    <SystemObjectDialog open={Boolean(selected)} title="会话详情" description="只读审计摘要；首轮输入与最终输出为接口返回的截断摘要。" onClose={() => setSelected(null)} fallbackFocusRef={searchRef}>
      {selected && <div className="space-y-6">
        <SystemObjectFacts items={[
          { label: '标题', value: selected.title || '未命名会话' },
          { label: '会话ID', value: selected.sessionId },
          { label: '用户', value: selected.ownerUsername },
          { label: '用户ID', value: selected.ownerUserId },
          { label: '业务角色', value: businessRoleLabel(selected.businessRole) },
          { label: '角色标识', value: selected.businessRole || '—' },
          { label: '领域', value: `${domainLabel(selected.domain)} (${selected.domain || '—'})` },
          { label: '工作流', value: selected.workflowKey },
          { label: '状态', value: `${statusMeta(selected.status).label} (${selected.status || '—'})` },
          { label: '轮次', value: selected.turnCount },
          { label: '消息数', value: selected.messageCount },
          { label: '附件数', value: selected.attachmentCount },
          { label: '产物数', value: selected.artifactCount },
          { label: '创建时间', value: selected.createdAt },
          { label: '最后活动', value: selected.updatedAt },
        ]} />
        {[['首轮输入', selected.firstUserMessage], ['最终输出', selected.lastAssistantMessage]].map(([label, value]) => <section key={label} className="min-w-0"><h3 className="m-0 mb-2 text-sm font-semibold text-ink">{label}</h3><p className="m-0 whitespace-pre-wrap rounded-md bg-bg-soft p-3 text-sm leading-6 text-ink wrap-anywhere">{value || '—'}</p></section>)}
      </div>}
    </SystemObjectDialog>
  </div>
}
