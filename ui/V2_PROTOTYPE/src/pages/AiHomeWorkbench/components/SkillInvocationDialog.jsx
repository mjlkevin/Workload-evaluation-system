import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogActions } from '../../../components/ui/Dialog.jsx'
import { listExecutionCatalog, startBusinessExecution } from '../../../api/businessExecutions.js'
import BusinessInputForm, { initialBusinessInput, validateBusinessInput } from './BusinessInputForm.jsx'

export default function SkillInvocationDialog({ open, onClose, onStarted, ensureSession, session, resourceOptions = {} }) {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState('')
  const [input, setInput] = useState({})
  const [sources, setSources] = useState([])
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const attempt = useRef(null)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!open) return undefined
    let active = true
    setLoading(true)
    setError('')
    setCatalog([])
    listExecutionCatalog()
      .then(items => { if (active) setCatalog(items) })
      .catch(err => { if (active) setError(err?.message || '目录加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, reload])
  useEffect(() => {
    if (!open) return
    setSelection('')
    setInput({})
    setSources([])
    setErrors({})
    setDirty(false)
    setDiscard(false)
    attempt.current = null
  }, [open])
  const selected = catalog.find(item => `${item.kind}:${item.id}` === selection)
  const sourceChoices = [
    ...(session?.attachments || []).filter(item => item.attachmentId).map(item => ({ kind: 'file', id: item.attachmentId, name: item.name || '会话材料' })),
    ...(session?.messages || []).filter(item => item.messageId && item.content && ['user', 'assistant'].includes(item.role)).map(item => ({ kind: 'conversation', id: item.messageId, name: `会话 · ${String(item.content).slice(0, 80)}` })),
  ]
  function requestClose() {
    if (inFlight.current) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  function select(value) {
    setSelection(value)
    const item = catalog.find(entry => `${entry.kind}:${entry.id}` === value)
    setInput(initialBusinessInput(item?.inputSchema) ?? {})
    setErrors({})
    setError('')
    setDirty(true)
  }
  async function submit(event) {
    event.preventDefault()
    if (!selected || inFlight.current) return
    const nextErrors = validateBusinessInput(selected.inputSchema, input)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const sourceRefs = sourceChoices.filter(choice => sources.includes(`${choice.kind}:${choice.id}`)).map(({ kind, id }) => ({ kind, id }))
    const execution = { kind: selected.kind, [selected.kind === 'skill' ? 'skillId' : 'workflowId']: selected.id, input, ...(sourceRefs.length ? { sources: sourceRefs } : {}) }
    const fingerprint = JSON.stringify(execution)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, submissionKey: crypto.randomUUID() }
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const activeSession = attempt.current.session || await ensureSession(selected.name)
      attempt.current.session = activeSession
      if (!activeSession?.sessionId) throw new Error('会话创建失败，请重试')
      const result = await startBusinessExecution(activeSession.sessionId, { submissionKey: attempt.current.submissionKey, content: `执行：${selected.name}`, execution })
      if (alive.current) {
        setDirty(false)
        onStarted?.(result)
        onClose()
      }
    } catch (err) {
      if (alive.current) setError(err?.status === 409 ? '该会话或执行内容已变化，请刷新任务后重新选择并启动。' : err?.message || '启动失败，请重试')
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <Dialog open={open} title="启动 Skill / 工作流" onClose={requestClose} dismissDisabled={busy} wide>
      <form noValidate onSubmit={submit} className="grid min-w-0 gap-4" aria-busy={busy || loading}>
        <div className="grid gap-1">
          <label htmlFor="business-execution-selection" className="text-sm font-medium">选择 Skill 或工作流</label>
          <select
            id="business-execution-selection" className="input" value={selection}
            disabled={loading || busy} onChange={event => select(event.target.value)}
          >
            <option value="">{loading ? '目录加载中…' : '请选择'}</option>
            {catalog.map(item => (
              <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                {item.kind === 'skill' ? 'Skill' : '工作流'} · {item.name}
              </option>
            ))}
          </select>
        </div>
        {!loading && !catalog.length && !error && <p role="status" className="text-sm text-ink-2">当前没有可执行的 Skill 或工作流。</p>}
        {selected && (
          <>
            <p className="m-0 text-sm text-ink-2">{selected.description}</p>
            <BusinessInputForm
              schema={selected.inputSchema} value={input} errors={errors} disabled={busy}
              resourceOptions={resourceOptions} onChange={value => { setInput(value); setDirty(true) }}
            />
          </>
        )}
        {!!sourceChoices.length && (
          <fieldset disabled={busy} className="m-0 grid gap-2 rounded-md border border-line p-3">
            <legend className="text-sm font-medium">选择已有材料</legend>
            {sourceChoices.map(choice => {
              const key = `${choice.kind}:${choice.id}`
              return (
                <label key={key} className="flex min-w-0 items-start gap-2 break-words text-sm">
                  <input
                    type="checkbox" checked={sources.includes(key)}
                    onChange={event => {
                      setSources(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))
                      setDirty(true)
                    }}
                  />{choice.name}
                </label>
              )
            })}
          </fieldset>
        )}
        {error && (
          <div role="alert" className="rounded-md bg-err-soft p-3 text-sm text-err-ink">
            {error}
            {!selected && <button type="button" className="btn btn-out ml-2" onClick={() => setReload(value => value + 1)}>重试加载目录</button>}
          </div>
        )}
        {discard && (
          <div role="alert" className="grid gap-2 rounded-md bg-warn-soft p-3 text-sm text-warn-ink">
            <span>有未提交的输入，确定放弃吗？</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-out" onClick={() => setDiscard(false)}>继续编辑</button>
              <button type="button" className="btn btn-out" onClick={onClose}>放弃输入</button>
            </div>
          </div>
        )}
        <DialogActions>
          <button type="button" className="btn btn-out" onClick={requestClose} disabled={busy}>取消</button>
          <button type="submit" className="btn btn-pri" disabled={busy || loading || !selected}>{busy ? '启动中…' : '启动执行'}</button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
