import { useCallback, useEffect, useRef, useState } from 'react'
import { listBusinessRuns, submitBusinessInput, decideBusinessAction, retryBusinessExecution } from '../../../api/businessExecutions.js'
import { cancelRun, getRunSnapshot } from '../../../api/aiRuns.js'

/** Server projections are the only run state. Local state holds requests, never workflow decisions. */
export default function useBusinessExecution(sessionId) {
  const [view, setView] = useState({ sessionId: '', runs: [] })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scope = useRef(sessionId)
  const request = useRef(0)
  const command = useRef({ sequence: 0, busy: false })
  scope.current = sessionId
  const refresh = useCallback(async () => {
    const sessionId = scope.current
    if (!sessionId) return null
    const sequence = ++request.current
    setLoading(true)
    try {
      const items = await listBusinessRuns(sessionId)
      const runs = await Promise.all(items.map(async item => {
        const snapshot = await getRunSnapshot(item.runId)
        return { ...item, status: snapshot?.run?.status ?? item.status, businessExecution: snapshot?.businessExecution }
      }))
      if (scope.current !== sessionId || request.current !== sequence) return null
      setView({ sessionId, runs: runs.filter(run => run.businessExecution) })
      setError('')
      return runs
    } catch (err) {
      if (scope.current === sessionId && request.current === sequence) setError(err?.message || '执行任务加载失败，请刷新重试')
      return null
    } finally {
      if (scope.current === sessionId && request.current === sequence) setLoading(false)
    }
  }, [])
  useEffect(() => {
    let active = true
    let timer
    scope.current = sessionId
    command.current = { sequence: command.current.sequence + 1, busy: false }
    setBusy(false); setError(''); setLoading(false)
    if (sessionId) {
      const poll = async () => {
        await refresh()
        if (active) timer = setTimeout(poll, 5000)
      }
      poll()
    }
    return () => { active = false; clearTimeout(timer); request.current++; scope.current = null }
  }, [sessionId, refresh])
  async function execute(action) {
    if (command.current.busy || !sessionId) return false
    const sequence = command.current.sequence + 1
    command.current = { sequence, busy: true }
    const isCurrent = () => scope.current === sessionId && command.current.sequence === sequence
    setBusy(true); setError('')
    try {
      await action()
      if (!isCurrent()) return false
      await refresh()
      if (!isCurrent()) return false
      return true
    } catch (err) {
      if (isCurrent()) {
        if (err?.status === 409) await refresh()
        if (!isCurrent()) return false
        setError(err?.status === 409 ? '内容已变化，已刷新任务；请查看最新内容后重新确认。' : err?.message || '操作失败，请重试')
      }
      return false
    } finally {
      if (isCurrent()) {
        command.current.busy = false
        setBusy(false)
      }
    }
  }
  return {
    runs: view.sessionId === sessionId ? view.runs : [], loading, busy, error, refresh,
    submitInput: (runId, pending, input) => execute(() => submitBusinessInput(runId, pending, input)),
    decide: (runId, pending, decision) => execute(() => decideBusinessAction(runId, pending, decision)),
    retry: (runId, input) => execute(() => retryBusinessExecution(runId, input)),
    stop: (runId) => execute(() => cancelRun(runId)),
  }
}
