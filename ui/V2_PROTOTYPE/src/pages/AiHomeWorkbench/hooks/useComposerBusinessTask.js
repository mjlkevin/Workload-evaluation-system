import { useEffect, useRef, useState } from 'react'
import { listExecutionCatalog, sendSkillConversation, uploadExecutionSource } from '../../../api/businessExecutions.js'
import useInvocationScope from '../components/useInvocationScope.js'

const message = error => error?.status === 401 ? '登录已过期，请重新登录。'
  : error?.status === 409 ? '目录或会话已变化，请重新选择能力后发送。'
    : error?.status === 413 ? '材料或上下文超过上限，请减少附件后重试。'
      : error?.publicMessage || error?.message || '发送失败，请重试；提示词、附件和能力标签已保留。'
function restoredTask(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const context = messages.at(-1)?.metadata?.skillConversation
  const selection = context?.selection
  if (!['reply', 'clarify'].includes(context?.action) || !['skill', 'workflow'].includes(selection?.kind)
    || !['id', 'versionId', 'name'].every(key => typeof selection[key] === 'string' && selection[key])) return null
  return { kind: selection.kind, id: selection.id, versionId: selection.versionId, name: selection.name }
}
/** A selected ability is context; only the server's conversational decision may start a task. */
export default function useComposerBusinessTask({ workbench, onStarted, userId }) {
  const ensureSession = name => workbench.activeSession || workbench.createSession({ title: name, workflowKey: 'free_chat', status: 'temporary_chat' })
  const scope = useInvocationScope(true, workbench.activeSession?.sessionId ?? null, ensureSession)
  const [selectedTask, setSelectedTask] = useState(() => restoredTask(workbench.activeSession))
  const [pendingMessages, setPendingMessages] = useState([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const flight = useRef(null), attempt = useRef(null), upload = useRef(null), latest = useRef(workbench)
  const identity = useRef(userId)
  latest.current = workbench
  if (identity.current !== userId) { identity.current = userId; scope.changeTarget() }
  useEffect(() => {
    setSelectedTask(restoredTask(latest.current.activeSession)); setBusy(false); setError(''); setPendingMessages([])
    flight.current = null; attempt.current = null; upload.current = null
  }, [scope.revision, userId])
  function selectTask(task) {
    if (flight.current) return
    scope.changeTarget(); setSelectedTask(task); setError(''); attempt.current = null
  }
  function removeTask() { if (!flight.current) { scope.changeTarget(); setSelectedTask(null); setError('') } }
  async function send() {
    if (!selectedTask || flight.current) return
    const token = scope.capture()
    const draft = { task: selectedTask, rawPrompt: workbench.composer || '', prompt: (workbench.composer || '').trim(), file: workbench.selectedFile }
    if (!draft.prompt && !draft.file) { setError('请输入问题、任务或附加材料。'); return }
    if (draft.file && (draft.file.size > 2 * 1024 * 1024 || !/\.(xlsx|txt|md)$/i.test(draft.file.name))) { setError('支持 2 MiB 内的 .xlsx、.txt 或 .md 材料。'); return }
    flight.current = token; setBusy(true); setError('')
    try {
      const catalog = await listExecutionCatalog()
      if (!scope.current(token)) return
      const current = catalog.find(item => item.kind === draft.task.kind && item.id === draft.task.id)
      if (!current || current.versionId !== draft.task.versionId) throw { publicMessage: '目录已变化，请移除标签并重新选择能力。' }
      const session = await scope.ensure(current.name, token)
      if (!session || !scope.current(token)) return
      const sources = []
      if (draft.file) {
        let source = upload.current?.file === draft.file && upload.current.sessionId === session.sessionId ? upload.current.source : null
        if (!source) {
          source = await uploadExecutionSource(session.sessionId, draft.file)
          if (!scope.current(token)) return
          if (!source?.attachmentId || source.sourceAvailable !== true) throw new Error('原文材料暂不可用，请重新上传。')
          upload.current = { file: draft.file, sessionId: session.sessionId, source }
        }
        sources.push({ kind: 'file', id: source.attachmentId })
      }
      const body = { content: draft.prompt || '我附加了一份材料。', selection: { kind: current.kind, id: current.id, versionId: current.versionId }, sources }
      const fingerprint = JSON.stringify([session.sessionId, body])
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, submissionKey: crypto.randomUUID() }
      if (!scope.current(token)) return
      setPendingMessages([{ id: `skill-chat-user:${attempt.current.submissionKey}`, role: 'user', text: body.content, skillContext: { kind: current.kind, target: { name: current.name } } }, { id: `skill-chat-assistant:${attempt.current.submissionKey}`, role: 'assistant', text: '正在理解你的输入…', loading: true }])
      const result = await sendSkillConversation(session.sessionId, { ...body, submissionKey: attempt.current.submissionKey })
      if (!scope.current(token)) return
      setError('')
      if (result.action === 'execute') { setSelectedTask(null); onStarted?.(result.run) }
      if (latest.current.composer === draft.rawPrompt) { latest.current.setComposer(''); latest.current.clearComposerDraft?.() }
      if (latest.current.selectedFile === draft.file) latest.current.setSelectedFile?.(null)
      attempt.current = null; upload.current = null
      // Persisted reply/clarification and task user messages share the existing central history source.
      try { await latest.current.loadSessions?.() } catch { /* loadSessions owns its visible error state. */ }
    } catch (err) { if (scope.current(token)) setError(message(err)) }
    finally { if (flight.current === token) { flight.current = null; if (scope.current(token)) { setBusy(false); setPendingMessages([]) } } }
  }
  return { selectedTask, selectTask, removeTask, send, busy, error, pendingMessages }
}
