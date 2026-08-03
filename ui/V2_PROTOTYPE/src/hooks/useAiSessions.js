import { useCallback, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

const ACTIVE_SESSION_STORAGE_KEY = 'wes-ai-active-session-id'

function readStoredActiveSessionId() {
  try {
    return window.localStorage?.getItem(ACTIVE_SESSION_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeStoredActiveSessionId(sessionId) {
  try {
    if (sessionId) window.localStorage?.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
    else window.localStorage?.removeItem(ACTIVE_SESSION_STORAGE_KEY)
  } catch {
    // Local storage is a convenience cache; failure must not block the workbench.
  }
}

function normalizeSessions(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.sessions)) return payload.sessions
  return []
}

export function useAiSessions() {
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsError, setSessionsError] = useState('')

  const selectActiveSession = useCallback((session) => {
    writeStoredActiveSessionId(session?.sessionId || '')
    setActiveSession(session || null)
  }, [])

  const clearSessionsError = useCallback(() => {
    setSessionsError('')
  }, [])

  const upsertSession = useCallback((session) => {
    if (!session?.sessionId) return
    setSessions((prev) => {
      const next = prev.filter((item) => item.sessionId !== session.sessionId)
      return [session, ...next]
    })
    selectActiveSession(session)
  }, [selectActiveSession])

  const loadSessions = useCallback(async (params = {}) => {
    setLoadingSessions(true)
    setSessionsError('')
    try {
      const payload = await apiClient.get('/ai-sessions', {
        domain: 'business_evaluation',
        ...params,
      }, { suppressUnauthorizedRedirect: true })
      const items = normalizeSessions(unwrap(payload))
      setSessions(items)
      setActiveSession((current) => {
        const storedId = readStoredActiveSessionId()
        const restored = items.find((item) => item.sessionId === storedId)
        const next = current && items.some((item) => item.sessionId === current.sessionId)
          ? current
          : (restored || items[0] || null)
        writeStoredActiveSessionId(next?.sessionId || '')
        return next
      })
      return items
    } catch (err) {
      const message = `AI 会话加载失败：${err.message || '请求失败'}`
      setSessionsError(message)
      throw err
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const createSession = useCallback(async (input = {}) => {
    const payload = await apiClient.post('/ai-sessions', {
      domain: 'business_evaluation',
      status: 'temporary_chat',
      workflowKey: 'free_chat',
      ...input,
    }, { suppressUnauthorizedRedirect: true })
    const session = unwrap(payload)?.session
    if (session) upsertSession(session)
    return session
  }, [upsertSession])

  const deleteSession = useCallback(async (sessionId) => {
    if (!sessionId) return false
    await apiClient.delete(`/ai-sessions/${sessionId}`, { suppressUnauthorizedRedirect: true })
    setSessions((prev) => prev.filter((item) => item.sessionId !== sessionId))
    setActiveSession((current) => {
      if (current?.sessionId === sessionId) {
        writeStoredActiveSessionId('')
        return null
      }
      return current
    })
    return true
  }, [])

  const renameSession = useCallback(async (sessionId, newTitle) => {
    if (!sessionId || !newTitle?.trim()) return null
    const payload = await apiClient.patch(`/ai-sessions/${sessionId}`, { title: newTitle.trim() }, { suppressUnauthorizedRedirect: true })
    const session = unwrap(payload)?.session
    if (session) {
      setSessions((prev) => prev.map((item) => item.sessionId === session.sessionId ? session : item))
      setActiveSession((current) => current?.sessionId === session.sessionId ? session : current)
    }
    return session
  }, [])

  return {
    sessions,
    activeSession,
    loadingSessions,
    sessionsError,
    clearSessionsError,
    loadSessions,
    createSession,
    deleteSession,
    renameSession,
    upsertSession,
    setActiveSession: selectActiveSession,
  }
}
