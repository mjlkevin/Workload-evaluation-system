/**
 * 前端插批（项二）：SSE 发送状态超时兜底 RED-GREEN 守护。
 *
 * 缺陷实证：useChatMessages 的 onClose 注释承诺「不清理 sending，等待终态
 * 事件或超时」，但该超时从未实现、onError 为空函数——SSE 在未收到
 * run_completed / run_failed / run_cancelled 的情况下断开时，该会话输入框
 * 永久禁用，用户无法继续对话且不知原因。
 *
 * 修复契约：
 * - 超时基准 = 「连接关闭后未收到终态事件的时长」（CLOSE_TIMEOUT_MS），
 *   不是任务总时长——后台 Run 可能长时间运行，不得误杀正常长任务；
 * - 超时后自动清理 sending（输入框恢复）并给出用户可见提示；
 * - onError 不再静默：发送中出错时用户可见感知提示；
 * - 清理只解锁前端状态，绝不发起 cancel（G2/G4 硬口径不变）。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'

let capturedStreamHandlers = null
vi.mock('../hooks/useBackgroundRuns.jsx', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRunEventStream: (runId, handlers) => {
      capturedStreamHandlers = handlers || null
    },
  }
})

function createHookWorkbench() {
  return {
    activeSession: {
      sessionId: 'session-hook',
      title: 'Hook 会话',
      workflowKey: 'free_chat',
      status: 'temporary_chat',
      messages: [],
      attachments: [],
      artifacts: [],
    },
    unifiedView: { runs: [{ runId: 'run-hook', sessionId: 'session-hook', status: 'running' }] },
    composer: '',
    selectedFile: null,
    setComposer: () => {},
    clearComposerDraft: () => {},
    setDraftBeforeLogin: () => {},
    setSelectedFile: () => {},
    loadSessions: async () => {},
    refreshUnifiedView: async () => {},
    upsertSession: () => {},
  }
}

/** 构造「发送中」hook：用户消息 + loading 占位 + sending 置位。 */
function renderSendingHook() {
  const hook = renderHook(() => useChatMessages(createHookWorkbench()))
  act(() => {
    hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '帮我评估这个项目' })
    hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    hook.result.current.setSending(true)
  })
  expect(hook.result.current.sending).toBe(true)
  return hook
}

function emitStreamEvent(frame) {
  act(() => {
    capturedStreamHandlers.onEvent(frame)
  })
}

describe('sending-timeout: 连接关闭未收终态的超时兜底', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    capturedStreamHandlers = null
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('关闭后未收终态：超时窗口内 sending 保持（不误杀等待中的终态）', () => {
    const hook = renderSendingHook()

    act(() => { capturedStreamHandlers.onClose() })
    // 窗口内（< 超时阈值）：仍等待终态事件，输入框保持禁用
    act(() => { vi.advanceTimersByTime(3000) })
    expect(hook.result.current.sending).toBe(true)
  })

  test('关闭后超时未收终态：自动清理 sending 并给出可见提示', async () => {
    const hook = renderSendingHook()

    act(() => { capturedStreamHandlers.onClose() })
    // 越过超时阈值：输入框必须恢复可用
    await act(async () => { vi.advanceTimersByTime(16000) })
    expect(hook.result.current.sending).toBe(false)
    // 用户可见提示：说明连接中断、任务可能仍在后台
    const notice = hook.result.current.messages.find((m) => m.error && m.id.startsWith('stream-interrupted'))
    expect(notice).toBeTruthy()
    expect(notice.text).toContain('连接')
    // loading 占位不得继续伪装「正在处理」
    const loading = hook.result.current.messages.find((m) => m.id === 'loading-1')
    expect(loading?.loading).toBeFalsy()
  })

  test('窗口内终态事件到达：不触发超时清理（既有终态路径不受影响）', async () => {
    const hook = renderSendingHook()

    act(() => { capturedStreamHandlers.onClose() })
    emitStreamEvent({ sequence: 1, eventType: 'run_completed', payload: { sessionId: 'session-hook' } })
    expect(hook.result.current.sending).toBe(false)

    // 越过阈值后不得追加中断提示（终态已正常收敛）
    await act(async () => { vi.advanceTimersByTime(16000) })
    expect(hook.result.current.messages.some((m) => m.id.startsWith('stream-interrupted'))).toBe(false)
    expect(hook.result.current.sending).toBe(false)
  })

  test('未处于发送中关闭连接：不产生中断提示（零噪声）', async () => {
    const hook = renderHook(() => useChatMessages(createHookWorkbench()))

    act(() => { capturedStreamHandlers.onClose() })
    await act(async () => { vi.advanceTimersByTime(16000) })

    expect(hook.result.current.messages.some((m) => m.id.startsWith('stream-interrupted'))).toBe(false)
  })

  test('onError 发送中不再静默：给出用户可见的失败感知提示', () => {
    const hook = renderSendingHook()

    act(() => { capturedStreamHandlers.onError(new Error('network down')) })

    const notice = hook.result.current.messages.find((m) => m.error && m.id.startsWith('stream-error'))
    expect(notice).toBeTruthy()
    expect(notice.text.length).toBeGreaterThan(0)
  })

  test('onError 非发送中不产生提示（零噪声）', () => {
    const hook = renderHook(() => useChatMessages(createHookWorkbench()))

    act(() => { capturedStreamHandlers.onError(new Error('network down')) })

    expect(hook.result.current.messages.some((m) => m.error)).toBe(false)
  })

  test('超时恢复后再次发送可用（输入框解锁的功能闭环）', async () => {
    const hook = renderSendingHook()

    act(() => { capturedStreamHandlers.onClose() })
    await act(async () => { vi.advanceTimersByTime(16000) })

    // sendMessage 的 sending 闸门已解锁（此处仅验证闸门状态，不发真实请求）
    expect(hook.result.current.sending).toBe(false)
  })
})
