import { useCallback, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

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

  const upsertSession = useCallback((session) => {
    if (!session?.sessionId) return
    setSessions((prev) => {
      const next = prev.filter((item) => item.sessionId !== session.sessionId)
      return [session, ...next]
    })
    setActiveSession(session)
  }, [])

  const loadSessions = useCallback(async (params = {}) => {
    setLoadingSessions(true)
    try {
      const payload = await apiClient.get('/ai-sessions', {
        domain: 'business_evaluation',
        ...params,
      }, { suppressUnauthorizedRedirect: true })
      const items = normalizeSessions(unwrap(payload))
      setSessions(items)
      setActiveSession((current) => current || items[0] || null)
      return items
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

  return {
    sessions,
    activeSession,
    loadingSessions,
    loadSessions,
    createSession,
    upsertSession,
    setActiveSession,
  }
}
