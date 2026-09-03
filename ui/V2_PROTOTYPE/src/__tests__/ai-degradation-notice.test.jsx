/**
 * 批次 0.5 · Part2「静默降级改响」守护测试（只覆盖异步 Run 通道的回退判定）。
 *
 * 常驻回归资产：
 * 1) 每一轮改走备用通道都必须留痕，且写明原因（503 / 404 / 网络 / 无会话 / 已闭锁）；
 * 2) 503 闭锁态必须可见且只能靠刷新恢复——不得出现自动恢复；
 * 3) 404 / 网络只影响当轮：不闭锁、下一轮仍会重新尝试快速通道；
 * 4) 409（会话有进行中任务）与正常路径零回归：不留痕、不出提示；
 * 5) 留痕只记状态码与原因，不得带对话正文。
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import { NetworkError } from '../api/errors.js'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import AiDegradationNotice from '../pages/AiHomeWorkbench/components/ChatArea/AiDegradationNotice.jsx'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import {
  AI_DEGRADATION_REASONS,
  clearAiDegradationTrace,
  readAiDegradationTrace,
  recordAiDegradation,
} from '../pages/AiHomeWorkbench/utils/degradationTrace.js'

const submitRunMock = vi.fn()
vi.mock('../api/aiRuns.js', () => ({
  submitRun: (...args) => submitRunMock(...args),
}))

// SSE 管道与本批断言无关：截断订阅，避免 jsdom 下真开 EventSource
vi.mock('../hooks/useBackgroundRuns.jsx', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useRunEventStream: () => {} }
})

function createWorkbench(overrides = {}) {
  return {
    activeSession: {
      sessionId: 'session-b05p2',
      title: '批次0.5 Part2 会话',
      workflowKey: 'free_chat',
      status: 'temporary_chat',
      messages: [],
      attachments: [],
      artifacts: [],
    },
    activeWorkflowKey: 'free_chat',
    unifiedView: { runs: [] },
    composer: '',
    selectedFile: null,
    setComposer: () => {},
    clearComposerDraft: () => {},
    setDraftBeforeLogin: () => {},
    setSelectedFile: () => {},
    loadSessions: async () => {},
    refreshUnifiedView: async () => {},
    upsertSession: () => {},
    createSession: async () => ({ sessionId: 'session-b05p2' }),
    ...overrides,
  }
}

async function send(hook, text) {
  await act(async () => {
    await hook.result.current.sendMessage(text)
  })
}

/** 备用通道应答：同步路径响应体（本批不改同步路径，只断言它被走到且留痕） */
function syncAnswerPayload(answer = '备用通道应答') {
  return { code: 0, data: { answer } }
}

describe('批次0.5·Part2 降级留痕（可查询，不含正文）', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAiDegradationTrace()
  })

  test('每条留痕带原因与时间戳，环形缓冲上限 50 条并丢弃最旧', () => {
    for (let i = 0; i < 60; i += 1) {
      recordAiDegradation(AI_DEGRADATION_REASONS.RUN_NOT_FOUND, { status: 404, code: `c${i}` })
    }
    const trace = readAiDegradationTrace()
    expect(trace).toHaveLength(50)
    expect(trace[0].code).toBe('c10')
    expect(trace[49].code).toBe('c59')
    expect(trace[49]).toMatchObject({ reason: 'run_not_found', status: 404, latched: false })
    expect(Date.parse(trace[49].at)).not.toBeNaN()
  })

  test('503 类原因标记为闭锁态，404/网络标记为单轮态', () => {
    recordAiDegradation(AI_DEGRADATION_REASONS.RUN_DISABLED, { status: 503 })
    recordAiDegradation(AI_DEGRADATION_REASONS.RUN_NETWORK, {})
    const trace = readAiDegradationTrace()
    expect(trace.map((entry) => entry.latched)).toEqual([true, false])
  })

  test('localStorage 不可写时留痕不抛错，控制台仍留下原因行', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('blocked') },
        removeItem: () => { throw new Error('blocked') },
      },
    })
    try {
      expect(() => recordAiDegradation(AI_DEGRADATION_REASONS.NO_SESSION, {})).not.toThrow()
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, ...original })
    }
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('no_session')
  })
})

describe('批次0.5·Part2 回退判定与提示状态', () => {
  let postSpy

  beforeEach(() => {
    localStorage.clear()
    clearAiDegradationTrace()
    sessionRuntimeStore.resetAllSessionViews()
    submitRunMock.mockReset()
    postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue(syncAnswerPayload())
  })

  afterEach(() => {
    postSpy.mockRestore()
  })

  test('503 闭锁：留痕 + 提示成立，且后续轮次只报「已闭锁」不自动恢复', async () => {
    submitRunMock.mockRejectedValueOnce(Object.assign(new Error('disabled'), { status: 503 }))
    const hook = renderHook(() => useChatMessages(createWorkbench()))

    await send(hook, '第一轮：看看历史估算')
    expect(hook.result.current.degradationNotice).toMatchObject({
      reason: AI_DEGRADATION_REASONS.RUN_DISABLED,
      latched: true,
    })
    let trace = readAiDegradationTrace()
    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({ reason: 'run_disabled', status: 503, latched: true })

    // 闭锁态不得自我恢复：第二轮连快速通道都不再尝试，只能靠刷新页面
    submitRunMock.mockClear()
    await send(hook, '第二轮：继续')
    expect(submitRunMock).not.toHaveBeenCalled()
    expect(hook.result.current.degradationNotice).toMatchObject({
      reason: AI_DEGRADATION_REASONS.ALREADY_DEGRADED,
      latched: true,
    })
    trace = readAiDegradationTrace()
    expect(trace).toHaveLength(2)
    expect(trace[1].reason).toBe('already_degraded')
    // 只记原因与状态码，绝不带对话正文
    expect(JSON.stringify(trace)).not.toContain('历史估算')
    expect(JSON.stringify(trace)).not.toContain('继续')
  })

  test('404 只影响当轮：留痕、提示非闭锁，下一轮仍重新尝试快速通道', async () => {
    submitRunMock.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
    const hook = renderHook(() => useChatMessages(createWorkbench()))

    await send(hook, '看看历史估算记录')
    expect(hook.result.current.degradationNotice).toMatchObject({
      reason: AI_DEGRADATION_REASONS.RUN_NOT_FOUND,
      latched: false,
    })
    expect(readAiDegradationTrace()[0]).toMatchObject({ reason: 'run_not_found', status: 404 })

    // 闸没被闭锁：第二轮照常尝试快速通道，且上一轮的当轮提示不得赖着不走
    submitRunMock.mockClear()
    submitRunMock.mockResolvedValueOnce({ runId: 'run-b05p2' })
    await send(hook, '第二轮')
    expect(submitRunMock).toHaveBeenCalledTimes(1)
    expect(hook.result.current.degradationNotice).toBeNull()
    expect(readAiDegradationTrace()).toHaveLength(1)
  })

  test('网络失败按「网络」留痕，与 404 区分', async () => {
    submitRunMock.mockRejectedValueOnce(new NetworkError('网络请求失败'))
    const hook = renderHook(() => useChatMessages(createWorkbench()))

    await send(hook, '看看历史估算记录')
    expect(hook.result.current.degradationNotice).toMatchObject({
      reason: AI_DEGRADATION_REASONS.RUN_NETWORK,
      latched: false,
    })
    expect(readAiDegradationTrace()[0].reason).toBe('run_network')
  })

  test('会话未建立按「无会话」留痕，且从未尝试快速通道', async () => {
    // 无会话的真实成因：activeSession 为空且建会话失败——只有 session.sessionId 拿不到时
    // 快速通道才压根不会被尝试（activeSession 为空时 hook 会自己建会话）。
    const hook = renderHook(() => useChatMessages(createWorkbench({
      activeSession: null,
      createSession: async () => null,
    })))

    await send(hook, '看看历史估算记录')
    expect(submitRunMock).not.toHaveBeenCalled()
    expect(hook.result.current.degradationNotice).toMatchObject({
      reason: AI_DEGRADATION_REASONS.NO_SESSION,
      latched: false,
    })
    expect(readAiDegradationTrace()[0].reason).toBe('no_session')
  })

  test('快速通道正常提交：零留痕零提示', async () => {
    submitRunMock.mockResolvedValueOnce({ runId: 'run-ok' })
    const hook = renderHook(() => useChatMessages(createWorkbench()))

    await send(hook, '看看历史估算记录')
    expect(hook.result.current.degradationNotice).toBeNull()
    expect(readAiDegradationTrace()).toEqual([])
    expect(postSpy).not.toHaveBeenCalled()
  })

  test('409 一字不改：不留痕不出提示，回显进行中任务文案', async () => {
    submitRunMock.mockRejectedValueOnce(
      Object.assign(new Error('active run'), { status: 409, code: 'SESSION_HAS_ACTIVE_RUN' }),
    )
    const hook = renderHook(() => useChatMessages(createWorkbench()))

    await send(hook, '看看历史估算记录')
    expect(readAiDegradationTrace()).toEqual([])
    expect(hook.result.current.degradationNotice).toBeNull()
    const bubble = hook.result.current.messages.find((message) => message.role === 'assistant')
    expect(bubble.text).toBe('该会话存在进行中的任务，请等待完成后再发送')
    expect(bubble.error).toBe(true)
    // 409 不回退同步路径
    expect(postSpy).not.toHaveBeenCalled()
  })
})

describe('批次0.5·Part2 降级提示文案', () => {
  test('闭锁态：说清「走了备用通道 + 影响 + 刷新恢复」，且不得出现内部词', () => {
    render(<AiDegradationNotice notice={{ reason: 'run_disabled', latched: true, at: '2026-09-03T00:00:00.000Z' }} />)
    const text = screen.getByRole('status').textContent
    expect(text).toContain('备用通道')
    expect(text).toContain('刷新页面')
    expect(text).toMatch(/更慢|慢一些/)
    expect(text).toMatch(/看不到处理过程|处理过程/)
    expect(text).not.toMatch(/同步|异步|durable|run|闭锁|降级|会话事件/i)
  })

  test('单轮态：措辞限定在「这一轮」，不谎称整页已坏', () => {
    render(<AiDegradationNotice notice={{ reason: 'run_network', latched: false, at: '2026-09-03T00:00:00.000Z' }} />)
    const text = screen.getByRole('status').textContent
    expect(text).toContain('这一轮')
    expect(text).toContain('备用通道')
    expect(text).not.toMatch(/同步|异步|durable|run|闭锁|降级/i)
  })

  test('没有降级时不渲染任何提示（正常路径零回归）', () => {
    const { container } = render(<AiDegradationNotice notice={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
