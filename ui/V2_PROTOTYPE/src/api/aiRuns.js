/**
 * AI Runs API 客户端（RP-047 Batch D · 消费 Batch C 冻结契约）。
 * fetch + Bearer 流式 SSE 读取（EventSource 无法附 Authorization 头）；
 * SSE 解析自含实现，不 import api/ai.js 内部函数（旧链路行为零变更）。
 * flag 关闭（503 ASYNC_RUNS_DISABLED）/ 空 / 失败一律静默降级为"无后台任务"。
 */
import { getToken } from './auth'
import { apiClient } from './client.js'
import { ApiError, NetworkError } from './errors'
import { unwrap } from './utils'

const TERMINAL_EVENT_TYPES = ['run_completed', 'run_failed', 'run_cancelled']

export function isTerminalRunEvent(eventType) {
  return TERMINAL_EVENT_TYPES.includes(eventType)
}

/**
 * 拉取当前用户活跃 Run 列表。
 * 返回 { enabled, runs, failed }：503/401 视为功能关闭，网络失败标记 failed
 * 供调用方退避重试；任何失败都不抛错、不弹 toast（D5 静默降级）。
 */
export async function listActiveRuns() {
  try {
    const payload = await apiClient.get('/ai-runs', { status: 'active' }, { suppressUnauthorizedRedirect: true })
    const data = unwrap(payload)
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : [])
    return { enabled: true, runs: items, failed: false }
  } catch (err) {
    if (err?.status === 503 || err?.status === 401) return { enabled: false, runs: [], failed: false }
    return { enabled: true, runs: [], failed: true }
  }
}

export async function getRunSnapshot(runId) {
  return unwrap(await apiClient.get(`/ai-runs/${runId}`, undefined, { suppressUnauthorizedRedirect: true }))
}

/** 明确停止（G4）：唯一允许的 cancel 触发路径是用户显式点击停止。 */
export async function cancelRun(runId) {
  return unwrap(await apiClient.post(`/ai-runs/${runId}/cancel`, {}, { suppressUnauthorizedRedirect: true }))
}

/**
 * 提交 Run（RP-047 Batch E · Step 3）。
 * POST /ai-sessions/:sessionId/runs，返回 { runId, status, eventCursor }。
 * 503 ASYNC_RUNS_DISABLED 抛错供调用方回退旧同步路径。
 */
export async function submitRun(sessionId, { submissionKey, clientMessageId, content }) {
  const payload = await apiClient.post(
    `/ai-sessions/${sessionId}/runs`,
    { submissionKey, clientMessageId, content },
    { suppressUnauthorizedRedirect: true },
  )
  return unwrap(payload)
}

/**
 * 订阅 Run 事件流（SSE 回放）。自含 fetch + Bearer + 解析：
 * - `Last-Event-ID` 头与 `after` 参数同值下发（服务端头优先，契约 D6）；
 * - 注释帧（心跳 `: heartbeat`）静默忽略；
 * - abort 只关闭本地连接（取消读取循环，不 cancel 远端任务）。
 * 不向 fetch 透传 AbortSignal：jsdom 的 AbortSignal 实例与 undici 不兼容，
 * 改由本地 aborted 标志终止读取循环，行为等价。
 * 返回 { abort }；回调：onEvent({ sequence, eventType, payload, createdAt })、
 * onClose()（流正常结束/本地中止）、onError(err)。
 */
export function subscribeRunEvents(runId, {
  after = 0,
  signal,
  onEvent = () => {},
  onClose = () => {},
  onError = () => {},
} = {}) {
  let aborted = signal?.aborted === true
  let readerRef = null
  // 本地中止：置标志并 cancel 读取器，打断挂起中的 read()
  const triggerAbort = () => {
    aborted = true
    try { readerRef?.cancel() } catch { /* noop */ }
  }
  const onExternalAbort = () => triggerAbort()
  if (signal && !aborted) signal.addEventListener('abort', onExternalAbort, { once: true })

  ;(async () => {
    try {
      const headers = { Accept: 'text/event-stream' }
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`
      const cursor = Number(after) > 0 ? Math.floor(Number(after)) : 0
      if (cursor > 0) headers['Last-Event-ID'] = String(cursor)

      const response = await fetch(`/api/v1/ai-runs/${runId}/events?after=${cursor}`, { headers })

      if (!response.ok || !response.body) {
        if (!aborted) onError(new ApiError(response.status, 'SSE_UNAVAILABLE', `事件流不可用 (${response.status})`))
        return
      }

      const reader = response.body.getReader()
      readerRef = reader
      if (aborted) {
        try { await reader.cancel() } catch { /* noop */ }
        return onClose()
      }
      const decoder = new TextDecoder()
      let buffer = ''

      const emitBlock = (block) => {
        const frame = parseSseBlock(block)
        if (frame) onEvent(frame)
      }

      while (!aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''
        blocks.forEach(emitBlock)
      }
      // 本地中止：读取循环已由 cancel 退出，直接走 onClose 语义
      if (aborted) return onClose()
      buffer += decoder.decode()
      if (buffer.trim()) emitBlock(buffer)
      onClose()
    } catch (err) {
      if (aborted || err?.name === 'AbortError') {
        onClose()
        return
      }
      onError(new NetworkError('事件流读取失败', err))
    } finally {
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  })()

  return {
    abort() {
      triggerAbort()
    },
  }
}

function parseSseBlock(block) {
  let event = 'message'
  const dataLines = []

  for (const rawLine of String(block || '').split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue // 心跳/注释帧
    const separator = rawLine.indexOf(':')
    const field = separator < 0 ? rawLine : rawLine.slice(0, separator)
    const value = separator < 0 ? '' : rawLine.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') event = value || 'message'
    if (field === 'data') dataLines.push(value)
  }

  if (!dataLines.length) return null
  const rawData = dataLines.join('\n')
  let data = {}
  try {
    data = JSON.parse(rawData)
  } catch {
    return null
  }
  return {
    sequence: typeof data.sequence === 'number' ? data.sequence : null,
    eventType: data.eventType || event,
    payload: data.payload ?? {},
    createdAt: data.createdAt || '',
  }
}
