import { useCallback, useEffect, useRef, useState } from 'react'
import { useAdminAiSessions } from '../../hooks/useAdminAiSessions.js'
import { businessRoleLabel } from '../../hooks/useUsers.js'

const DOMAIN_OPTIONS = [
  { value: 'business_evaluation', label: '业务评估' },
  { value: 'standard_governance', label: '标准治理' },
]

const STATUS_OPTIONS = [
  { value: 'temporary_chat', label: '临时对话', cls: 'draft' },
  { value: 'rough_estimate', label: '粗估', cls: 'brd' },
  { value: 'project_discovery', label: '项目摸底', cls: 'brd' },
  { value: 'requirement_drafting', label: '需求起草', cls: 'brd' },
  { value: 'assessment_drafting', label: '评估起草', cls: 'brd' },
  { value: 'standard_review', label: '标准评审', cls: 'warn' },
  { value: 'standard_drafting', label: '标准起草', cls: 'brd' },
  { value: 'linked_record', label: '已关联记录', cls: 'ci' },
  { value: 'archived', label: '已归档', cls: 'muted' },
]

const DEFAULT_FILTERS = { q: '', status: '', domain: '', from: '', to: '' }

function statusMeta(status) {
  return STATUS_OPTIONS.find((item) => item.value === status) || { label: status || '未知', cls: 'draft' }
}

function domainLabel(domain) {
  return DOMAIN_OPTIONS.find((item) => item.value === domain)?.label || domain || '—'
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function AiSessionAuditPanel() {
  const { sessions, loading, error, loadAllSessions } = useAdminAiSessions()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const debounceRef = useRef(null)

  const refresh = useCallback((nextFilters) => {
    loadAllSessions(nextFilters)
  }, [loadAllSessions])

  // 首次挂载加载一次
  useEffect(() => {
    refresh(DEFAULT_FILTERS)
  }, [refresh])

  // 筛选变更 250ms 防抖后服务端拉取
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => refresh(filters), 250)
    return () => clearTimeout(debounceRef.current)
  }, [filters, refresh])

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const isFiltered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  return (
    <div>
      <div className="sys-toolbar">
        <span className="meta">共 {sessions.length} 条 AI 会话 · 全量用户审计视图{loading ? ' · 加载中...' : ''}</span>
        <button type="button" className="btn btn-out btn-sm" onClick={() => refresh(filters)} disabled={loading}>
          ↻ 刷新
        </button>
      </div>

      <div className="sys-filters" role="search" aria-label="会话审计筛选">
        <span className="sys-filters__lb">状态</span>
        <select
          className="input"
          aria-label="会话状态"
          value={filters.status}
          onChange={(event) => updateFilter('status', event.target.value)}
        >
          <option value="">全部</option>
          {STATUS_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <span className="sys-filters__lb">领域</span>
        <select
          className="input"
          aria-label="会话领域"
          value={filters.domain}
          onChange={(event) => updateFilter('domain', event.target.value)}
        >
          <option value="">全部</option>
          {DOMAIN_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <span className="sys-filters__lb">从</span>
        <input
          type="date"
          className="input"
          aria-label="最后活动起始日期"
          value={filters.from}
          onChange={(event) => updateFilter('from', event.target.value)}
        />
        <span className="sys-filters__lb">至</span>
        <input
          type="date"
          className="input"
          aria-label="最后活动结束日期"
          value={filters.to}
          onChange={(event) => updateFilter('to', event.target.value)}
        />
        <input
          className="input sys-filters__q"
          placeholder="搜索用户名 / 标题 / 会话ID"
          aria-label="会话搜索"
          value={filters.q}
          onChange={(event) => updateFilter('q', event.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!isFiltered}
          onClick={() => setFilters(DEFAULT_FILTERS)}
        >
          重置
        </button>
      </div>

      {error ? (
        <div className="sys-empty">{error}</div>
      ) : sessions.length === 0 && !loading ? (
        <div className="sys-empty">{isFiltered ? '没有符合筛选条件的会话' : '暂无 AI 会话记录'}</div>
      ) : (
        <div className="sys-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>用户</th>
                <th>领域 / 标题</th>
                <th>状态</th>
                <th className="num">轮次</th>
                <th>首轮输入</th>
                <th>最终输出</th>
                <th>创建时间</th>
                <th>最后活动</th>
                <th>会话ID</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const status = statusMeta(session.status)
                return (
                  <tr key={session.sessionId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{session.ownerUsername || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{businessRoleLabel(session.businessRole)}</div>
                    </td>
                    <td>
                      <span className="tag acc" style={{ marginRight: 6 }}>{domainLabel(session.domain)}</span>
                      <span className="sys-cell-clip" title={session.title}>{session.title || '—'}</span>
                    </td>
                    <td>
                      <span className={`bdg ${status.cls}`}>
                        <span className="dot" />
                        {status.label}
                      </span>
                    </td>
                    <td className="num">{session.turnCount}</td>
                    <td><span className="sys-cell-clip" title={session.firstUserMessage}>{session.firstUserMessage || '—'}</span></td>
                    <td><span className="sys-cell-clip" title={session.lastAssistantMessage}>{session.lastAssistantMessage || '—'}</span></td>
                    <td className="mono">{formatDateTime(session.createdAt)}</td>
                    <td className="mono">{formatDateTime(session.updatedAt)}</td>
                    <td>
                      <span className="mono sys-cell-clip" style={{ maxWidth: 120 }} title={session.sessionId}>
                        {session.sessionId ? session.sessionId.slice(0, 8) : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
