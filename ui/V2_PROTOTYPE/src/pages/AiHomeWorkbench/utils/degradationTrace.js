/**
 * 批次 0.5 · Part2：AI 应答通道降级的**留痕**侧。
 *
 * 缺陷背景：`useChatMessages` 里 503 会把 `runsDisabledRef` 单向置真，而全代码没有任何
 * 一处把它复位；该 hook 每页只创建一次（不是每会话），所以新建会话、切会话都不会恢复，
 * 唯一的恢复手段是刷新页面。404 / 网络失败同样「静默回退，不抛错」。用户端看不出任何
 * 异常，只会觉得「AI 好像笨了点」，且永远猜不到该刷新。本批只做一件事：**先让它响**。
 *
 * 留痕口径：
 * - 前端原因（503 / 404 / 网络 / 无会话 / 已闭锁）只有浏览器知道，服务端看不到，
 *   故必须落在前端；服务端走「还有没有人走老路」的量由既有请求日志与 Prometheus
 *   指标（`POST /ai/home-workbench/chat`）计量，本批不在同步路径上加任何代码。
 * - 每条只记原因码、HTTP 状态、后端 code、时间戳与是否闭锁，**绝不记对话正文**。
 * - 双通道：`console.warn`（排障时当场可读）+ 有界 localStorage 环形缓冲
 *   （刷新后仍在，可事后查询；键名见 STORAGE_KEY）。
 */

/** 降级原因码：进留痕与提示状态，改名会让历史留痕检索断裂，只增不改 */
export const AI_DEGRADATION_REASONS = {
  /** 503 / ASYNC_RUNS_DISABLED：服务端未开放快速通道，前端自此闭锁 */
  RUN_DISABLED: 'run_disabled',
  /** 404：快速通道接口不存在（例如服务端版本落后），只影响当轮 */
  RUN_NOT_FOUND: 'run_not_found',
  /** 请求未抵达服务端 */
  RUN_NETWORK: 'run_network',
  /** 其他非闭锁类失败：原因码不足以定位时保留 status/code 明细 */
  RUN_REQUEST_FAILED: 'run_request_failed',
  /** 会话尚未建立，从未尝试过快速通道 */
  NO_SESSION: 'no_session',
  /** 本轮之前已闭锁：本轮直接走备用通道 */
  ALREADY_DEGRADED: 'already_degraded',
}

/**
 * 闭锁类原因：一旦成立，本页剩余每一轮都走备用通道，只有刷新能恢复。
 * 提示必须持续可见，且不得被「新一轮开始」清掉。
 */
const LATCHED_REASONS = new Set([
  AI_DEGRADATION_REASONS.RUN_DISABLED,
  AI_DEGRADATION_REASONS.ALREADY_DEGRADED,
])

const STORAGE_KEY = 'wes.ai-workbench.degradation-trace.v1'
/** 环形缓冲上限：只为留个可查的痕迹，不做无界增长 */
const MAX_TRACE_ENTRIES = 50

export function isLatchedAiDegradation(reason) {
  return LATCHED_REASONS.has(reason)
}

function readStoredTrace() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    // 隐私模式 / 配额 / 历史脏数据：留痕降级为「只剩控制台」，绝不影响发送链路
    return []
  }
}

/**
 * 记一条降级留痕并返回该条（调用方据此设置提示状态，避免两处判定分叉）。
 * detail 只取 status / code 两个字段——传进来的 err 可能挂着正文，不得整体入档。
 */
export function recordAiDegradation(reason, detail = {}) {
  const entry = {
    reason,
    latched: isLatchedAiDegradation(reason),
    at: new Date().toISOString(),
  }
  if (Number.isFinite(detail.status)) entry.status = detail.status
  if (typeof detail.code === 'string' && detail.code) entry.code = detail.code

  // 固定前缀便于在控制台/日志里按关键字过滤；正文一律不落这里
  console.warn('[AI 应答通道改走备用]', reason, JSON.stringify(entry))

  try {
    const next = [...readStoredTrace(), entry].slice(-MAX_TRACE_ENTRIES)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (_) {
    // 见 readStoredTrace 同款口径：写失败不抛，控制台痕迹仍在
  }
  return entry
}

export function readAiDegradationTrace() {
  return readStoredTrace()
}

export function clearAiDegradationTrace() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (_) {
    // 同上：清理失败无副作用
  }
}
