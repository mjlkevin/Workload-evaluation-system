/**
 * BackgroundRunProvider（RP-047 Batch D · Step 2，G2 后台继续）。
 * 常驻 Shell 层（仅登录态挂载）：
 * - 维护活跃 Run 摘要列表（listActiveRuns 刷新 + 失败指数退避 5s→60s）；
 * - ISS-2026-08-10-002：context 暴露节流刷新入口 notifyRunsChanged（新 run 创建时由页面侧触发）；
 * - 每个活跃 Run 一条 provider 级 SSE 订阅；事件写 cursor、状态变更同步摘要；
 * - 终态事件触发一次性通知（notifiedRef 去重）并刷新列表；
 * - 卸载/离页只 abort 本地连接，绝不发起 cancel（G2/G4 硬口径）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { cancelRun as apiCancelRun, getRunSnapshot, isTerminalRunEvent, listActiveRuns, subscribeRunEvents } from '../api/aiRuns.js'
import { sessionRuntimeStore } from './useSessionRuntimeStore.js'

const BackgroundRunsContext = createContext(null)

const RETRY_BASE_MS = 5000
const RETRY_MAX_MS = 60000

// ISS-2026-08-10-002：notifyRunsChanged 节流窗口（leading + 至多一次 trailing）
const NOTIFY_THROTTLE_MS = 1500

const TERMINAL_KIND = {
  run_completed: 'completed',
  run_failed: 'failed',
  run_cancelled: 'cancelled',
}

// 终态 Run 状态：列表收敛后不得被合并逻辑清除（SessionRail 徽标依赖）
const TERMINAL_RUN_STATUS = new Set(['completed', 'failed', 'cancelled'])

const TERMINAL_TEXT = {
  run_completed: (title) => `${title} 已完成`,
  run_failed: (title) => `${title} 执行失败`,
  run_cancelled: (title) => `${title} 已取消`,
}

export function BackgroundRunProvider({ children }) {
  const [runs, setRuns] = useState([])
  const [enabled, setEnabled] = useState(true)
  const [notifications, setNotifications] = useState([])

  const mountedRef = useRef(true)
  const runsRef = useRef(runs)
  runsRef.current = runs
  const subscriptionsRef = useRef(new Map()) // runId -> { abort }
  const eventListenersRef = useRef(new Map()) // runId -> Set<{ onEvent, onClose, onError }>
  const snapshotFetchedRef = useRef(new Set()) // 恢复序列：snapshot 每 run 只读一次
  const mergedSessionsRef = useRef(new Set())  // 已合并进 store 的 sessionId
  const notifiedRef = useRef(new Set())     // `${runId}:${eventType}` 一次性通知去重
  const retryDelayRef = useRef(RETRY_BASE_MS)
  const timersRef = useRef([])
  const lastRunsNotifyRef = useRef(0)
  const trailingNotifyPendingRef = useRef(false)

  const scheduleTimer = useCallback((fn, delay) => {
    if (!mountedRef.current) return
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter((item) => item !== timer)
      if (mountedRef.current) fn()
    }, delay)
    timersRef.current.push(timer)
  }, [])

  /** 刷新活跃列表；failed 时指数退避重试（D5），flag 关闭静默降级为无任务。 */
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return
    const result = await listActiveRuns()
    if (!mountedRef.current) return
    setEnabled(result.enabled)
    setRuns(result.runs)
    if (result.failed) {
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS)
      scheduleTimer(refresh, delay)
    } else {
      retryDelayRef.current = RETRY_BASE_MS
    }
  }, [scheduleTimer])

  /**
   * ISS-2026-08-10-002（右下角全局角标不计数）：新 run 创建通知入口（方案 A）。
   * 工作台提交成功 / 统一视图发现新 runId 时调用一次；1.5s 节流（leading 立即刷新 +
   * 窗口期内至多一次 trailing，调用不丢）+ mounted 守卫，复用现有 refresh（含失败退避）。
   * 只触发列表刷新，绝不发起 cancel（G2/G4 硬口径不变）。
   */
  const notifyRunsChanged = useCallback(() => {
    if (!mountedRef.current) return
    const now = Date.now()
    const elapsed = now - lastRunsNotifyRef.current
    if (elapsed >= NOTIFY_THROTTLE_MS) {
      lastRunsNotifyRef.current = now
      refresh()
      return
    }
    if (trailingNotifyPendingRef.current) return
    trailingNotifyPendingRef.current = true
    scheduleTimer(() => {
      trailingNotifyPendingRef.current = false
      lastRunsNotifyRef.current = Date.now()
      refresh()
    }, NOTIFY_THROTTLE_MS - elapsed)
  }, [refresh, scheduleTimer])

  const handleEvent = useCallback((runId, event) => {
    if (event.sequence) sessionRuntimeStore.writeRunCursor(runId, event.sequence)
    if (event.eventType === 'run_status_changed' && event.payload?.status) {
      const nextStatus = event.payload.status
      setRuns((prev) => prev.map((run) => (run.runId === runId ? { ...run, status: nextStatus } : run)))
    }

    if (isTerminalRunEvent(event.eventType)) {
      const notifyKey = `${runId}:${event.eventType}`
      if (notifiedRef.current.has(notifyKey)) return
      notifiedRef.current.add(notifyKey)
      const run = runsRef.current.find((item) => item.runId === runId)
      const title = run?.title || runId
      // 终态写入会话视图并标记未读：供 SessionRail 已完成未读/失败/已取消徽标展示
      if (run?.sessionId) {
        sessionRuntimeStore.setSessionRunStatus(run.sessionId, TERMINAL_KIND[event.eventType])
        sessionRuntimeStore.markSessionUnread(run.sessionId, true)
      }
      setNotifications((prev) => [...prev, {
        id: notifyKey,
        runId,
        // RP-058：携带 sessionId 供通知点击跳转对应会话
        sessionId: run?.sessionId || '',
        kind: TERMINAL_KIND[event.eventType],
        text: TERMINAL_TEXT[event.eventType](title),
      }])
      refresh()
    }

    // 广播给页面级监听器（useRunEventStream）；终态先写入 runtime store，
    // 再通知消息区对账，避免当前会话的 unread 清除被终态写入覆盖。
    const listeners = eventListenersRef.current.get(runId)
    if (listeners) listeners.forEach((listener) => listener.onEvent?.(event))
  }, [refresh])

  const handleEventRef = useRef(handleEvent)
  handleEventRef.current = handleEvent

  const addRunEventListener = useCallback((runId, listener) => {
    if (!runId) return () => {}
    let listeners = eventListenersRef.current.get(runId)
    if (!listeners) {
      listeners = new Set()
      eventListenersRef.current.set(runId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  // 订阅协调：新出现的活跃 Run 建立唯一 SSE，消失的 Run 只 abort 本地连接（零 cancel）。
  useEffect(() => {
    const activeIds = new Set(runs.map((run) => run.runId))
    for (const [runId, subscription] of subscriptionsRef.current) {
      if (!activeIds.has(runId)) {
        subscription.abort()
        subscriptionsRef.current.delete(runId)
      }
    }
    for (const run of runs) {
      if (subscriptionsRef.current.has(run.runId)) continue
      const { runId } = run
      subscriptionsRef.current.set(runId, subscribeRunEvents(runId, {
        after: sessionRuntimeStore.readRunCursor(runId) || 0,
        onEvent: (event) => handleEventRef.current(runId, event),
        onClose: () => {
          subscriptionsRef.current.delete(runId)
          const listeners = eventListenersRef.current.get(runId)
          if (listeners) listeners.forEach((listener) => listener.onClose?.())
        },
        onError: (err) => {
          const listeners = eventListenersRef.current.get(runId)
          if (listeners) listeners.forEach((listener) => listener.onError?.(err))
        }, // D5 静默降级：等待下一次列表刷新再重建
      }))
    }
  }, [runs])

  // 恢复序列（spec §12.4）：Run 按 sessionId 合并进 store；snapshot 每 run 读一次，
  // 状态以 snapshot 为准（waiting/queued 等列表未携带的精确态）。
  useEffect(() => {
    const sessionStatus = new Map()
    runs.forEach((run) => {
      if (run.sessionId) sessionStatus.set(run.sessionId, run.status)
    })
    for (const previousSessionId of mergedSessionsRef.current) {
      if (sessionStatus.has(previousSessionId)) continue
      // 终态状态（completed/failed/cancelled）保留给徽标展示，仅清理活跃态
      const storedStatus = sessionRuntimeStore.getSessionView(previousSessionId)?.runStatus
      if (!storedStatus || !TERMINAL_RUN_STATUS.has(storedStatus)) {
        sessionRuntimeStore.setSessionRunStatus(previousSessionId, '')
      }
    }
    mergedSessionsRef.current = new Set(sessionStatus.keys())
    sessionStatus.forEach((status, sessionId) => sessionRuntimeStore.setSessionRunStatus(sessionId, status))

    runs.forEach((run) => {
      if (snapshotFetchedRef.current.has(run.runId)) return
      snapshotFetchedRef.current.add(run.runId)
      getRunSnapshot(run.runId)
        .then((snapshot) => {
          const snapshotStatus = snapshot?.run?.status
          if (!mountedRef.current || !snapshotStatus) return
          setRuns((prev) => prev.map((item) => (item.runId === run.runId ? { ...item, status: snapshotStatus } : item)))
        })
        .catch(() => {}) // ISS-2026-08-18-005（档 3）：快照读取失败降级为列表状态，不阻塞恢复——快照仅用于终态对齐，失败时保持列表既有状态即可，可静默
    })
  }, [runs])

  // 挂载即刷新；卸载清理定时器与全部本地 SSE（G2：只关连接，不取消任务）。
  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => {
      mountedRef.current = false
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current = []
      for (const subscription of subscriptionsRef.current.values()) subscription.abort()
      subscriptionsRef.current.clear()
    }
  }, [refresh])

  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id))
  }, [])

  /** G4 唯一 cancel 入口：仅供用户显式点击停止时调用。 */
  const cancelRun = useCallback(async (runId) => {
    const result = await apiCancelRun(runId)
    await refresh()
    return result
  }, [refresh])

  const value = useMemo(() => ({
    runs,
    activeCount: runs.length,
    notifications,
    enabled,
    dismissNotification,
    cancelRun,
    addRunEventListener,
    notifyRunsChanged,
  }), [runs, notifications, enabled, dismissNotification, cancelRun, addRunEventListener, notifyRunsChanged])

  return (
    <BackgroundRunsContext.Provider value={value}>
      {children}
    </BackgroundRunsContext.Provider>
  )
}

export function useBackgroundRuns() {
  const context = useContext(BackgroundRunsContext)
  if (!context) {
    return { runs: [], activeCount: 0, notifications: [], enabled: false, dismissNotification: () => {}, cancelRun: async () => {}, addRunEventListener: () => () => {}, notifyRunsChanged: () => {} }
  }
  return context
}

/**
 * 页面级 Run 事件流订阅：复用 provider 拥有的唯一 SSE 连接（广播式），
 * 避免并行连接竞争 cursor；组件卸载仅注销监听，不关连接、零 cancel。
 */
export function useRunEventStream(runId, { onEvent, onClose, onError } = {}) {
  const { addRunEventListener } = useBackgroundRuns()
  const callbacksRef = useRef({ onEvent, onClose, onError })
  callbacksRef.current = { onEvent, onClose, onError }

  useEffect(() => {
    if (!runId) return undefined
    return addRunEventListener(runId, {
      onEvent: (event) => callbacksRef.current.onEvent?.(event),
      onClose: () => callbacksRef.current.onClose?.(),
      onError: (err) => callbacksRef.current.onError?.(err),
    })
  }, [runId, addRunEventListener])
}
