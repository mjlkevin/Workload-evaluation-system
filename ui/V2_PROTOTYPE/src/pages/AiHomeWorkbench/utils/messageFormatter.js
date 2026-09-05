import { pickObject } from './harnessPayload.js'

/**
 * 清理消息文本中残留的 formBlock JSON 代码块。
 * 当后端未能成功提取 formBlock 或会话数据为历史存储时，
 * 防止 JSON 以代码块形式渲染到前端。
 */
export function stripFormBlockJson(text) {
  if (!text) return text
  let cleaned = text
  // 移除包含 formBlock 的 fenced code block（```json ... ``` 或 ``` ... ```）
  cleaned = cleaned.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?"formBlock"[\s\S]*?\}\s*\n?\s*```/gi, '')
  // 处理截断无闭合 ``` 的情况：从 {"formBlock": 开始到文本末尾
  const formBlockStart = cleaned.search(/\{\s*"formBlock"\s*:/)
  if (formBlockStart >= 0) {
    cleaned = cleaned.slice(0, formBlockStart)
  }
  return cleaned.trim()
}

export function normalizeClientFormBlock(value) {
  const formBlock = pickObject(value)
  return formBlock.blockId && formBlock.title && Array.isArray(formBlock.fields) ? formBlock : undefined
}

export function normalizeKnowledgeTool(value) {
  const knowledgeTool = pickObject(value)
  if (knowledgeTool.toolId !== 'knowledge_base.query_product_knowledge') return undefined
  return {
    ...knowledgeTool,
    model: knowledgeTool.model || '',
    available: knowledgeTool.available === true,
    confidence: knowledgeTool.confidence === 'high' ? 'high' : 'low',
    retrievalTriggered: knowledgeTool.retrievalTriggered === true,
    fallbackReason: knowledgeTool.fallbackReason || '',
    contextRef: knowledgeTool.contextRef || '',
  }
}

// MS3 chip 活数据链路（additive）：工具调用 / 引用记忆 trace 归一。
// 非法载荷一律归一为 undefined，缺数据时组件保持静默降级。
// 批次 0.5 · ③：状态字段（callIndex/status/elapsedMs/errorPreview）按存在才带，
// 缺状态的历史数据形状与扩展前逐字节一致（守护既有精确断言）。
// 批次 1b：`awaiting_approval` / `rejected` 是**界面侧**新增的两态，来源于服务端
// 批次 1a 落表的 tool.call.awaiting_approval / tool.call.rejected。后端镜像
// （metadata.toolCalls）只写运行中/已完成/失败三态，故这两词不会经持久化路径进来；
// 把它们并进来只让 normalizeToolCalls 的白名单更宽，不产生第二套词汇。
export const TOOL_CALL_STATUS = {
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REJECTED: 'rejected',
}

const TOOL_CALL_STATUSES = new Set(Object.values(TOOL_CALL_STATUS))

/** 收口态：进到这里的调用不再被后续帧改写状态 */
const CLOSED_TOOL_CALL_STATUSES = new Set([TOOL_CALL_STATUS.COMPLETED, TOOL_CALL_STATUS.FAILED])

/** UI 事件侧的完整工具名（后端 sink 冻结词汇表）+ 批次 1a 的审批三事件 */
const TOOL_CALL_EVENT_TYPES = {
  STARTED: 'tool.call.started',
  PROGRESS: 'tool.call.progress',
  COMPLETED: 'tool.call.completed',
  FAILED: 'tool.call.failed',
  // 批次 1a：等待确认 / 用户已拒绝（同意侧复用既有 run_action_confirmed，不新增类型）
  AWAITING_APPROVAL: 'tool.call.awaiting_approval',
  REJECTED: 'tool.call.rejected',
  CONFIRMED: 'run_action_confirmed',
}

/** 失败原因进列表前截断：列表要落进会话消息，不得被长错误堆爆 */
const MAX_ERROR_PREVIEW_CHARS = 120

function normalizeToolCallFields(call) {
  const out = {}
  if (Number.isInteger(call.callIndex) && call.callIndex > 0) out.callIndex = call.callIndex
  if (TOOL_CALL_STATUSES.has(call.status)) out.status = call.status
  if (Number.isFinite(call.elapsedMs) && call.elapsedMs >= 0) out.elapsedMs = call.elapsedMs
  if (typeof call.errorPreview === 'string' && call.errorPreview) {
    out.errorPreview = call.errorPreview.slice(0, MAX_ERROR_PREVIEW_CHARS)
  }
  return out
}

export function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return undefined
  const calls = value
    .filter((call) => call && typeof call === 'object' && typeof call.name === 'string' && call.name)
    .map((call) => ({
      name: call.name,
      ...(typeof call.source === 'string' && call.source ? { source: call.source } : {}),
      ...normalizeToolCallFields(call),
    }))
  return calls.length ? calls : undefined
}

// ============================================================
// 批次 1b · 工具参数暂存
// ============================================================
// 约束②把 `tool.call.started` 定成参数的**唯一**持久来源：审批事件只带
// (actionId, callId, ordinal, toolName)。要在按钮旁告诉用户「批准的是什么」，
// 就必须在 started→awaiting 之间把那一份参数留在手上。
// 不放进化后的列表条目：列表会随会话消息持久化，批次 0.5 的用例逐字钉死了
// 「完整工具参数不得进列表」。这里是一份有界、只驻内存、取用即读的一次性缓存，
// 上限按「一轮里不可能有几十个待批写操作」取 64。
// ============================================================

const MAX_TOOL_CALL_ARGS_CACHE = 64

/** started 与 awaiting 两侧必须用同一个键，否则参数与审批对不上 */
export function toolCallArgsKey(runId, { callId = '', name = '', callIndex = 0 } = {}) {
  return `${runId || ''}|${callId || `${name || ''}#${callIndex || ''}`}`
}

export function createToolCallArgsCache(limit = MAX_TOOL_CALL_ARGS_CACHE) {
  const entries = new Map()
  return {
    remember(key, value) {
      if (!key || value === undefined) return
      if (!entries.has(key) && entries.size >= limit) entries.delete(entries.keys().next().value)
      entries.set(key, value)
    },
    peek(key) {
      return entries.get(key)
    },
    forget(key) {
      entries.delete(key)
    },
    get size() {
      return entries.size
    },
  }
}

function lastOpenIndex(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const call = list[i]
    if (call && !CLOSED_TOOL_CALL_STATUSES.has(call.status) && predicate(call)) return i
  }
  return -1
}

function anyIndex(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) if (predicate(list[i])) return i
  return -1
}

/**
 * 把一条 tool.* / run_action_confirmed 事件归约进工具调用列表，返回下一状态数组；
 * 无需变更时返回 null，调用方据此跳过重建。
 *
 * 配对键优先级：callId → actionId → callIndex → name。批次 1a 之后多了一道
 * 「重放」形态：用户答复后 worker 会**重新发起同一次调用**，sink 的 callIndex
 * 从头计、callId 由模型重新给，因此按 callIndex 配对会把一次调用劈成两个 chip。
 * 解法不是猜，而是吸收：已经挂过审批（entry.approval 存在）且尚未收口的那一项，
 * 就是这一次调用的同一个槽位，后续帧一律就地更新它。
 * 未被问过的问题（只读工具走 allow 档）没有 approval，行为与批次 0.5 逐字一致。
 */
export function applyToolCallEventToList(calls, event, context = {}) {
  const eventType = event?.eventType
  if (!Object.values(TOOL_CALL_EVENT_TYPES).includes(eventType)) return null
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : null
  if (!payload) return null
  const runId = typeof context.runId === 'string' ? context.runId : ''
  const name = typeof payload.name === 'string' ? payload.name : ''
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  const callId = typeof payload.callId === 'string' ? payload.callId : ''
  const actionId = typeof payload.actionId === 'string' ? payload.actionId : ''
  const displayName = name || toolName
  const callIndex = Number.isInteger(payload.callIndex) && payload.callIndex > 0 ? payload.callIndex : 0
  if (!displayName && !callIndex && !callId && !actionId) return null
  const list = Array.isArray(calls) ? calls : []
  const cache = context.argsCache

  if (eventType === TOOL_CALL_EVENT_TYPES.STARTED) {
    cache?.remember?.(toolCallArgsKey(runId, { callId, name: displayName, callIndex }), payload.arguments)
    // 重放吸收：同一次被审批过的调用不新建 chip
    const absorbIndex = lastOpenIndex(list, (call) => call.approval && (!displayName || call.name === displayName))
    if (absorbIndex >= 0) {
      const current = list[absorbIndex]
      // 已拒绝的槽位保持已拒绝：模型重试被服务端拦下时，用户看到的仍是他当年的决定
      const next = {
        ...current,
        ...(displayName ? { name: displayName } : {}),
        ...(callIndex ? { callIndex } : {}),
        ...(callId ? { callId } : {}),
        status: current.status === TOOL_CALL_STATUS.REJECTED
          ? TOOL_CALL_STATUS.REJECTED
          : TOOL_CALL_STATUS.RUNNING,
        // 参数按本次 started 重新绑定（见 awaiting 分支），旧的一份先作废
        approval: { ...current.approval, ...(toolName ? { toolName } : {}) },
      }
      delete next.approval.arguments
      if (JSON.stringify(next) === JSON.stringify(current)) return null
      return list.map((call, i) => (i === absorbIndex ? next : call))
    }
    return [...list, {
      name: displayName,
      ...(callIndex ? { callIndex } : {}),
      ...(callId ? { callId } : {}),
      status: TOOL_CALL_STATUS.RUNNING,
      elapsedMs: 0,
    }]
  }

  // 服务端只在这三处带 actionId：审批请求、同意、拒绝。参数一律按 callId 回查 started。
  const argsFor = (call) => cache?.peek?.(toolCallArgsKey(runId, {
    callId: callId || call?.callId,
    name: displayName || call?.name,
    callIndex: callIndex || call?.callIndex,
  }))

  const buildApproval = (current) => {
    const cachedArgs = argsFor(current)
    return {
      actionId: actionId || current?.approval?.actionId || '',
      runId: runId || current?.approval?.runId || '',
      ...(displayName ? { toolName: displayName } : {}),
      ...(cachedArgs === undefined ? {} : { arguments: cachedArgs }),
    }
  }

  if (eventType === TOOL_CALL_EVENT_TYPES.CONFIRMED) {
    const index = anyIndex(list, (call) => actionId && call.approval?.actionId === actionId)
    if (index < 0) return null
    const current = list[index]
    const next = {
      ...current,
      // 同意之后到 worker 真正续跑之间显示「执行中」，由后续 started 帧把它坐实
      status: current.status === TOOL_CALL_STATUS.AWAITING_APPROVAL ? TOOL_CALL_STATUS.RUNNING : current.status,
      approval: { ...current.approval, approved: true },
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return null
    return list.map((call, i) => (i === index ? next : call))
  }

  let index = -1
  if (callId) index = lastOpenIndex(list, (call) => call.callId === callId)
  if (index < 0 && actionId) index = anyIndex(list, (call) => call.approval?.actionId === actionId)
  if (index < 0 && callIndex) index = lastOpenIndex(list, (call) => call.callIndex === callIndex)
  if (index < 0 && callIndex) index = anyIndex(list, (call) => call.callIndex === callIndex)
  if (index < 0 && displayName) index = lastOpenIndex(list, (call) => call.name === displayName)

  if (index < 0) {
    // 页面中途打开 / 订阅晚于 started：终态与审批帧自带状态，可直接补建，不丢可视化。
    if (eventType === TOOL_CALL_EVENT_TYPES.PROGRESS) return null
    if (!displayName) return null
    if (eventType === TOOL_CALL_EVENT_TYPES.AWAITING_APPROVAL) {
      return [...list, {
        name: displayName,
        ...(callId ? { callId } : {}),
        status: TOOL_CALL_STATUS.AWAITING_APPROVAL,
        approval: buildApproval(null),
      }]
    }
    if (eventType === TOOL_CALL_EVENT_TYPES.REJECTED) {
      return [...list, { name: displayName, ...(callId ? { callId } : {}), status: TOOL_CALL_STATUS.REJECTED, approval: buildApproval(null) }]
    }
    const status = eventType === TOOL_CALL_EVENT_TYPES.COMPLETED
      ? TOOL_CALL_STATUS.COMPLETED
      : TOOL_CALL_STATUS.FAILED
    return [...list, {
      name: displayName,
      ...(callIndex ? { callIndex } : {}),
      status,
      ...normalizeToolCallFields({ elapsedMs: payload.elapsedMs, errorPreview: payload.error }),
    }]
  }

  const current = list[index]
  if (eventType === TOOL_CALL_EVENT_TYPES.PROGRESS) {
    // 迟到的心跳不得把终态/待确认改回运行中，也不得给无状态项臆造运行中。
    if (current?.status !== TOOL_CALL_STATUS.RUNNING) return null
    const elapsedMs = Number.isFinite(payload.elapsedMs) && payload.elapsedMs >= 0 ? payload.elapsedMs : current.elapsedMs
    if (elapsedMs === current.elapsedMs) return null
    return list.map((call, i) => (i === index ? { ...call, elapsedMs } : call))
  }

  if (eventType === TOOL_CALL_EVENT_TYPES.AWAITING_APPROVAL) {
    const next = {
      ...current,
      ...(callId && !current.callId ? { callId } : {}),
      status: TOOL_CALL_STATUS.AWAITING_APPROVAL,
      approval: buildApproval(current),
    }
    return list.map((call, i) => (i === index ? next : call))
  }

  if (eventType === TOOL_CALL_EVENT_TYPES.REJECTED) {
    const next = {
      ...current,
      ...(callId && !current.callId ? { callId } : {}),
      status: TOOL_CALL_STATUS.REJECTED,
      approval: { ...buildApproval(current), rejected: true },
    }
    return list.map((call, i) => (i === index ? next : call))
  }

  // 已完成/失败：用户拒绝过的槽位保持「已拒绝」——那一轮服务端回填的失败正是拒绝本身。
  if (current.status === TOOL_CALL_STATUS.REJECTED) {
    const next = {
      ...current,
      ...normalizeToolCallFields({ elapsedMs: payload.elapsedMs, errorPreview: payload.error }),
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return null
    return list.map((call, i) => (i === index ? next : call))
  }

  const status = eventType === TOOL_CALL_EVENT_TYPES.COMPLETED
    ? TOOL_CALL_STATUS.COMPLETED
    : TOOL_CALL_STATUS.FAILED
  const next = {
    ...current,
    ...(displayName && !current?.name ? { name: displayName } : {}),
    status,
    ...normalizeToolCallFields({ elapsedMs: payload.elapsedMs, errorPreview: payload.error }),
  }
  if (next.approval) {
    // 收口后不再需要展示参数：approval 只留决策痕迹
    next.approval = { ...next.approval }
    delete next.approval.arguments
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return null
  return list.map((call, i) => (i === index ? next : call))
}

/**
 * 批次 1b · 痕迹重建：把一个 run 的工具事件序列折叠成与实时链路同形的 chip 列表。
 * 事件来自「按 run 读取工具事件」的只读接口（事实源仍是 harness_run_events），
 * 与 SSE 实时链共用同一个归约函数，因此两条路径不可能给出两种状态。
 */
export function reduceToolCallTrail(events, { runId = '' } = {}) {
  if (!Array.isArray(events)) return []
  const context = { runId, argsCache: createToolCallArgsCache() }
  let list = []
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const next = applyToolCallEventToList(list, {
      eventType: event.eventType,
      payload: event.payload,
    }, context)
    if (next !== null) list = next
  }
  return list
}

export function normalizeMemoryRef(value) {
  const ref = pickObject(value)
  const scenesCount = Number(ref.scenesCount)
  const atomsCount = Number(ref.atomsCount)
  if (!Number.isFinite(scenesCount) && !Number.isFinite(atomsCount)) return undefined
  return {
    scenesCount: Number.isFinite(scenesCount) ? scenesCount : 0,
    atomsCount: Number.isFinite(atomsCount) ? atomsCount : 0,
  }
}

/**
 * 归一会话消息 metadata 中的 suggestedActions：
 * 仅保留具备 actionType 或 label 的有效动作，确保写动作确认按钮
 * 在页面刷新 / 会话切换后仍能恢复渲染。
 */
export function normalizeSuggestedActions(value) {
  if (!Array.isArray(value)) return undefined
  const actions = value
    .filter((action) => action && typeof action === 'object' && (action.actionType || action.label))
    .map((action) => ({
      id: action.id || action.actionId || action.actionType,
      label: action.label || action.actionType,
      actionType: action.actionType,
      requiresConfirm: action.requiresConfirm === true,
      ...(action.payload && typeof action.payload === 'object' ? { payload: action.payload } : {}),
    }))
  return actions.length ? actions : undefined
}

export function mapSessionMessages(session) {
  if (!Array.isArray(session?.messages)) return []
  const attachmentsById = new Map((Array.isArray(session.attachments) ? session.attachments : [])
    .filter((attachment) => attachment?.attachmentId && attachment?.name)
    .map((attachment) => [attachment.attachmentId, attachment]))
  const artifactsById = new Map((Array.isArray(session.artifacts) ? session.artifacts : [])
    .filter((artifact) => artifact?.artifactId)
    .map((artifact) => [artifact.artifactId, artifact]))
  return session.messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message, index) => {
      const file = (Array.isArray(message.attachmentIds) ? message.attachmentIds : [])
        .map((attachmentId) => attachmentsById.get(attachmentId))
        .find(Boolean)
      const artifacts = (Array.isArray(message.artifactIds) ? message.artifactIds : [])
        .map((artifactId) => artifactsById.get(artifactId))
        .filter(Boolean)
      const metadata = pickObject(message.metadata)
      const formBlock = pickObject(metadata.formBlock)
      const knowledgeTool = normalizeKnowledgeTool(metadata.knowledgeTool)
      const toolCalls = normalizeToolCalls(metadata.toolCalls)
      const memoryRef = normalizeMemoryRef(metadata.memoryRef)
      const suggestedActions = normalizeSuggestedActions(metadata.suggestedActions)
      const intent = typeof metadata.intent === 'string' && metadata.intent ? metadata.intent : undefined
      return {
        id: message.messageId || `${session.sessionId}-${index}`,
        role: message.role,
        // 用户输入在发送入口虽已 trim，但异步回显/历史数据仍需清理尾随空白；
        // assistant 内容保留原始换行，避免破坏 Markdown 排版。
        text: stripFormBlockJson(message.role === 'user' ? (message.content || '').trimEnd() : (message.content || '')),
        // RP-056：带出后端落库时间，供气泡外时间戳展示
        createdAt: message.createdAt || undefined,
        // ISS-2026-08-08-001: 带出会话附件的 parsedSummary（存在才带），保证水合后出站消息仍携带解析上下文
        file: file
          ? { name: file.name, size: file.size, type: file.type, ...(file.parsedSummary ? { parsedSummary: file.parsedSummary } : {}) }
          : undefined,
        artifacts,
        formBlock: formBlock.blockId ? formBlock : undefined,
        knowledgeTool,
        toolCalls,
        memoryRef,
        suggestedActions,
        intent,
      }
    })
    .filter((message) => message.text)
}

export function attachFormBlockToLatestAssistant(messages, formBlock) {
  const normalized = normalizeClientFormBlock(formBlock)
  if (!normalized) return messages
  const assistantIndex = [...messages].reverse().findIndex((message) => message.role === 'assistant' && !message.loading && !message.error)
  if (assistantIndex < 0) return messages
  const targetIndex = messages.length - 1 - assistantIndex
  return messages.map((message, index) => (
    index === targetIndex ? { ...message, formBlock: normalized } : message
  ))
}

export function attachKnowledgeToolToLatestAssistant(messages, knowledgeTool) {
  const normalized = normalizeKnowledgeTool(knowledgeTool)
  if (!normalized) return messages
  const assistantIndex = [...messages].reverse().findIndex((message) => message.role === 'assistant' && !message.loading && !message.error)
  if (assistantIndex < 0) return messages
  const targetIndex = messages.length - 1 - assistantIndex
  return messages.map((message, index) => (
    index === targetIndex ? { ...message, knowledgeTool: normalized } : message
  ))
}

// MS3 chip 活数据链路：本轮 run 的 trace 携带 toolCalls / memoryRef 时附加到最后一条助手消息
export function attachTraceChipsToLatestAssistant(messages, trace) {
  const toolCalls = normalizeToolCalls(trace?.toolCalls)
  const memoryRef = normalizeMemoryRef(trace?.memoryRef)
  if (!toolCalls && !memoryRef) return messages
  const assistantIndex = [...messages].reverse().findIndex((message) => message.role === 'assistant' && !message.loading && !message.error)
  if (assistantIndex < 0) return messages
  const targetIndex = messages.length - 1 - assistantIndex
  return messages.map((message, index) => (
    index === targetIndex
      ? { ...message, ...(toolCalls ? { toolCalls } : {}), ...(memoryRef ? { memoryRef } : {}) }
      : message
  ))
}

export function sameMessageList(left, right) {
  if (left.length !== right.length) return false
  return left.every((message, index) => (
    message.role === right[index]?.role &&
    message.text === right[index]?.text &&
    message.file?.name === right[index]?.file?.name &&
    message.file?.size === right[index]?.file?.size &&
    message.file?.type === right[index]?.file?.type &&
    message.file?.parsedSummary === right[index]?.file?.parsedSummary &&
    message.formBlock?.blockId === right[index]?.formBlock?.blockId &&
    message.knowledgeTool?.contextRef === right[index]?.knowledgeTool?.contextRef &&
    JSON.stringify(message.toolCalls || null) === JSON.stringify(right[index]?.toolCalls || null) &&
    JSON.stringify(message.memoryRef || null) === JSON.stringify(right[index]?.memoryRef || null) &&
    suggestedActionKey(message) === suggestedActionKey(right[index]) &&
    (message.artifacts || []).map((artifact) => artifact.artifactId).join(',') === (right[index]?.artifacts || []).map((artifact) => artifact.artifactId).join(',')
  ))
}

function suggestedActionKey(message) {
  return (message?.suggestedActions || []).map((action) => action.id || action.actionType).join(',')
}

export function withCurrentUserFile(sessionMessages, userMessage) {
  if (!userMessage?.file) return sessionMessages
  const lastUserIndex = sessionMessages.map((message) => message.role).lastIndexOf('user')
  if (lastUserIndex < 0) return sessionMessages
  return sessionMessages.map((message, index) => (
    index === lastUserIndex && message.text === userMessage.text
      ? { ...message, file: userMessage.file }
      : message
  ))
}

export function mergePreservedLocalFileMessages(previousMessages, sessionMessages) {
  // ISS-2026-08-08-001 双保险：存量会话（后端尚未持久化 parsedSummary）回显时，
  // 若本地副本同名同文本且带 parsedSummary，把本地 file 合并进会话消息，避免解析上下文丢失。
  const enrichedSessionMessages = sessionMessages.map((item) => {
    if (!item.file?.name || item.file.parsedSummary) return item
    const localMatch = previousMessages.find((message) => (
      message.file?.name === item.file.name && message.text === item.text && message.file.parsedSummary
    ))
    return localMatch ? { ...item, file: localMatch.file } : item
  })
  const preserved = previousMessages.filter((message) => (
    message.file?.name && !enrichedSessionMessages.some((item) => item.file?.name === message.file.name && item.text === message.text)
  ))
  return preserved.length ? [...preserved, ...enrichedSessionMessages] : enrichedSessionMessages
}
