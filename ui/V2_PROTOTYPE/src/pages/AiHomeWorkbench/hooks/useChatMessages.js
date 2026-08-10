import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apiClient } from '../../../api/client.js'
import { unwrap } from '../../../api/utils.js'
import { submitRun } from '../../../api/aiRuns.js'
import { useRunEventStream } from '../../../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../../../hooks/useSessionRuntimeStore.js'
import { pickArray } from '../utils/harnessPayload.js'
import { buildAttachmentUnderstanding, isExplicitReportRequest, summarizeHomeParsedFile } from '../utils/reportParser.js'
import {
  attachFormBlockToLatestAssistant,
  attachKnowledgeToolToLatestAssistant,
  mapSessionMessages,
  mergePreservedLocalFileMessages,
  normalizeClientFormBlock,
  normalizeKnowledgeTool,
  sameMessageList,
  stripFormBlockJson,
  withCurrentUserFile,
} from '../utils/messageFormatter.js'

// O8 Sprint 3A：流式事件类型（前端映射，后端事件流底座已就绪）
const STREAM_EVENT_TYPES = {
  TEXT_DELTA: 'text.delta',
  THOUGHT: 'thought',
  RUN_COMPLETED: 'run_completed',
  RUN_FAILED: 'run_failed',
  RUN_CANCELLED: 'run_cancelled',
}

/**
 * ISS-2026-08-09-003 C2（离页返回旧缓存渲染、AI 回复不显示）：后端 messages 为准的对账合并。
 * - 后端为空时保留本地视图（沿用旧守卫语义，避免空响应清屏）；
 * - 仅保留本地尾部仍未完成的占位（loading / streaming / error / action）及其前方
 *   尚未落库的用户消息；
 * - 后端已应答该轮（用户消息在库且其后有 assistant 回复）时，过期的
 *   loading / streaming 占位丢弃，error / action 反馈仍保留。
 */
function reconcileWithBackendMessages(backendMessages, localMessages) {
  if (!localMessages?.length) return backendMessages
  if (!backendMessages.length) return localMessages
  const base = mergePreservedLocalFileMessages(localMessages, backendMessages)
  const tail = []
  for (let i = localMessages.length - 1; i >= 0; i -= 1) {
    const message = localMessages[i]
    if (message.loading || message.streaming || message.error || message.action) {
      tail.unshift(message)
      continue
    }
    break
  }
  if (!tail.length) return base
  const anchor = localMessages[localMessages.length - 1 - tail.length]
  const anchorIsPendingUser = anchor?.role === 'user'
  const anchorOnBackend = !anchorIsPendingUser
    || base.some((message) => message.role === 'user' && message.text === anchor.text)
  const mergedTail = [...tail]
  if (anchorIsPendingUser && !anchorOnBackend) mergedTail.unshift(anchor)
  const lastBackendUserIndex = base.map((message) => message.role).lastIndexOf('user')
  const backendAnswered = anchorOnBackend && lastBackendUserIndex >= 0
    && base.slice(lastBackendUserIndex + 1).some((message) => message.role === 'assistant' && !message.loading)
  const finalTail = backendAnswered
    ? mergedTail.filter((message) => message.error || message.action)
    : mergedTail
  return finalTail.length ? [...base, ...finalTail] : base
}

/**
 * ISS-2026-08-10-001（回复未完成时返回占位不恢复）：重挂载恢复快照的闸门——
 * 仅当快照尾部存在未完成进行中占位（loading / streaming / error / action）时
 * 才以快照参与对账；已完结的快照不恢复（后端为准），避免陈旧本地消息在
 * 重挂载后与新生成的同文消息重复出图。
 */
function hasUnfinishedSnapshotTail(messages) {
  if (!messages?.length) return false
  const last = messages[messages.length - 1]
  return Boolean(last?.loading || last?.streaming || last?.error || last?.action)
}

/**
 * 消息列表与发送逻辑。Harness v1 显式报告流程由 useHarnessRun 提供，
 * 通过 bindHarness 注入；「文件是上下文，用户意图才触发工作流」闸门
 * （isExplicitReportRequest）保持不变。
 *
 * O8 Sprint 3A：新增 SSE 流式消费——
 * - text.delta：逐字追加到当前 assistant 消息
 * - thought：渲染为可折叠思考区块（默认收起）
 * - run_completed/run_failed/run_cancelled：终态事件清理 sending 状态
 */
export default function useChatMessages(workbench) {
  // RP-047 Batch E：模块级缓存，避免每条消息重复探测 503
  const runsDisabledRef = useRef(false)
  const [messages, setMessages] = useState([])
  // RP-047 Batch D（G1）：sending 按会话键控，A 进行中不阻塞 B 发送；
  // 对外暴露的 sending 仅反映当前激活会话，旧链路行为不变。
  const [sendingSessionKeys, setSendingSessionKeys] = useState([])
  const fileInputRef = useRef(null)
  const messagePaneRef = useRef(null)
  const harnessRef = useRef(null)
  const prevSessionIdRef = useRef('')
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const workbenchRef = useRef(workbench)
  workbenchRef.current = workbench

  // O8：当前活跃 Run 的流式消息 ID（用于 delta 追加）
  const streamingMessageIdRef = useRef(null)
  // O8：已处理的事件序号（幂等去重）
  const processedSequencesRef = useRef(new Set())

  const activeSessionKey = workbench.activeSession?.sessionId || ''
  const sending = sendingSessionKeys.includes(activeSessionKey)

  function markSending(sessionKey, value) {
    setSendingSessionKeys((prev) => {
      const has = prev.includes(sessionKey)
      if (value && !has) return [...prev, sessionKey]
      if (!value && has) return prev.filter((key) => key !== sessionKey)
      return prev
    })
  }

  // 兼容旧调用方（useHarnessRun 等）：作用于当前激活会话。
  function setSending(value) {
    markSending(workbenchRef.current?.activeSession?.sessionId || '', value)
  }

  function bindHarness(harness) {
    harnessRef.current = harness
  }

  function appendMessage(message) {
    setMessages((prev) => [...prev, message])
  }

  function patchMessage(id, patch) {
    setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, ...patch } : message)))
  }

  function replaceMessage(id, nextMessage) {
    setMessages((prev) => prev.map((message) => (message.id === id ? nextMessage : message)))
  }

  function resetMessages() {
    setMessages([])
    prevSessionIdRef.current = ''
  }

  useLayoutEffect(() => {
    const pane = messagePaneRef.current
    if (!pane || typeof pane.scrollTo !== 'function') return
    pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
  }, [messages.length, sending])

  useEffect(() => {
    if (!workbench.activeSession) return
    const currentSessionId = workbench.activeSession?.sessionId || ''
    const previousSessionId = prevSessionIdRef.current
    // G1：会话切换——先快照离开会话的当前视图（含进行中 loading/error）进 store，
    // 再恢复目标会话视图。
    if (previousSessionId && previousSessionId !== currentSessionId) {
      sessionRuntimeStore.setSessionMessages(previousSessionId, messagesRef.current)
      prevSessionIdRef.current = currentSessionId
      const storedMessages = sessionRuntimeStore.getSessionMessages(currentSessionId)
      sessionRuntimeStore.markSessionUnread(currentSessionId, false)
      // ISS-2026-08-09-003 C2（离页返回旧缓存渲染）：会话切换以后端 messages 为准
      // 与 G1 快照对账合并——快照只捕获离页瞬间本地视图，不再整体短路后端最新数据；
      // 仅保留本地仍未完成的进行中占位。
      setMessages(reconcileWithBackendMessages(mapSessionMessages(workbench.activeSession), storedMessages))
      // ISS-2026-08-09-003 C2：存在离页快照的会话切回才触发重拉——快照意味着
      // 本地视图可能停在离页瞬间，需 C1 新对象经同会话路径完成后端对账；
      // 无快照（新会话、刚经响应 upsert 的会话）直接以列表对象为准，避免
      // 全量重拉把尚未进入列表快照的新会话顶掉。
      if (storedMessages) workbenchRef.current?.loadSessions?.().catch(() => {})
      return
    }
    prevSessionIdRef.current = currentSessionId
    // 同一会话发送中不做重映射，避免覆盖 loading 消息（旧守卫保留）。
    if (sending) return
    const sessionMessages = mapSessionMessages(workbench.activeSession)
    setMessages((prev) => {
      // ISS-2026-08-09-003 C2：L124 守卫细化——本地残留 loading 占位不再无条件
      // 阻断后端最新数据；仅保留仍未完成的进行中尾部，其余以后端为准。
      // ISS-2026-08-10-001（回复未完成时返回占位不恢复）：重挂载首帧本地为空
      // 且该会话离页快照存在未完成进行中占位时，以快照作为本地视图参与同一对账
      // ——后端为准、仅保留未完成进行中占位（与 ISS-003 C2 同一合并语义）；
      // 已完结快照不恢复，避免陈旧本地消息重复出图。
      const storedMessages = prev.length
        ? undefined
        : sessionRuntimeStore.getSessionMessages(currentSessionId)
      const localBase = hasUnfinishedSnapshotTail(storedMessages) ? storedMessages : prev
      const reconciled = reconcileWithBackendMessages(sessionMessages, localBase)
      return sameMessageList(prev, reconciled) ? prev : reconciled
    })
  }, [workbench.activeSession, sending])

  // ISS-2026-08-10-001（回复未完成时返回占位不恢复）：离开工作台页面（组件
  // 卸载）时把当前会话视图（含进行中 loading 占位）写入快照——G1 快照此前只在
  // 会话切换与迟到回填点写入，离页即丢占位；重挂载经上方对账路径恢复。
  useEffect(() => {
    return () => {
      const sessionId = workbenchRef.current?.activeSession?.sessionId || ''
      const currentMessages = messagesRef.current
      if (sessionId && currentMessages.length) {
        sessionRuntimeStore.setSessionMessages(sessionId, currentMessages)
      }
    }
  }, [])

  // ISS-2026-08-09-003 C2（离页返回旧缓存渲染）：页签切回触发会话数据重拉——
  // 离页期间无 SSE 订阅的迟到结果，经 C1 新对象 + 对账合并补回渲染源。
  useEffect(() => {
    function handleVisibilityReturn() {
      if (typeof document === 'undefined' || document.hidden) return
      workbenchRef.current?.loadSessions?.().catch(() => {})
      workbenchRef.current?.refreshUnifiedView?.().catch(() => {})
    }
    document.addEventListener('visibilitychange', handleVisibilityReturn)
    return () => document.removeEventListener('visibilitychange', handleVisibilityReturn)
  }, [])

  // O8：获取当前会话关联的活跃 Run ID（用于 SSE 订阅）
  // ISS-2026-08-10-004（层 1）：统一视图 runs 契约字段为 runId（后端无 id）——
  // 此前取 .id 恒为 undefined，activeRunId 恒 ''，页面级 SSE 订阅永不建立；
  // runId 为主、id 兜底兼容，不得反向（后端契约不得新增 id 别名）。
  const activeRun = workbench.unifiedView?.runs?.find(
    (run) => run.sessionId === activeSessionKey && ['running', 'queued', 'recovering'].includes(run.status),
  )
  const activeRunId = activeRun?.runId || activeRun?.id || ''

  // O8：SSE 流式事件处理（逐字呈现 + 思考折叠）
  const handleStreamEvent = useCallback((event) => {
    const seq = event.sequence
    // 幂等：同一序号只处理一次
    if (seq !== null && seq !== undefined) {
      if (processedSequencesRef.current.has(seq)) return
      processedSequencesRef.current.add(seq)
    }

    const eventType = event.eventType
    const payload = event.payload || {}

    switch (eventType) {
      case STREAM_EVENT_TYPES.TEXT_DELTA: {
        const delta = payload.delta || payload.text || ''
        if (!delta) return
        setMessages((prev) => {
          const streamingId = streamingMessageIdRef.current
          if (streamingId && prev.some((m) => m.id === streamingId && m.role === 'assistant')) {
            // 追加到现有流式消息
            return prev.map((m) => (m.id === streamingId ? { ...m, text: m.text + delta, streaming: true } : m))
          }
          // 创建新的流式消息（替换 loading）
          const loadingMsg = prev.find((m) => m.loading && m.role === 'assistant')
          if (loadingMsg) {
            streamingMessageIdRef.current = loadingMsg.id
            return prev.map((m) => (m.id === loadingMsg.id ? { ...m, text: delta, loading: false, streaming: true } : m))
          }
          // 无 loading 时追加新消息
          const newId = `ai-stream-${Date.now()}`
          streamingMessageIdRef.current = newId
          return [...prev, { id: newId, role: 'assistant', text: delta, streaming: true }]
        })
        break
      }
      case STREAM_EVENT_TYPES.THOUGHT: {
        const thoughtText = payload.text || payload.content || ''
        if (!thoughtText) return
        setMessages((prev) => {
          const streamingId = streamingMessageIdRef.current
          if (streamingId && prev.some((m) => m.id === streamingId)) {
            return prev.map((m) => {
              if (m.id !== streamingId) return m
              const thoughts = Array.isArray(m.thoughts) ? m.thoughts : []
              return { ...m, thoughts: [...thoughts, { text: thoughtText, collapsed: true }] }
            })
          }
          return prev
        })
        break
      }
      case STREAM_EVENT_TYPES.RUN_COMPLETED:
      case STREAM_EVENT_TYPES.RUN_FAILED:
      case STREAM_EVENT_TYPES.RUN_CANCELLED: {
        // 终态事件：清理 sending 状态与流式标记
        const sessionId = payload.sessionId || activeSessionKey
        if (sessionId) markSending(sessionId, false)
        setMessages((prev) => {
          const streamingId = streamingMessageIdRef.current
          if (streamingId && prev.some((m) => m.id === streamingId)) {
            return prev.map((m) => (m.id === streamingId ? { ...m, streaming: false } : m))
          }
          return prev
        })
        streamingMessageIdRef.current = null
        break
      }
      default:
        break
    }
  }, [activeSessionKey])

  // O8：订阅当前会话的 Run 事件流
  useRunEventStream(activeRunId, {
    onEvent: handleStreamEvent,
    onClose: () => {
      // 连接关闭时清理流式标记（不清理 sending，等待终态事件或超时）
      streamingMessageIdRef.current = null
    },
    onError: () => {
      // 错误时静默降级，不阻塞用户
    },
  })

  function chooseFile() {
    fileInputRef.current?.click()
  }

  async function createStandardDraftFromFile(file) {
    const session = workbench.activeSession || await workbench.createSession({
      title: file.name,
      domain: 'standard_governance',
      workflowKey: 'standard_governance',
      status: 'standard_review',
    })
    const payload = await apiClient.post(`/ai-sessions/${session.sessionId}/standard-drafts`, {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    }, { suppressUnauthorizedRedirect: true })
    const data = unwrap(payload)
    if (data?.session) workbench.upsertSession(data.session)
  }

  function attachFile(file) {
    workbench.setSelectedFile(file || null)
    if (file && workbench.activeWorkflowKey === 'standard_governance') {
      createStandardDraftFromFile(file).catch((err) => {
        setMessages((prev) => [...prev, {
          id: `standard-error-${Date.now()}`,
          role: 'assistant',
          text: `标准文件解析暂未完成：${err.message || '请求失败'}`,
          error: true,
        }])
      })
    }
  }

  function removeSelectedFile() {
    workbench.setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function sendMessage(messageOverride) {
    const text = (typeof messageOverride === 'string' ? messageOverride : workbench.composer).trim()
    const selectedFile = workbench.selectedFile
    if ((!text && !selectedFile) || sending) return
    // G1：发送时捕获归属会话键（空串代表未落库的新会话），响应到达后按键写归属。
    let sendKey = workbench.activeSession?.sessionId || ''
    const fileSnapshot = selectedFile
      ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
      : null
    const userMessage = {
      id: `ai-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      text: text || '请解析这个文件并启动工作流。',
      file: fileSnapshot,
    }
    const loadingId = `ai-loading-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const loadingMessage = {
      id: loadingId,
      role: 'assistant',
      text: selectedFile ? '正在解析文件并调用 AI 深度分析' : '正在理解你的问题',
      loading: true,
    }
    const baseOutboundMessages = messages
      .filter((message) => !message.loading && !message.error)
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.text,
        attachments: message.file ? [message.file] : [],
      }))

    // O8：重置流式状态
    streamingMessageIdRef.current = null
    processedSequencesRef.current.clear()

    setMessages((prev) => [...prev, userMessage, loadingMessage])
    workbench.setComposer('')
    workbench.clearComposerDraft?.()
    removeSelectedFile()
    workbench.setDraftBeforeLogin(text)
    markSending(sendKey, true)
    try {
      let outboundFile = fileSnapshot
      if (selectedFile) {
        const formData = new FormData()
        formData.append('file', selectedFile)
        patchMessage(loadingId, { text: '正在提取文件结构' })
        const parsed = await apiClient.upload('/ai/parse-basic-info?allowLocalFallback=true', formData, { suppressUnauthorizedRedirect: true })
        const localAttachmentUnderstanding = buildAttachmentUnderstanding(selectedFile, parsed)
        outboundFile = {
          ...fileSnapshot,
          parsedSummary: summarizeHomeParsedFile(selectedFile, parsed),
        }
        userMessage.file = outboundFile
        patchMessage(userMessage.id, { file: outboundFile })
        // Phase 1G: 只有明确报告生成请求才进入 Harness v1 流程
        if (isExplicitReportRequest(text || '')) {
          await harnessRef.current.runExplicitReportFlow({
            text,
            fileSnapshot,
            selectedFile,
            parsed,
            userMessage,
            loadingId,
            localAttachmentUnderstanding,
          })
          return
        }
      }
      const outboundMessages = [
        ...baseOutboundMessages,
        {
          role: 'user',
          content: userMessage.text,
          attachments: outboundFile ? [outboundFile] : [],
        },
      ]
      const workflowKey = workbench.activeWorkflowKey || workbench.activeSession?.workflowKey || 'free_chat'
      const session = workbench.activeSession || await workbench.createSession({
        title: text.slice(0, 40) || fileSnapshot?.name || 'AI 工作台会话',
        workflowKey,
        status: workflowKey === 'free_chat' ? 'temporary_chat' : 'rough_estimate',
      })
      // 会话落库后将发送标记迁移到真实会话键。
      if (session?.sessionId && session.sessionId !== sendKey) {
        markSending(sendKey, false)
        sendKey = session.sessionId
        markSending(sendKey, true)
      }
      // RP-047 Batch E：尝试 Run 提交；503 回退旧同步路径
      let runSubmitted = false
      if (!runsDisabledRef.current && session?.sessionId) {
        try {
          const runResult = await submitRun(session.sessionId, {
            submissionKey: userMessage.id,
            clientMessageId: userMessage.id,
            content: userMessage.text,
          })
          if (runResult?.runId) {
            runSubmitted = true
            // Run 已入队：loading 消息保持，后续 assistant 消息经 SSE 到达
            // 由 useBackgroundRuns 消费事件流并更新会话视图
          }
        } catch (err) {
          if (err?.status === 503 || err?.code === 'ASYNC_RUNS_DISABLED') {
            runsDisabledRef.current = true
            // 503 回退旧同步路径
          } else if (err?.status === 409 || err?.code === 'SESSION_HAS_ACTIVE_RUN') {
            // 409：呈现用户可见文案，直接 return，不回退旧同步路径
            const errorMessage = {
              id: loadingId,
              role: 'assistant',
              text: '该会话存在进行中的任务，请等待完成后再发送',
              error: true,
            }
            writeArrivalMessage(sendKey, loadingId, errorMessage)
            markSending(sendKey, false)
            return
          }
          // 其他错误（404/网络等）静默回退旧同步路径，不抛错
        }
      }

      // flag off 或 Run 提交失败时回退旧同步路径（行为逐字不变）
      if (runSubmitted) {
        // ISS-2026-08-10-003（发问后顶栏角标不即时 + O8 逐字流式延迟）：提交成功后
        // 立即触发一次统一视图刷新（与页签切回同款 fire-and-forget）——顶栏角标数据源
        // 即时更新，activeRunId 经渲染重算成立，O8 页面级 SSE 订阅随之建立；
        // 仅异步成功路径，503/409/flag 关闭回退路径不触发。
        workbenchRef.current?.refreshUnifiedView?.().catch(() => {})
        // Run 已提交：不执行旧同步路径，等待 SSE 事件
        return
      }

      const payload = await apiClient.post('/ai/home-workbench/chat', {
        sessionId: session?.sessionId,
        workflowKey,
        messages: outboundMessages,
      }, { suppressUnauthorizedRedirect: true })
      const data = unwrap(payload) || {}
      if (data.session) {
        // G1：迟到响应到达时若用户已切走，只写归属会话视图并标 unread，
        // 不抢回当前渲染源；仍在当前会话时保持旧链路行为。
        const targetId = data.session.sessionId || sendKey
        const arrivedInActiveSession = (workbenchRef.current?.activeSession?.sessionId || '') === targetId
        workbench.upsertSession(data.session, { activate: arrivedInActiveSession })
        let sessionMessages = withCurrentUserFile(mapSessionMessages(data.session), userMessage)
        sessionMessages = attachFormBlockToLatestAssistant(sessionMessages, data.formBlock)
        sessionMessages = attachKnowledgeToolToLatestAssistant(sessionMessages, data.trace?.knowledgeTool)
        // Phase 1G: 附加 suggestedActions 到最后一条助手消息
        if (data.suggestedActions?.length && sessionMessages.length) {
          const lastAssistantIndex = [...sessionMessages].reverse().findIndex((m) => m.role === 'assistant')
          if (lastAssistantIndex >= 0) {
            const idx = sessionMessages.length - 1 - lastAssistantIndex
            sessionMessages[idx] = { ...sessionMessages[idx], suggestedActions: data.suggestedActions, intent: data.intent }
          }
        }
        if (sessionMessages.length) {
          if (arrivedInActiveSession) {
            const prevView = messagesRef.current
            const mergedMessages = mergePreservedLocalFileMessages(prevView, sessionMessages)
            const nextView = sameMessageList(prevView, mergedMessages) ? prevView : mergedMessages
            setMessages(nextView)
            sessionRuntimeStore.setSessionMessages(targetId, nextView)
          } else {
            sessionRuntimeStore.setSessionMessages(targetId, sessionMessages)
            sessionRuntimeStore.markSessionUnread(targetId, true)
          }
        }
      } else {
        const answerMessage = {
          id: loadingId,
          role: 'assistant',
          text: stripFormBlockJson(data.answer || 'AI 已收到，但暂未返回有效内容。'),
          model: data.model,
          suggestedActions: data.suggestedActions || [],
          intent: data.intent,
          formBlock: normalizeClientFormBlock(data.formBlock),
          knowledgeTool: normalizeKnowledgeTool(data.trace?.knowledgeTool),
        }
        writeArrivalMessage(sendKey, loadingId, answerMessage)
      }
    } catch (err) {
      // RP-025: 从 API 响应 details 中提取真实错误原因
      const apiReason = err.details?.[0]?.reason || ''
      const errorText = err.status === 401
        ? '登录已过期，请重新登录后继续发送。你的草稿已保留在当前对话里。'
        : apiReason === 'kimi_rate_limited'
          ? 'AI 服务当前繁忙（接口限流），请稍后重试。'
          : apiReason === 'required_or_env_missing'
            ? 'AI 服务未配置 API 密钥，请联系管理员在系统管理中配置。'
            : `AI 对话暂未完成：${err.message || '请求失败'}`
      const errorMessage = {
        id: loadingId,
        role: 'assistant',
        text: errorText,
        error: true,
        action: err.status === 401 ? 'login_required' : undefined,
      }
      writeArrivalMessage(sendKey, loadingId, errorMessage)
    } finally {
      markSending(sendKey, false)
    }
  }

  /**
   * G1：迟到消息（无 session 的应答或错误）按归属会话键写入。
   * 仍在当前会话（或新会话未落库）时走旧 replaceMessage；
   * 用户已切走时替换归属会话 store 视图中的 loading 消息并标 unread。
   */
  function writeArrivalMessage(ownerSessionId, loadingId, message) {
    const arrivedInActiveSession = ownerSessionId !== ''
      && (workbenchRef.current?.activeSession?.sessionId || '') === ownerSessionId
    if (arrivedInActiveSession || !ownerSessionId) {
      replaceMessage(loadingId, message)
      if (arrivedInActiveSession) sessionRuntimeStore.setSessionMessages(ownerSessionId, messagesRef.current)
      return
    }
    const ownerView = sessionRuntimeStore.getSessionMessages(ownerSessionId) || []
    if (ownerView.some((item) => item.id === loadingId)) {
      sessionRuntimeStore.setSessionMessages(
        ownerSessionId,
        ownerView.map((item) => (item.id === loadingId ? message : item)),
      )
      sessionRuntimeStore.markSessionUnread(ownerSessionId, true)
    }
  }

  // O8：切换思考区块折叠状态
  const toggleThought = useCallback((messageId, thoughtIndex) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !Array.isArray(m.thoughts)) return m
      return {
        ...m,
        thoughts: m.thoughts.map((t, i) => (i === thoughtIndex ? { ...t, collapsed: !t.collapsed } : t)),
      }
    }))
  }, [])

  function handleInteractiveOptionSelect(optionText) {
    if (!optionText || sending) return
    workbench.setComposer(optionText)
    sendMessage(optionText)
  }

  function handleInteractiveFormSubmit(messageText) {
    if (!messageText || sending) return
    workbench.setComposer(messageText)
    sendMessage(messageText)
  }

  function handleSuggestedAction(action, actionKey) {
    if (action.actionType === 'company_lookup') {
      workbench.openWorkbenchCompanyLookup(action.payload?.customerName)
    } else if (action.actionType === 'generate_requirement_report') {
      workbench.setComposer('请基于当前附件生成需求解析报告')
    } else if (action.actionType === 'submit_structured_answers') {
      workbench.setComposer('请生成补充后的需求解析报告 v2')
    } else if (action.actionType === 'open_project_list') {
      workbench.setComposer('我之前创建过哪些项目？')
    } else if (action.actionType === 'create_project_evaluation') {
      harnessRef.current?.confirmPendingAction({
        actionType: 'create_project_evaluation',
        actionId: actionKey,
        payload: action.payload || {},
      })
    } else if (action.actionType === 'send_message') {
      workbench.setComposer(action.label)
    }
  }

  async function copyDraft() {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const draft = workbench.draftBeforeLogin || lastUserMessage?.text || ''
    if (draft) await navigator.clipboard?.writeText?.(draft)
  }

  function goLogin() {
    window.location.href = '/login'
  }

  return {
    messages,
    sending,
    setSending,
    fileInputRef,
    messagePaneRef,
    bindHarness,
    appendMessage,
    patchMessage,
    replaceMessage,
    resetMessages,
    chooseFile,
    attachFile,
    removeSelectedFile,
    sendMessage,
    handleInteractiveOptionSelect,
    handleInteractiveFormSubmit,
    handleSuggestedAction,
    copyDraft,
    goLogin,
    // O8：流式 UX 暴露
    toggleThought,
  }
}
