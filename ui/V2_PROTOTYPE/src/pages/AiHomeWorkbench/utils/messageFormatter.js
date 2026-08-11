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
export function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return undefined
  const calls = value
    .filter((call) => call && typeof call === 'object' && typeof call.name === 'string' && call.name)
    .map((call) => ({
      name: call.name,
      ...(typeof call.source === 'string' && call.source ? { source: call.source } : {}),
    }))
  return calls.length ? calls : undefined
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
        text: stripFormBlockJson(message.content || ''),
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
