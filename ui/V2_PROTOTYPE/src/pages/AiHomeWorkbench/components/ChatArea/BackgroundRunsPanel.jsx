import { useState } from 'react'
import { railFocus } from '../../../../components/AiWorkbench/RailIcon.jsx'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting'])
const VISIBLE_ROW_LIMIT = 2

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
    <section aria-label="后台任务" className="col-span-2 flex max-h-40 shrink-0 flex-col gap-2 overflow-y-auto border-b border-line px-1 pb-3 text-xs text-ink-2">
      <span role="status" className="sr-only">{`后台任务 进行中 ${runCounts.active} · 已完成 ${runCounts.completed}`}</span>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="mr-auto font-medium">后台任务</span>
        <span><b className={runCounts.active ? 'font-semibold text-brand tabular-nums' : 'font-medium tabular-nums'}>{runCounts.active}</b> 进行中</span>
        <span className="text-line-2">/</span>
        <span><b className="font-medium tabular-nums">{runCounts.completed}</b> 已完成</span>
      </div>
      {visibleRuns.map((run, idx) => (
        <div
          key={run.runId}
          className={`flex shrink-0 flex-wrap items-center gap-2 ${idx === 0 ? '' : 'border-t border-line pt-2'}`}
        >
          <span className="w-full truncate text-xs text-ink" title={run.title || run.runId}>{run.title || run.runId}</span>
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${run.status === 'waiting' ? 'bg-warn-ink' : 'bg-brand'}`} />
          {run.status === 'waiting' && (
            <span className="shrink-0 font-bold text-warn-ink" title="这个任务停在写操作确认上，不点不会自己往下走">
              <span aria-hidden="true">! </span>等你确认
            </span>
          )}
          <button
            type="button"
            className={`ml-auto min-h-7 shrink-0 cursor-pointer rounded-sm border border-line bg-transparent px-2 text-[11px] text-ink-2 hover:border-err hover:text-err-ink ${railFocus}`}
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
          className={`min-h-7 cursor-pointer self-start rounded-sm border-0 bg-transparent p-0 text-[11px] text-brand ${railFocus}`}
        >
          还有 {hiddenCount} 项
        </button>
      )}
    </section>
  )
}
