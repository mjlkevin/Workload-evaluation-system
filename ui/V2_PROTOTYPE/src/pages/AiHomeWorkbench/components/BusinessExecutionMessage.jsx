import BusinessValue, { Collapsed } from './BusinessResult.jsx'
import { Operation, WaitingInput } from './BusinessExecutionControls.jsx'
import { businessEntryDomId } from '../utils/businessMessageTimeline.js'

const statuses = { queued: '排队中', running: '执行中', recovering: '恢复中', waiting: '等待处理', pending: '待处理', answered: '已回答', recorded: '已记录', succeeded: '已完成', completed: '已完成', failed: '执行失败', cancelled: '已停止', approved: '已确认', rejected: '已拒绝' }
const sameWait = (left, right, hash) => left?.actionId && left.actionId === right?.actionId && left[hash] === right[hash]

// Rendering consumes the mapper's current descriptor; historical status alone never opens a control.
function currentWait(entry, run) {
  const pending = entry.pending, execution = run?.businessExecution
  if (!pending || run?.status !== 'waiting' || entry.currentRunId !== run.runId || entry.runId !== run.runId
    || entry.stepId !== execution?.currentStep?.id || pending.stepId !== execution.currentStep.id
    || pending.runId !== undefined && pending.runId !== run.runId) return null
  const operation = execution.pendingOperation
  if (sameWait(pending, operation, 'confirmationHash') && pending.operationId === operation.operationId
    && ['pending', 'approved', 'rejected'].includes(operation.status)) return { operation: true, pending: operation }
  const input = execution.pendingInput
  if (sameWait(pending, input, 'contentHash') && ['userInput', 'confirmation'].includes(input.kind)) return { pending: input }
  return null
}
function FinalResult({ value, run }) {
  const execution = run?.businessExecution
  const nativeEffects = (execution?.results?.effects ?? []).filter(effect => effect.toolName === 'create_assessment_draft')
  const effects = nativeEffects.length ? nativeEffects
    : (execution?.timeline?.version === 1 ? execution.timeline.entries : []).filter(entry => entry.kind === 'tool_result' && entry.status === 'succeeded')
      .map(entry => ({ toolName: entry.toolName, result: entry.content?.result ?? entry.content }))
  const drafts = effects.filter(effect => effect.toolName === 'create_assessment_draft'
    && typeof effect.result?.assessmentId === 'string' && effect.result.assessmentId.trim()).map(effect => effect.result)
  const visibleDraft = value?.draft ?? value
  const nativeDraft = drafts.find(draft => draft.assessmentId === visibleDraft?.assessmentId)
  const displayed = !nativeDraft ? value : value?.draft
    ? { ...value, draft: { ...value.draft, ...nativeDraft, totalDays: nativeDraft.totalDays } }
    : { ...value, ...nativeDraft, totalDays: nativeDraft.totalDays }
  // Qualification follows only the verified object inserted here, never another object with its id.
  const nativeDraftValues = nativeDraft ? [value?.draft ? displayed.draft : displayed] : []
  return (
    <div className="grid min-w-0 gap-3">
      {!nativeDraftValues.length && drafts.map(draft => <BusinessValue key={draft.assessmentId} value={draft} nativeDraft />)}
      <BusinessValue value={displayed} context={{ nativeDraftValues }} />
    </div>
  )
}
function ReadOnlyQuestion({ entry }) {
  return (
    <div className="grid min-w-0 gap-3">
      {entry.content?.prompt && <p className="m-0 whitespace-pre-wrap break-words text-sm">{entry.content.prompt}</p>}
      {entry.content?.displayInput !== undefined ? <BusinessValue value={entry.content.displayInput} />
        : !entry.content?.prompt && entry.content?.parameters === undefined && <BusinessValue value={entry.content} />}
      {entry.content?.parameters !== undefined && <BusinessValue value={entry.content.parameters} />}
    </div>
  )
}

/** One grouped business entry + its current run. No requests, workflow interpretation or history merging.
 * Props: entry, run (lookup entry.currentRunId), busy, error, onInput, onDecision, resourceOptions.
 * Render BusinessRunActions separately once per run. Stable entry ids preserve form state on polling.
 */
export default function BusinessExecutionMessage({ entry, run, busy = false, error = '', onInput, onDecision, resourceOptions = {} }) {
  const wait = ['question', 'confirmation'].includes(entry.kind) ? currentWait(entry, run) : null
  const user = ['input', 'answer', 'decision'].includes(entry.kind)
  const decision = entry.kind === 'decision' && typeof entry.content?.approved === 'boolean'
    ? entry.content.approved ? '已确认' : '已拒绝' : null
  const status = decision || statuses[entry.status] || entry.status
  const body = () => {
    if (entry.kind === 'coverage') return <p className="m-0 text-sm text-ink-2">部分执行记录不可用；此处仅展示已保存的业务事实。</p>
    if (entry.kind === 'stage') return (entry.content !== undefined || entry.details?.length > 0) && (
      <Collapsed title="分析与工具明细">
        <div className="mt-2 grid min-w-0 gap-3 rounded-md border border-line bg-bg-soft p-3 text-sm">
          {entry.content !== undefined && <BusinessValue value={entry.content} />}
          {entry.details?.map(detail => <div key={detail.id} className="grid min-w-0 gap-2"><h4 className="m-0 text-xs font-medium">{detail.title}</h4><BusinessValue value={detail.content} nativeDraft={detail.toolName === 'create_assessment_draft'} /></div>)}
        </div>
      </Collapsed>
    )
    if (entry.kind === 'failure') return <Collapsed title="查看失败详情"><BusinessValue value={entry.content} /></Collapsed>
    if (wait) {
      const Control = wait.operation ? Operation : WaitingInput
      return <Control key={`${wait.pending.actionId}:${wait.pending.contentHash ?? wait.pending.confirmationHash}`} runId={run.runId} pending={wait.pending} busy={busy} onInput={onInput} onDecision={onDecision} resourceOptions={resourceOptions} />
    }
    if (['question', 'confirmation'].includes(entry.kind)) return <ReadOnlyQuestion entry={entry} />
    if (entry.final) return <FinalResult value={entry.content} run={run} />
    if (entry.detail) return <Collapsed title={entry.title || '查看结果明细'}><BusinessValue value={entry.content} nativeDraft={entry.toolName === 'create_assessment_draft'} /></Collapsed>
    return <BusinessValue value={entry.content} />
  }
  return (
    <article tabIndex={-1} id={businessEntryDomId(entry)} aria-label={entry.kind === 'coverage' ? '部分执行记录不可用' : entry.title}
      className={`grid min-w-0 gap-2 text-ink ${user ? 'ml-auto max-w-full rounded-lg bg-brand-soft p-3 sm:max-w-4/5' : entry.kind === 'stage' ? 'border-l-2 border-line pl-3' : 'rounded-md border border-line bg-surface p-4'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold">{entry.kind === 'coverage' ? '部分执行记录不可用' : entry.title}</h3>
        {status && <span className={`text-xs ${entry.status === 'failed' ? 'text-err-ink' : entry.status === 'rejected' ? 'text-warn-ink' : 'text-ink-2'}`}>{status}</span>}
      </header>
      {body()}
      {error && <p role="alert" className="m-0 text-sm text-err-ink">{error}</p>}
    </article>
  )
}
