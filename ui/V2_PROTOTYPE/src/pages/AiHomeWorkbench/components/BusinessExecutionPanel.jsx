import BusinessValue, { Collapsed } from './BusinessResult.jsx'
import { WaitingInput, Operation, BusinessRunActions } from './BusinessExecutionControls.jsx'

const statuses = {
  queued: '排队中', running: '执行中', recovering: '恢复中', waiting: '等待处理',
  completed: '已完成', failed: '执行失败', cancelled: '已停止', succeeded: '已完成', pending: '待处理',
}
export default function BusinessExecutionPanel({ runs = [], loading = false, busy = false, error = '', onRefresh, onInput, onDecision, onRetry, onStop, resourceOptions = {} }) {
  return (
    <section aria-label="Skill 与工作流执行" className="grid min-w-0 gap-3 text-ink" aria-busy={loading}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold">Skill / 工作流执行</h2>
        <button type="button" className="btn btn-out" disabled={loading} onClick={onRefresh} aria-label="刷新执行任务">刷新</button>
      </div>
      {error && <p role="alert" className="m-0 rounded-md bg-err-soft p-3 text-sm text-err-ink">{error}</p>}
      {!runs.length && <p role="status" className="m-0 text-sm text-ink-2">{loading ? '正在恢复执行任务…' : '当前会话暂无业务执行。'}</p>}
      {runs.map(run => {
        const execution = run.businessExecution
        if (!execution) return null
        const results = execution.results || {}
        return (
          <article key={run.runId} className="grid min-w-0 gap-3 rounded-md border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold">{execution.target.name}</h3>
              <span role="status" className="text-xs text-ink-2">{statuses[run.status] || run.status}</span>
            </div>
            <ol className="m-0 grid gap-1 pl-5 text-xs text-ink-2">
              {(execution.steps || []).map(step => {
                const receipt = results.steps?.filter(item => item.stepId === step.id).at(-1)
                return <li key={step.id}>{step.name} · {receipt ? statuses[receipt.status] || receipt.status : execution.currentStep?.id === step.id ? statuses[run.status] || '执行中' : '待执行'}</li>
              })}
            </ol>
            {run.status === 'waiting' && execution.pendingInput && (
              <WaitingInput
                key={`${execution.pendingInput.actionId}:${execution.pendingInput.contentHash}`}
                runId={run.runId} pending={execution.pendingInput} busy={busy}
                onInput={onInput} onDecision={onDecision} resourceOptions={resourceOptions}
              />
            )}
            {run.status === 'waiting' && ['pending', 'approved', 'rejected'].includes(execution.pendingOperation?.status) && (
              <Operation
                key={`${execution.pendingOperation.actionId}:${execution.pendingOperation.confirmationHash}`}
                runId={run.runId} pending={execution.pendingOperation} busy={busy} onDecision={onDecision}
              />
            )}
            {results.steps?.map((step, index) => (
              <Collapsed
                key={`${step.stepId}:${index}`} summaryClassName="text-sm"
                title={`${execution.steps?.find(item => item.id === step.stepId)?.name || '步骤结果'} · ${statuses[step.status] || step.status}`}
              >
                <BusinessValue value={step.output ?? step.result} />
              </Collapsed>
            ))}
            {!!results.effects?.length && (
              <div className="grid gap-2">
                <h4 className="m-0 text-sm font-medium">已完成操作</h4>
                {results.effects.map((effect, index) => <BusinessValue key={index} value={effect.result} nativeDraft={effect.toolName === 'create_assessment_draft'} />)}
              </div>
            )}
            {results.output !== undefined && (
              <div className="grid gap-2">
                <h4 className="m-0 text-sm font-medium">执行结果</h4>
                <BusinessValue value={results.output} />
              </div>
            )}
            <details className="text-xs text-ink-2">
              <summary>版本与来源</summary>
              <p>版本：{execution.target.versionId}</p>
              {run.createdAt && <p>开始时间：{run.createdAt}</p>}
            </details>
            <BusinessRunActions run={run} busy={busy} onRetry={onRetry} onStop={onStop} />
          </article>
        )
      })}
    </section>
  )
}
