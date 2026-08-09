import { useCallback, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'
import { sessionRuntimeStore } from './useSessionRuntimeStore.js'

const ACTIVE_SESSION_STORAGE_KEY = 'wes-ai-active-session-id'

// E1 删除守护：旧 DELETE 端点命中活动 Run（409 SESSION_HAS_ACTIVE_RUN）时的冻结文案（工单 §6）
const SESSION_HAS_ACTIVE_RUN_MESSAGE = '该会话仍有后台任务运行中，请先停止任务。'

// 终态 Run 状态：进入会话查看后清除徽标（已完成未读/失败/已取消为待阅信号）
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled']

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
    if (session?.sessionId) {
      // 进入会话即视为已阅：清除未读标记与终态徽标（spec §12.2）
      sessionRuntimeStore.markSessionUnread(session.sessionId, false)
      const runStatus = sessionRuntimeStore.getSessionView(session.sessionId)?.runStatus
      if (TERMINAL_RUN_STATUSES.includes(runStatus)) {
        sessionRuntimeStore.setSessionRunStatus(session.sessionId, '')
      }
    }
    setActiveSession(session || null)
  }, [])

  const clearSessionsError = useCallback(() => {
    setSessionsError('')
  }, [])

  // RP-047 Batch D：跨会话迟到响应只更新列表不抢占当前渲染源（activate=false）。
  const upsertSession = useCallback((session, { activate = true } = {}) => {
    if (!session?.sessionId) return
    setSessions((prev) => {
      const next = prev.filter((item) => item.sessionId !== session.sessionId)
      return [session, ...next]
    })
    if (activate) selectActiveSession(session)
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
        // ISS-2026-08-09-003 C1（离页返回旧缓存渲染、AI 回复不显示）：当前会话仍在
        // 新列表时换用本次重拉的同 id 对象——旧对象 messages 停在发送时刻，会把
        // 后端新写入的 assistant 回复挡在渲染源之外；后端最新数据为准。
        const next = current && items.some((item) => item.sessionId === current.sessionId)
          ? items.find((item) => item.sessionId === current.sessionId)
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
    try {
      await apiClient.delete(`/ai-sessions/${sessionId}`, { suppressUnauthorizedRedirect: true })
    } catch (err) {
      // E1：活动 Run 删除冲突收敛为冻结文案，由删除确认弹窗展示
      // （旧端点 409 语义单一：SESSION_HAS_ACTIVE_RUN，见 E1 后端接线）
      if (err?.status === 409) {
        throw new Error(SESSION_HAS_ACTIVE_RUN_MESSAGE)
      }
      throw err
    }
    sessionRuntimeStore.clearSessionView(sessionId)
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
