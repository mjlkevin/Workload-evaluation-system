import { useId, useRef, useState } from 'react'
import { Dialog, DialogActions } from '../../../components/ui/Dialog.jsx'
import BusinessValue, { Collapsed, isCatalog } from './BusinessResult.jsx'
import { resolveBusinessSchema } from './businessInputSchema.js'
import BusinessInputForm, { initialBusinessInput, validateBusinessInput } from './BusinessInputForm.jsx'

const statuses = {
  queued: '排队中', running: '执行中', recovering: '恢复中', waiting: '等待处理',
  completed: '已完成', failed: '执行失败', cancelled: '已停止', succeeded: '已完成', pending: '待处理',
}
const activeStatuses = ['queued', 'running', 'recovering', 'waiting']
function WaitingInput({ runId, pending, busy, onInput, onDecision, resourceOptions = {}, resumeDecision }) {
  const [input, setInput] = useState(() => initialBusinessInput(pending.outputSchema) ?? {})
  let selectionSchema
  try { selectionSchema = resolveBusinessSchema(pending.outputSchema).properties?.selectedItemIds } catch { /* Form reports invalid schema. */ }
  const hasSelection = selectionSchema?.type === 'array'
  const catalog = isCatalog(pending.displayInput?.catalog) ? pending.displayInput.catalog : null
  const choices = resourceOptions.byPath?.selectedItemIds ?? (catalog ? catalog.template.items.map(item => ({ id: item.templateItemId, name: `${item.itemName} · ${item.templateItemId}` })) : [])
  const inputResources = hasSelection ? { ...resourceOptions, byPath: { ...resourceOptions.byPath, selectedItemIds: choices } } : resourceOptions
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const lock = useRef(false)
  const [requesting, setRequesting] = useState(false)
  async function send(event, decision) {
    event?.preventDefault()
    if (busy || lock.current) return
    if (!decision) {
      const submitted = hasSelection ? { ...input, selectedItemIds: input.selectedItemIds ?? [] } : input
      const next = validateBusinessInput(pending.outputSchema, submitted, inputResources)
      setErrors(next)
      if (Object.keys(next).length) return
    }
    lock.current = true
    setRequesting(true)
    setError('')
    try {
      if (decision) await onDecision(runId, pending, decision)
      else await onInput(runId, pending, hasSelection ? { ...input, selectedItemIds: input.selectedItemIds ?? [] } : input)
    } catch (err) {
      setError(err?.message || '操作失败，请重试')
    } finally {
      lock.current = false
      setRequesting(false)
    }
  }
  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-line bg-bg-soft p-3">
      <p className="m-0 text-sm font-medium">{pending.prompt || '请确认本次操作'}</p>
      {pending.displayInput !== undefined && (
        <details open>
          <summary className="text-xs text-ink-2">本次范围与输入</summary>
          <BusinessValue value={pending.displayInput} />
        </details>
      )}
      {pending.kind === 'userInput' ? (
        <form noValidate className="grid min-w-0 gap-3" onSubmit={event => send(event)}>
          <BusinessInputForm
            schema={pending.outputSchema} value={input} onChange={setInput} errors={errors}
            disabled={busy || requesting} resourceOptions={inputResources}
          />
          {hasSelection && !input.selectedItemIds?.length && <p className="m-0 text-sm text-warn-ink">未选择任何实施项；提交后将使用空范围。</p>}
          <button type="submit" className="btn btn-pri justify-self-start" disabled={busy || requesting}>提交补充信息</button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {resumeDecision ? (
            <button type="button" className="btn btn-pri" disabled={busy || requesting} onClick={event => send(event, resumeDecision)}>
              {resumeDecision === 'confirm' ? '恢复已确认操作' : '恢复已拒绝操作'}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-pri" disabled={busy || requesting} onClick={event => send(event, 'confirm')}>确认继续</button>
              <button type="button" className="btn btn-out" disabled={busy || requesting} onClick={event => send(event, 'reject')}>拒绝本次操作</button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-sm text-err-ink">{error}</p>}
    </div>
  )
}
function Operation({ runId, pending, ...props }) {
  return (
    <WaitingInput
      {...props} runId={runId}
      onDecision={(_, __, decision) => props.onDecision(runId, pending, decision)}
      pending={{ ...pending, prompt: '请确认本次写入操作', displayInput: pending.parameters }}
      resumeDecision={pending.status === 'approved' ? 'confirm' : pending.status === 'rejected' ? 'reject' : undefined}
    />
  )
}
export default function BusinessExecutionPanel({ runs = [], loading = false, busy = false, error = '', onRefresh, onInput, onDecision, onRetry, onStop, resourceOptions = {} }) {
  const [target, setTarget] = useState(null)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [reasonError, setReasonError] = useState(false)
  const errorId = useId()
  const retryAttempt = useRef(null)
  const actionLock = useRef(false)
  function requestAction(run, kind) {
    setTarget({ runId: run.runId, name: run.businessExecution.target.name, kind })
    retryAttempt.current = null
    setDiscard(false)
    setReasonError(false)
    setReason('')
    setActionError('')
  }
  function requestCloseAction() {
    if (actionLock.current || busy) return
    if (target?.kind === 'retry' && reason.trim()) setDiscard(true)
    else setTarget(null)
  }
  async function confirmAction(event) {
    event.preventDefault()
    if (busy || actionLock.current || !target) return
    if (target.kind === 'retry' && !reason.trim()) {
      setReasonError(true)
      setActionError('请填写重试原因')
      return
    }
    const fingerprint = JSON.stringify({ runId: target.runId, reason: reason.trim() })
    if (target.kind === 'retry' && retryAttempt.current?.fingerprint !== fingerprint) {
      retryAttempt.current = { fingerprint, submissionKey: crypto.randomUUID() }
    }
    actionLock.current = true
    setReasonError(false)
    setRequesting(true)
    setActionError('')
    try {
      const result = target.kind === 'retry'
        ? await onRetry(target.runId, { submissionKey: retryAttempt.current.submissionKey, reason: reason.trim() })
        : await onStop(target.runId)
      if (result !== false) setTarget(null)
    } catch (err) {
      setActionError(err?.message || '操作失败，请重试')
    } finally {
      actionLock.current = false
      setRequesting(false)
    }
  }
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
            <div className="flex flex-wrap gap-2">
              {run.status === 'failed' && <button type="button" className="btn btn-out" disabled={busy} onClick={() => requestAction(run, 'retry')}>重试执行</button>}
              {activeStatuses.includes(run.status) && <button type="button" className="btn btn-out" disabled={busy} onClick={() => requestAction(run, 'stop')}>停止执行</button>}
            </div>
          </article>
        )
      })}
      <Dialog
        open={!!target} title={target?.kind === 'retry' ? '重试执行' : '停止执行'}
        onClose={requestCloseAction} dismissDisabled={busy || requesting}
      >
        <form onSubmit={confirmAction} noValidate className="grid gap-3">
          <p className="m-0 text-sm">{target?.name}：{target?.kind === 'retry' ? '重试将创建新的执行，已完成操作会保留。' : '停止后已产出的内容与操作记录会保留。'}</p>
          {target?.kind === 'retry' && (
            <label className="grid gap-1 text-sm">重试原因
              <textarea
                className="input min-h-20 resize-y py-2" value={reason} disabled={busy || requesting}
                required aria-invalid={reasonError} aria-describedby={reasonError ? errorId : undefined}
                onChange={event => { setReason(event.target.value); setReasonError(false) }}
              />
            </label>
          )}
          {actionError && <p id={errorId} role="alert" className="text-sm text-err-ink">{actionError}</p>}
          {discard && (
            <div role="alert" className="grid gap-2 rounded-md bg-warn-soft p-3 text-sm text-warn-ink">
              <span>重试原因尚未提交，确定放弃吗？</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-out" onClick={() => setDiscard(false)}>继续填写</button>
                <button type="button" className="btn btn-out" onClick={() => { setTarget(null); setDiscard(false) }}>放弃重试</button>
              </div>
            </div>
          )}
          <DialogActions>
            <button type="button" className="btn btn-out" disabled={busy || requesting} onClick={requestCloseAction}>{target?.kind === 'stop' ? '继续执行' : '取消'}</button>
            <button type="submit" className="btn btn-pri" disabled={busy || requesting}>{target?.kind === 'retry' ? '确认重试' : '确认停止'}</button>
          </DialogActions>
        </form>
      </Dialog>
    </section>
  )
}
