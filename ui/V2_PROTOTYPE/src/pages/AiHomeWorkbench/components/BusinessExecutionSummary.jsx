import { businessEntryDomId } from '../utils/businessMessageTimeline.js'

const statuses = { queued: '排队中', running: '执行中', recovering: '恢复中', waiting: '等待处理', completed: '已完成', failed: '执行失败', cancelled: '已停止' }
function locate(entry) {
  const target = document.getElementById(businessEntryDomId(entry))
  target?.focus({ preventScroll: true })
  target?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
}

/** Navigation-only inspector: forms, details and artifacts belong to the conversation. */
export default function BusinessExecutionSummary({ entries, runs }) {
  const roots = [...new Map(entries.filter(entry => entry.type === 'business').map(entry => [entry.rootRunId, entry.currentRunId])).entries()]
  return (
    <section aria-label="任务摘要" className="grid min-w-0 gap-4 text-ink">
      <h2 className="m-0 text-sm font-semibold">任务摘要</h2>
      {roots.map(([root, currentRunId]) => {
        const run = runs.find(item => item.runId === currentRunId)
        if (!run) return null
        const records = entries.filter(entry => entry.type === 'business' && entry.rootRunId === root)
        const pending = records.filter(entry => entry.pending)
        const result = records.find(entry => entry.final)
        const stage = run.businessExecution.currentStep?.name
          || run.businessExecution.steps?.find(step => step.id === run.businessExecution.currentStep?.id)?.name
          || records.findLast(entry => entry.kind === 'stage')?.title
        return (
          <article key={root} className="grid min-w-0 gap-2 border-t border-line pt-3">
            <h3 className="m-0 break-words text-sm font-medium">{run.businessExecution.target.name}</h3>
            <p className="m-0 text-xs text-ink-2">{statuses[run.status] || run.status}</p>
            {stage && <p className="m-0 break-words text-xs text-ink-2">{stage}</p>}
            <div className="flex flex-wrap gap-2">
              {pending.length > 0 && <button type="button" className="btn btn-out text-xs" onClick={() => locate(pending[0])}>定位待处理（{pending.length}）</button>}
              {result && <button type="button" className="btn btn-out text-xs" onClick={() => locate(result)}>定位结果</button>}
            </div>
          </article>
        )
      })}
    </section>
  )
}
