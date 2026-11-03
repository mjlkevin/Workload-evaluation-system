import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogActions } from '../../../components/ui/Dialog.jsx'
import { listExecutionCatalog, listExecutionTemplates, startBusinessExecution, uploadExecutionSource } from '../../../api/businessExecutions.js'
import useInvocationScope from './useInvocationScope.js'
import { resolveBusinessSchema } from './businessInputSchema.js'
import BusinessInputForm, { initialBusinessInput, validateBusinessInput } from './BusinessInputForm.jsx'

function safeError(error, fallback) {
  if (error?.status === 401) return '登录已过期，请重新登录后重试。'
  if (error?.status === 413) return '材料不能超过 2 MiB，请缩小文件后重试。'
  if (error?.status === 409) return '该会话或执行内容已变化，请刷新任务后重新选择并启动。'
  if ([400, 415, 422].includes(error?.status)) return '材料或输入格式无效，请检查后重试。'
  if (error?.message === '网络请求失败') return '网络请求失败，请重试。'
  return fallback
}
function hasTemplateField(schema) {
  try { return !!resolveBusinessSchema(schema).properties?.templateId } catch { return false }
}

export default function SkillInvocationDialog({ open, onClose, onStarted, ensureSession, session, resourceOptions = {} }) {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState('')
  const [input, setInput] = useState({})
  const [sources, setSources] = useState([])
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploaded, setUploaded] = useState([])
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateReload, setTemplateReload] = useState(0)
  const busy = submitting || uploading
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const attempt = useRef(null)
  const selectionScope = useRef(null)
  const uploadedSession = useRef(null)
  const scope = useInvocationScope(open, session?.sessionId ?? null, ensureSession)
  const revision = scope.revision
  useEffect(() => {
    if (!open) return undefined
    let active = true
    const token = scope.capture()
    setLoading(true)
    setError('')
    setCatalog([])
    listExecutionCatalog()
      .then(items => { if (active && scope.current(token)) setCatalog(items) })
      .catch(err => { if (active && scope.current(token)) setError(safeError(err, '目录加载失败，请重试。')) })
      .finally(() => { if (active && scope.current(token)) setLoading(false) })
    return () => { active = false }
  }, [open, reload, revision])
  useEffect(() => {
    inFlight.current = null
    setSubmitting(false)
    setUploading(false)
    if (uploadedSession.current !== scope.sessionId || !scope.sessionId) {
      uploadedSession.current = scope.sessionId
      setUploaded([])
    }
    setUploadError('')
    selectionScope.current = null
    setSelection('')
    setInput({})
    setSources([])
    setErrors({})
    setDirty(false)
    setDiscard(false)
    attempt.current = null
  }, [revision])
  const selected = selectionScope.current === revision && catalog.find(item => `${item.kind}:${item.id}` === selection)
  const needsTemplate = selected && hasTemplateField(selected.inputSchema)
  useEffect(() => {
    setTemplates([])
    setTemplateError('')
    setTemplatesLoading(false)
    if (!open || !needsTemplate) return undefined
    let active = true
    const token = scope.capture()
    setTemplatesLoading(true)
    Promise.resolve().then(() => listExecutionTemplates())
      .then(items => { if (active && scope.current(token)) setTemplates((items || []).filter(item => typeof item.templateId === 'string' && item.templateId)) })
      .catch(err => { if (active && scope.current(token)) setTemplateError(safeError(err, '评估模板加载失败，请重试。')) })
      .finally(() => { if (active && scope.current(token)) setTemplatesLoading(false) })
    return () => { active = false }
  }, [open, revision, selection, templateReload, needsTemplate])
  const formResources = { ...resourceOptions, byPath: {
    ...resourceOptions.byPath,
    ...(needsTemplate ? { templateId: templates.map(item => ({ id: item.templateId, name: `${item.templateName || item.templateId} · ${item.templateVersion || '当前版本'}` })) } : {}),
  } }
  const attachments = [...new Map([...(uploadedSession.current === scope.sessionId ? uploaded : []), ...(session?.attachments || [])].filter(item => item.attachmentId).map(item => [item.attachmentId, item])).values()]
  const sourceChoices = [
    ...attachments.map(item => ({ kind: 'file', id: item.attachmentId, name: item.name || '会话材料', available: item.sourceAvailable === true })),
    ...(session?.messages || []).filter(item => item.messageId && item.content && ['user', 'assistant'].includes(item.role)).map(item => ({ kind: 'conversation', id: item.messageId, name: `会话 · ${String(item.content).slice(0, 80)}`, available: true })),
  ]
  async function upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || inFlight.current) return
    setUploadError('')
    if (file.size > 2 * 1024 * 1024) { setUploadError('材料不能超过 2 MiB，请缩小文件后重试。'); return }
    if (!/\.(xlsx|md|txt)$/i.test(file.name)) { setUploadError('请选择 .xlsx、.txt 或 .md 材料。'); return }
    const token = scope.capture()
    inFlight.current = token
    setUploading(true)
    try {
      const activeSession = await scope.ensure(selected?.name || '需求材料', token)
      if (!activeSession || !scope.current(token)) return
      const attachment = await uploadExecutionSource(activeSession.sessionId, file)
      if (!scope.current(token)) return
      if (!attachment?.attachmentId || attachment.sourceAvailable !== true) throw new Error('source_unavailable')
      uploadedSession.current = activeSession.sessionId
      setUploaded(current => [...current.filter(item => item.attachmentId !== attachment.attachmentId), attachment].slice(-10))
      setSources(current => [...new Set([...current, `file:${attachment.attachmentId}`])])
      setDirty(true)
    } catch (err) {
      if (scope.current(token)) setUploadError(safeError(err, '材料上传失败，请重新选择文件后重试。'))
    } finally {
      if (inFlight.current === token) {
        inFlight.current = null
        if (scope.current(token)) setUploading(false)
      }
    }
  }
  function requestClose() {
    if (inFlight.current) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  function select(value) {
    if (inFlight.current) return
    scope.changeTarget()
    selectionScope.current = revision
    setSelection(value)
    const item = catalog.find(entry => `${entry.kind}:${entry.id}` === value)
    const next = initialBusinessInput(item?.inputSchema) ?? {}
    if (hasTemplateField(item?.inputSchema) && next && typeof next === 'object') delete next.templateId
    setInput(next)
    setErrors({})
    setError('')
    setDirty(true)
  }
  async function submit(event) {
    event.preventDefault()
    if (!selected || inFlight.current) return
    const nextErrors = validateBusinessInput(selected.inputSchema, input)
    const template = needsTemplate && templates.find(item => item.templateId === input?.templateId)
    if (needsTemplate && input?.templateId !== undefined && !template) nextErrors.templateId = '请选择有效的评估模板'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const sourceRefs = sourceChoices.filter(choice => choice.available && sources.includes(`${choice.kind}:${choice.id}`)).map(({ kind, id }) => ({ kind, id }))
    const execution = { kind: selected.kind, [selected.kind === 'skill' ? 'skillId' : 'workflowId']: selected.id, input, ...(sourceRefs.length ? { sources: sourceRefs } : {}), ...(template ? { assets: [{ kind: 'assessment-catalog', templateId: template.templateId }] } : {}) }
    const fingerprint = JSON.stringify(execution)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, submissionKey: crypto.randomUUID() }
    const token = scope.capture()
    const submission = attempt.current
    inFlight.current = token
    setSubmitting(true)
    setError('')
    try {
      const activeSession = await scope.ensure(selected.name, token)
      if (!activeSession || !scope.current(token)) return
      const result = await startBusinessExecution(activeSession.sessionId, { submissionKey: submission.submissionKey, content: `执行：${selected.name}`, execution })
      if (scope.current(token)) {
        setDirty(false)
        onStarted?.(result)
        onClose()
      }
    } catch (err) {
      if (scope.current(token)) setError(safeError(err, '启动失败，请重试。'))
    } finally {
      if (inFlight.current === token) {
        inFlight.current = null
        if (scope.current(token)) setSubmitting(false)
      }
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
              resourceOptions={formResources} onChange={value => { setInput(value); setDirty(true) }}
            />
          </>
        )}
        {needsTemplate && templatesLoading && <p role="status" className="m-0 text-sm text-ink-2">评估模板加载中…</p>}
        {needsTemplate && templateError && <div role="alert" className="text-sm text-err-ink">{templateError}<button type="button" className="btn btn-out ml-2" disabled={busy} onClick={() => setTemplateReload(value => value + 1)}>重试加载模板</button></div>}
        <div className="grid min-w-0 gap-1">
          <label htmlFor="business-source-upload" className="text-sm font-medium">上传需求材料</label>
          <input id="business-source-upload" type="file" accept=".xlsx,.txt,.md" disabled={busy} aria-invalid={!!uploadError} aria-describedby={uploadError ? 'business-source-upload-error' : undefined} onChange={upload} className="w-full min-w-0 text-sm" />
          {uploading && <p role="status" className="m-0 text-sm text-ink-2">正在上传需求材料…</p>}
          {uploadError && <p id="business-source-upload-error" role="alert" className="m-0 text-sm text-err-ink">{uploadError}</p>}
        </div>
        {!!sourceChoices.length && (
          <fieldset disabled={busy} className="m-0 grid gap-2 rounded-md border border-line p-3">
            <legend className="text-sm font-medium">选择已有材料</legend>
            {sourceChoices.map(choice => {
              const key = `${choice.kind}:${choice.id}`
              return (
                <label key={key} className="flex min-w-0 items-start gap-2 break-words text-sm">
                  <input
                    type="checkbox" disabled={!choice.available} checked={choice.available && sources.includes(key)}
                    onChange={event => {
                      setSources(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))
                      setDirty(true)
                    }}
                  />{choice.name}{!choice.available && <span className="text-ink-2">（原文不可用，请重新上传）</span>}
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
          <button type="submit" className="btn btn-pri" disabled={busy || loading || !selected}>{submitting ? '启动中…' : '启动执行'}</button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
