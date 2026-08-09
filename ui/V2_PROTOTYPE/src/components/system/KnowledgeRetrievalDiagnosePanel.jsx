import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../api/client.js'
import { unwrapSingle } from '../../api/utils.js'

// SP-2026-007 · MS1：本地知识库中文检索基线（BM25 + RRF + 三重护栏）诊断入口
// 仅 ADMIN 可见（/system/* 由 ProtectedLayout 全局拦截，后端 system:manage 二次校验）

const STAGE_LABELS = {
  'ms1-bm25-rrf': 'MS1 · BM25 基线',
}

function truncateText(text, max = 80) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function GuardMeta({ guard, durationMs }) {
  if (!guard) return null
  const truncatedLabel = guard.truncatedBy === 'maxItems'
    ? '条目数超限截断'
    : guard.truncatedBy === 'charBudget'
      ? '字符预算截断'
      : '未触发截断'
  return (
    <span className="meta" style={{ marginLeft: 12 }}>
      耗时 {durationMs ?? '—'}ms · {truncatedLabel} · 丢弃 {guard.droppedCount ?? 0} 条 · 输出 {guard.totalChars ?? 0} 字符
    </span>
  )
}

function ResultTable({ result }) {
  if (!result) return null
  if (!result.items || result.items.length === 0) {
    return <div className="sys-empty">未检索到相关条目</div>
  }
  return (
    <div className="sys-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>标题</th>
            <th>分类</th>
            <th className="num">分数</th>
            <th>来源</th>
            <th>内容摘要</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map(({ entry, score, source }) => (
            <tr key={entry.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{entry.title}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{entry.id}</div>
              </td>
              <td>{entry.category || '—'}</td>
              <td className="num mono">{typeof score === 'number' ? score.toFixed(3) : '—'}</td>
              <td><span className="tag acc">{source === 'bm25' ? 'BM25' : source}</span></td>
              <td><span className="sys-cell-clip" title={entry.content}>{truncateText(entry.content)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function KnowledgeRetrievalDiagnosePanel() {
  const [diagnose, setDiagnose] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const loadDiagnose = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await apiClient.get('/knowledge/diagnose')
      setDiagnose(unwrapSingle(payload))
    } catch (err) {
      setError(err?.message || '诊断接口调用失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDiagnose()
  }, [loadDiagnose])

  const runSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError('')
    try {
      const payload = await apiClient.get('/knowledge/search', { q, limit: 5 })
      setSearchResult(unwrapSingle(payload))
    } catch (err) {
      setSearchError(err?.message || '检索失败')
      setSearchResult(null)
    } finally {
      setSearching(false)
    }
  }, [query])

  const corpus = diagnose?.corpus
  const guard = diagnose?.guard
  const stageLabel = STAGE_LABELS[diagnose?.stage] || diagnose?.stage || '—'

  return (
    <div>
      <div className="sys-toolbar">
        <span className="meta">
          {loading ? '加载中...' : error
            ? `诊断加载失败：${error}`
            : `语料 ${corpus?.total ?? 0} 条（生效 ${corpus?.active ?? 0} · 归档 ${corpus?.archived ?? 0}） · 阶段：${stageLabel}`}
        </span>
        <button type="button" className="btn btn-out btn-sm" onClick={loadDiagnose} disabled={loading}>
          ↻ 刷新
        </button>
      </div>

      {guard && (
        <div className="sys-toolbar" style={{ borderTop: 0 }}>
          <span className="meta">
            预算护栏：最多 {guard.maxItems} 条 · 字符预算 {guard.charBudget} · 超时 {guard.timeoutMs}ms（超限截断并留痕）
          </span>
        </div>
      )}

      <div className="sys-filters" role="search" aria-label="知识库检索试查">
        <input
          className="input sys-filters__q"
          placeholder="输入中文术语试查，如：售前估算 / 人天口径"
          aria-label="检索关键词"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') runSearch()
          }}
        />
        <button type="button" className="btn btn-out btn-sm" onClick={runSearch} disabled={searching || !query.trim()}>
          {searching ? '检索中...' : '检索'}
        </button>
      </div>

      {searchError ? (
        <div className="sys-empty">{searchError}</div>
      ) : searchResult ? (
        <>
          <div className="sys-toolbar" style={{ borderTop: 0 }}>
            <span className="meta">
              查询「{searchResult.query}」· 命中 {searchResult.items?.length ?? 0} 条
              · 分词：{(searchResult.tokens || []).join(' / ') || '—'}
            </span>
            <GuardMeta guard={searchResult.guard} durationMs={searchResult.durationMs} />
          </div>
          <ResultTable result={searchResult} />
        </>
      ) : diagnose?.sample ? (
        <>
          <div className="sys-toolbar" style={{ borderTop: 0 }}>
            <span className="meta">样例查询「{diagnose.sample.query}」· 命中 {diagnose.sample.items?.length ?? 0} 条</span>
            <GuardMeta guard={diagnose.sample.guard} durationMs={diagnose.sample.durationMs} />
          </div>
          <ResultTable result={diagnose.sample} />
        </>
      ) : (
        !loading && !error && <div className="sys-empty">暂无诊断数据</div>
      )}
    </div>
  )
}
