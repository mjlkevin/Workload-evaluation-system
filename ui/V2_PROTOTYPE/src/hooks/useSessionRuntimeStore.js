/**
 * SessionRuntimeStore（RP-047 Batch D）：sessionId 键控的会话运行时状态。
 * 消息视图 / Run 状态 / unread 标记驻留模块级单例，Shell 层后台任务
 * （useBackgroundRuns）与工作台页面共享；切换会话或离开页面不丢状态。
 * cursor 与 composer 草稿持久化到 localStorage（冻结键见工单 §6）。
 */
import { useSyncExternalStore } from 'react'

const RUN_CURSOR_STORAGE_PREFIX = 'wes-run-cursor:'
const COMPOSER_DRAFT_STORAGE_PREFIX = 'wes-ai-composer-draft:'

const listeners = new Set()
const state = {
  // sessionId → { messages: [], runStatus: '', unread: false, updatedAt: number }
  sessionViews: {},
}

function emitChange() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state.sessionViews
}

function getSessionView(sessionId) {
  if (!sessionId) return undefined
  return state.sessionViews[sessionId]
}

function getSessionMessages(sessionId) {
  return getSessionView(sessionId)?.messages
}

function setSessionMessages(sessionId, messages) {
  if (!sessionId || !Array.isArray(messages)) return
  const previous = state.sessionViews[sessionId] || {}
  state.sessionViews = {
    ...state.sessionViews,
    [sessionId]: {
      ...previous,
      messages,
      updatedAt: Date.now(),
    },
  }
  emitChange()
}

function markSessionUnread(sessionId, unread) {
  if (!sessionId) return
  const previous = state.sessionViews[sessionId] || {}
  if (Boolean(previous.unread) === Boolean(unread)) return
  state.sessionViews = {
    ...state.sessionViews,
    [sessionId]: {
      ...previous,
      unread: Boolean(unread),
      updatedAt: Date.now(),
    },
  }
  emitChange()
}

function setSessionRunStatus(sessionId, runStatus) {
  if (!sessionId) return
  const previous = state.sessionViews[sessionId] || {}
  if (previous.runStatus === runStatus) return
  state.sessionViews = {
    ...state.sessionViews,
    [sessionId]: {
      ...previous,
      runStatus: runStatus || '',
      updatedAt: Date.now(),
    },
  }
  emitChange()
}

function clearSessionView(sessionId) {
  if (!sessionId || !state.sessionViews[sessionId]) return
  const next = { ...state.sessionViews }
  delete next[sessionId]
  state.sessionViews = next
  emitChange()
}

function resetAllSessionViews() {
  if (!Object.keys(state.sessionViews).length) return
  state.sessionViews = {}
  emitChange()
}

function readRunCursor(runId) {
  if (!runId) return null
  try {
    const raw = window.localStorage?.getItem(`${RUN_CURSOR_STORAGE_PREFIX}${runId}`)
    if (raw === null || raw === undefined || raw === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeRunCursor(runId, cursor) {
  if (!runId || cursor === null || cursor === undefined) return
  try {
    window.localStorage?.setItem(`${RUN_CURSOR_STORAGE_PREFIX}${runId}`, String(cursor))
  } catch {
    // cursor 持久化失败仅降级为从头回放，不阻塞工作台。
  }
}

export function composerDraftKey(userId, sessionId) {
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${userId || 'anonymous'}:${sessionId || ''}`
}

function readComposerDraft(userId, sessionId) {
  try {
    return window.localStorage?.getItem(composerDraftKey(userId, sessionId)) || ''
  } catch {
    return ''
  }
}

function writeComposerDraft(userId, sessionId, draft) {
  try {
    const key = composerDraftKey(userId, sessionId)
    if (draft) window.localStorage?.setItem(key, draft)
    else window.localStorage?.removeItem(key)
  } catch {
    // 草稿是便捷缓存，失败不影响发送主链路。
  }
}

/**
 * 登出时清理敏感运行时缓存（cursor / composer 草稿 / 活跃会话键），
 * 并重置内存中的会话视图（避免跨用户残留）。
 * 仅清本地缓存，绝不触发后端 cancel（G4 硬约束）。
 */
function clearSensitiveRuntimeCache() {
  resetAllSessionViews()
  try {
    const storage = window.localStorage
    if (!storage) return
    const removable = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key && (key.startsWith(RUN_CURSOR_STORAGE_PREFIX) || key.startsWith(COMPOSER_DRAFT_STORAGE_PREFIX))) {
        removable.push(key)
      }
    }
    removable.forEach((key) => storage.removeItem(key))
    storage.removeItem('wes-ai-active-session-id')
  } catch {
    // 清理失败不阻塞登出流程。
  }
}

export const sessionRuntimeStore = {
  subscribe,
  getSnapshot,
  getSessionView,
  getSessionMessages,
  setSessionMessages,
  markSessionUnread,
  setSessionRunStatus,
  clearSessionView,
  resetAllSessionViews,
  readRunCursor,
  writeRunCursor,
  readComposerDraft,
  writeComposerDraft,
  clearSensitiveRuntimeCache,
}

/** 订阅会话视图集合（供 SessionRail 徽标等消费方使用）。 */
export function useSessionViews() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 订阅单个会话视图。 */
export function useSessionView(sessionId) {
  const views = useSessionViews()
  return sessionId ? views[sessionId] : undefined
}

export default sessionRuntimeStore
