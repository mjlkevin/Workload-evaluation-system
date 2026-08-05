import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apiClient } from '../../../api/client.js'
import { unwrap } from '../../../api/utils.js'
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

/**
 * 消息列表与发送逻辑。Harness v1 显式报告流程由 useHarnessRun 提供，
 * 通过 bindHarness 注入；「文件是上下文，用户意图才触发工作流」闸门
 * （isExplicitReportRequest）保持不变。
 */
export default function useChatMessages(workbench) {
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef(null)
  const messagePaneRef = useRef(null)
  const harnessRef = useRef(null)

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
  }

  useLayoutEffect(() => {
    const pane = messagePaneRef.current
    if (!pane || typeof pane.scrollTo !== 'function') return
    pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
  }, [messages.length, sending])

  useEffect(() => {
    if (sending || !workbench.activeSession) return
    const sessionMessages = mapSessionMessages(workbench.activeSession)
    setMessages((prev) => {
      if (prev.some((message) => message.loading || message.error || message.action)) return prev
      if (sessionMessages.length === 0 && prev.length > 0) return prev
      const mergedMessages = mergePreservedLocalFileMessages(prev, sessionMessages)
      return sameMessageList(prev, mergedMessages) ? prev : mergedMessages
    })
  }, [workbench.activeSession, sending])

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

    setMessages((prev) => [...prev, userMessage, loadingMessage])
    workbench.setComposer('')
    removeSelectedFile()
    workbench.setDraftBeforeLogin(text)
    setSending(true)
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
      const payload = await apiClient.post('/ai/home-workbench/chat', {
        sessionId: session?.sessionId,
        workflowKey,
        messages: outboundMessages,
      }, { suppressUnauthorizedRedirect: true })
      const data = unwrap(payload) || {}
      if (data.session) {
        workbench.upsertSession(data.session)
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
          setMessages((prev) => {
            const mergedMessages = mergePreservedLocalFileMessages(prev, sessionMessages)
            return sameMessageList(prev, mergedMessages) ? prev : mergedMessages
          })
        }
      } else {
        replaceMessage(loadingId, {
          id: loadingId,
          role: 'assistant',
          text: stripFormBlockJson(data.answer || 'AI 已收到，但暂未返回有效内容。'),
          model: data.model,
          suggestedActions: data.suggestedActions || [],
          intent: data.intent,
          formBlock: normalizeClientFormBlock(data.formBlock),
          knowledgeTool: normalizeKnowledgeTool(data.trace?.knowledgeTool),
        })
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
      replaceMessage(loadingId, {
        id: loadingId,
        role: 'assistant',
        text: errorText,
        error: true,
        action: err.status === 401 ? 'login_required' : undefined,
      })
    } finally {
      setSending(false)
    }
  }

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
  }
}
