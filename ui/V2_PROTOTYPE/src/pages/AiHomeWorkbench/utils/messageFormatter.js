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
export const TOOL_CALL_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

const TOOL_CALL_STATUSES = new Set(Object.values(TOOL_CALL_STATUS))

/** UI 事件侧的完整工具名（后端 sink 冻结词汇表） */
const TOOL_CALL_EVENT_TYPES = {
  STARTED: 'tool.call.started',
  PROGRESS: 'tool.call.progress',
  COMPLETED: 'tool.call.completed',
  FAILED: 'tool.call.failed',
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

/**
 * 把一条 tool.call.* UI 事件归约进工具调用列表，返回下一状态数组；
 * 无需变更（非工具事件、非法载荷、progress 找不到配对的 running 项）
 * 返回 null，调用方据此跳过重建，避免每个心跳都刷新整棵消息树。
 *
 * 配对键是 callIndex：AgentEvent 无 toolCallId，UI 投影侧自持序号（批次 0.5 · ②
 * 冻结的 sink 载荷形状）。完整工具参数与 resultPreview 只进事件不进列表——
 * 列表会随会话消息持久化，参数体积与模型可见面同源受约束。
 */
export function applyToolCallEventToList(calls, event) {
  const eventType = event?.eventType
  if (!Object.values(TOOL_CALL_EVENT_TYPES).includes(eventType)) return null
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : null
  if (!payload) return null
  const name = typeof payload.name === 'string' && payload.name ? payload.name : ''
  const callIndex = Number.isInteger(payload.callIndex) && payload.callIndex > 0 ? payload.callIndex : 0
  if (!name && !callIndex) return null
  const list = Array.isArray(calls) ? calls : []

  if (eventType === TOOL_CALL_EVENT_TYPES.STARTED) {
    return [...list, { name, ...(callIndex ? { callIndex } : {}), status: TOOL_CALL_STATUS.RUNNING, elapsedMs: 0 }]
  }

  const index = list.findIndex((call) => (callIndex ? call?.callIndex === callIndex : !!name && call?.name === name))
  if (index < 0) {
    // 页面中途打开 / 订阅晚于 started：终态帧自带状态，可直接补建，不丢可视化。
    if (eventType === TOOL_CALL_EVENT_TYPES.PROGRESS) return null
    if (!name) return null
    const status = eventType === TOOL_CALL_EVENT_TYPES.COMPLETED
      ? TOOL_CALL_STATUS.COMPLETED
      : TOOL_CALL_STATUS.FAILED
    return [...list, {
      name,
      ...(callIndex ? { callIndex } : {}),
      status,
      ...normalizeToolCallFields({ elapsedMs: payload.elapsedMs, errorPreview: payload.error }),
    }]
  }

  const current = list[index]
  if (eventType === TOOL_CALL_EVENT_TYPES.PROGRESS) {
    // 迟到的心跳不得把终态改回运行中，也不得给无状态项臆造运行中。
    if (current?.status !== TOOL_CALL_STATUS.RUNNING) return null
    const elapsedMs = Number.isFinite(payload.elapsedMs) && payload.elapsedMs >= 0 ? payload.elapsedMs : current.elapsedMs
    if (elapsedMs === current.elapsedMs) return null
    return list.map((call, i) => (i === index ? { ...call, elapsedMs } : call))
  }

  const status = eventType === TOOL_CALL_EVENT_TYPES.COMPLETED
    ? TOOL_CALL_STATUS.COMPLETED
    : TOOL_CALL_STATUS.FAILED
  const next = {
    ...current,
    ...(name && !current?.name ? { name } : {}),
    status,
    ...normalizeToolCallFields({ elapsedMs: payload.elapsedMs, errorPreview: payload.error }),
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return null
  return list.map((call, i) => (i === index ? next : call))
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
