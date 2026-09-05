import { useState } from 'react'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting'])
const VISIBLE_ROW_LIMIT = 2

function statusDotClassName(status) {
  if (status === 'completed') return 'bg-ok'
  if (status === 'failed' || status === 'cancelled') return 'bg-err'
  return 'bg-brand animate-pulse'
}

/**
 * 后台任务面板：取代原来"一行文字徽标 + 单条当前会话停止横条"。
 * 顶部计数摘要数据源与既有 runCounts 计算逻辑保持不变；
 * 新增的逐行列表只展示 backgroundRuns.runs 里处于活跃状态的任务，
 * 每行独立可停止；已完成/失败的 run 只体现在顶部计数里，不出现在行列表
 * （backgroundRuns.runs 不保证覆盖全部历史已完成任务，行级展示只对
 * 当前仍在追踪的活跃任务做承诺）。
 */
export default function BackgroundRunsPanel({ runs, runCounts, onStopRun }) {
  const [expanded, setExpanded] = useState(false)

  if (runCounts.active === 0 && runCounts.completed === 0) return null

  const activeRuns = Array.isArray(runs) ? runs.filter((run) => ACTIVE_STATUSES.has(run.status)) : []
  const visibleRuns = expanded ? activeRuns : activeRuns.slice(0, VISIBLE_ROW_LIMIT)
  const hiddenCount = activeRuns.length - visibleRuns.length

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-bg-2 px-3 py-1.5 text-xs text-ink-2">
      <span role="status">{`后台任务 进行中 ${runCounts.active} · 已完成 ${runCounts.completed}`}</span>
      {visibleRuns.map((run, idx) => (
        <div
          key={run.runId}
          className={`flex items-center gap-2 ${idx === 0 ? '' : 'border-t border-line pt-1.5'}`}
        >
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${statusDotClassName(run.status)}`} />
          <span className="min-w-0 flex-1 truncate">{run.title || run.runId}</span>
          {run.status === 'waiting' && (
            <span className="shrink-0 font-bold text-warn-ink" title="这个任务停在写操作确认上，不点不会自己往下走">
              <span aria-hidden="true">! </span>等你确认
            </span>
          )}
          <button
            type="button"
            className="btn btn-out shrink-0"
            style={{ height: 24, padding: '0 10px', fontSize: 11 }}
            onClick={() => onStopRun(run)}
            aria-label={`停止后台任务：${run.title || run.runId}`}
          >
            停止
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-ink-3 underline"
        >
          还有 {hiddenCount} 项
        </button>
      )}
    </div>
  )
}
