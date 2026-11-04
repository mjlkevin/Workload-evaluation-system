import { useEffect, useRef, useState } from 'react'
import { listExecutionCatalog, listExecutionTemplates, startBusinessExecution, uploadExecutionSource } from '../../../api/businessExecutions.js'
import { initialBusinessInput, validateBusinessInput } from '../components/BusinessInputForm.jsx'
import { resolveBusinessSchema } from '../components/businessInputSchema.js'
import useInvocationScope from '../components/useInvocationScope.js'

function promptInput(schema, prompt) {
  const resolved = resolveBusinessSchema(schema)
  if (resolved.type === 'string') return prompt
  const input = initialBusinessInput(schema) ?? {}
  for (const key of ['text', 'description', 'instructions']) {
    if (resolved.properties?.[key]?.type === 'string' && !Object.hasOwn(resolved.properties[key], 'const')) { input[key] = prompt; break }
  }
  return input
}
const message = error => error?.status === 401 ? '登录已过期，请重新登录。'
  : error?.status === 409 ? '目录或会话已变化，请重新选择任务后发送。'
    : error?.status === 413 ? '材料不能超过 2 MiB，请缩小文件后重试。'
      : [400, 415, 422].includes(error?.status) ? '任务输入或材料无效，请检查后重试。'
        : error?.publicMessage || '发送失败，请重试；提示词、附件和任务标签已保留。'

/** One draft, one task, one explicit send; every async boundary is session fenced. */
export default function useComposerBusinessTask({ workbench, onStarted, userId }) {
  const ensureSession = name => workbench.activeSession || workbench.createSession({ title: name, workflowKey: 'free_chat', status: 'temporary_chat' })
  const scope = useInvocationScope(true, workbench.activeSession?.sessionId ?? null, ensureSession)
  const [selectedTask, setSelectedTask] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [parameters, setParameters] = useState(null)
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const flight = useRef(null), attempt = useRef(null), upload = useRef(null), latest = useRef(workbench)
  const identity = useRef(userId)
  latest.current = workbench
  if (identity.current !== userId) { identity.current = userId; scope.changeTarget() }
  useEffect(() => {
    setSelectedTask(null); setParameters(null); setBusy(false); setError('')
    flight.current = null; attempt.current = null; upload.current = null
  }, [scope.revision, userId])

  function selectTask(task) {
    if (flight.current) return
    scope.changeTarget(); setSelectedTask(task); setParameters(null); setError(''); attempt.current = null
  }
  function removeTask() { if (!flight.current) { scope.changeTarget(); setSelectedTask(null); setParameters(null); setError('') } }
  async function loadTemplates() {
    const token = scope.capture()
    setTemplatesLoading(true); setTemplateError(''); setTemplates([])
    try { const items = await listExecutionTemplates(); if (scope.current(token)) setTemplates(items.filter(item => item.templateId)) }
    catch { if (scope.current(token)) setTemplateError('评估模板加载失败，请重试。') }
    finally { if (scope.current(token)) setTemplatesLoading(false) }
  }
  async function execute(draft, input, token) {
    const session = await scope.ensure(draft.task.name, token)
    if (!session || !scope.current(token)) return
    const execution = { kind: draft.task.kind, [draft.task.kind === 'skill' ? 'skillId' : 'workflowId']: draft.task.id, input }
    if (draft.file) {
      let source = upload.current?.file === draft.file && upload.current.sessionId === session.sessionId ? upload.current.source : null
      if (!source) {
        source = await uploadExecutionSource(session.sessionId, draft.file)
        if (!scope.current(token)) return
        if (!source?.attachmentId || source.sourceAvailable !== true) throw new Error('source_unavailable')
        upload.current = { file: draft.file, sessionId: session.sessionId, source }
      }
      execution.sources = [{ kind: 'file', id: source.attachmentId }]
    }
    if (draft.hasTemplate && input?.templateId) execution.assets = [{ kind: 'assessment-catalog', templateId: input.templateId }]
    const fingerprint = JSON.stringify([session.sessionId, draft.prompt, execution])
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, submissionKey: crypto.randomUUID() }
    if (!scope.current(token)) return
    const result = await startBusinessExecution(session.sessionId, { submissionKey: attempt.current.submissionKey, content: draft.prompt || `执行：${draft.task.name}`, execution })
    if (!scope.current(token)) return
    setParameters(null); setSelectedTask(null); setError('')
    // An accepted old request must never erase text edited while it was in flight.
    if (latest.current.composer === draft.rawPrompt) { latest.current.setComposer(''); latest.current.clearComposerDraft?.() }
    if (latest.current.selectedFile === draft.file) latest.current.setSelectedFile?.(null)
    onStarted?.(result)
  }
  async function send() {
    if (!selectedTask || flight.current) return
    const token = scope.capture()
    const draft = { task: selectedTask, rawPrompt: workbench.composer || '', prompt: (workbench.composer || '').trim(), file: workbench.selectedFile }
    if (!draft.prompt && !draft.file) { setError('请输入提示词或附加需求材料。'); return }
    if (draft.file && (draft.file.size > 2 * 1024 * 1024 || !/\.(xlsx|txt|md)$/i.test(draft.file.name))) { setError('业务任务支持 2 MiB 内的 .xlsx、.txt 或 .md 材料。'); return }
    flight.current = token; setBusy(true); setError('')
    try {
      const catalog = await listExecutionCatalog()
      if (!scope.current(token)) return
      const current = catalog.find(item => item.kind === draft.task.kind && item.id === draft.task.id)
      if (!current || draft.task.versionId && current.versionId !== draft.task.versionId) throw { publicMessage: '目录已变化，请移除标签并重新选择任务。' }
      draft.task = current
      const schema = resolveBusinessSchema(current.inputSchema)
      draft.hasTemplate = !!schema.properties?.templateId
      const input = promptInput(current.inputSchema, draft.prompt)
      const errors = validateBusinessInput(current.inputSchema, input)
      if (Object.keys(errors).length || draft.hasTemplate) {
        setParameters({ draft, input, errors })
        if (draft.hasTemplate) void loadTemplates()
        return
      }
      await execute(draft, input, token)
    } catch (err) { if (scope.current(token)) setError(message(err)) }
    finally { if (flight.current === token) { flight.current = null; if (scope.current(token)) setBusy(false) } }
  }
  async function submitParameters() {
    if (!parameters || flight.current || templatesLoading) return
    const { draft, input } = parameters
    const errors = validateBusinessInput(draft.task.inputSchema, input)
    if (draft.hasTemplate && input?.templateId !== undefined && !templates.some(item => item.templateId === input.templateId)) errors.templateId = '请选择有效的评估模板'
    setParameters(current => ({ ...current, errors }))
    if (Object.keys(errors).length) return
    const token = scope.capture(); flight.current = token; setBusy(true); setError('')
    try { await execute(draft, input, token) }
    catch (err) { if (scope.current(token)) setError(message(err)) }
    finally { if (flight.current === token) { flight.current = null; if (scope.current(token)) setBusy(false) } }
  }
  return { selectedTask, selectTask, removeTask, send, busy, error, parameters, templates, templatesLoading, templateError, loadTemplates,
    cancelParameters: () => { if (!flight.current) { scope.changeTarget(); setParameters(null); setError(''); setTemplatesLoading(false); setTemplateError('') } },
    changeInput: input => setParameters(current => current ? { ...current, input } : current), submitParameters }
}
