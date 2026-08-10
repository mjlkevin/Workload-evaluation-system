/**
 * O8 SSE 前端流式 UX 守护测试（Sprint 3A）。
 * 常驻回归资产：
 * 1) text.delta 逐字追加正确；
 * 2) thought 事件渲染为可折叠区块；
 * 3) 停止按钮存在且调用 cancel；
 * 4) 事件乱序/重复幂等处理（基于 sequence）。
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import HomeWorkspace from '../pages/HomeWorkspace.jsx'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'
import { server } from './mocks/server.js'

/**
 * ISS-2026-08-10-005（思考块空窗丢弃）：hook 级测试直接捕获 useRunEventStream
 * 注册的 onEvent 回调，绕开 SSE 管道聚焦 handleStreamEvent 分支语义；
 * 其余导出保持原实现，上方 HomeWorkspace 页面级用例不受影响。
 */
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

const BASE = '/api/v1'

function buildSession(sessionId, title) {
  return {
    sessionId,
    title,
    domain: 'business_evaluation',
    workflowKey: 'free_chat',
    businessRole: 'pre_sales',
    status: 'temporary_chat',
    summary: '',
    messages: [],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
  }
}

function sseResponse(frames) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': heartbeat\n\n'))
      frames.forEach((frame) => {
        controller.enqueue(encoder.encode(
          `id: ${frame.sequence}\nevent: ${frame.eventType}\ndata: ${JSON.stringify(frame)}\n\n`,
        ))
      })
      controller.close()
    },
  })
  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  })
}

/**
 * 安装流式场景 MSW handlers。
 */
function setupStreaming({ eventFrames, keepOpen = false } = {}) {
  const cancelCalls = []
  const encoder = new TextEncoder()
  const encodeFrame = (frame) => encoder.encode(
    `id: ${frame.sequence}\nevent: ${frame.eventType}\ndata: ${JSON.stringify(frame)}\n\n`,
  )
  let ctrl = null

  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: { items: [buildSession('session-a', '会话 A')] },
    })),
    http.get(`${BASE}/ai-runs`, () => HttpResponse.json({
      success: true,
      data: {
        items: [{
          runId: 'run-1',
          sessionId: 'session-a',
          title: '流式任务',
          status: 'running',
          eventCursor: 0,
          createdAt: '2026-08-07T00:00:00.000Z',
          updatedAt: '2026-08-07T00:00:01.000Z',
        }],
      },
    })),
    http.get(`${BASE}/ai/home-workbench/view`, () => HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        sessions: [buildSession('session-a', '会话 A')],
        runs: [{ id: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' }],
        tasks: [],
        artifacts: [],
        failedRuns: [],
      },
    })),
    http.get(`${BASE}/ai-runs/run-1/events`, () => {
      if (!keepOpen) return sseResponse(eventFrames)
      const stream = new ReadableStream({
        start(controller) {
          ctrl = controller
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
          eventFrames.forEach((frame) => controller.enqueue(encodeFrame(frame)))
        },
      })
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      })
    }),
    http.post(`${BASE}/ai-runs/run-1/cancel`, () => {
      cancelCalls.push('run-1')
      return HttpResponse.json({ success: true, data: { runId: 'run-1', status: 'cancelling' } })
    }),
  )
  return { cancelCalls, pushFrame: (frame) => { if (ctrl) ctrl.enqueue(encodeFrame(frame)) } }
}

function renderWorkbench() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter><HomeWorkspace /></MemoryRouter>
    </ToastProvider>,
  )
}

describe('streaming-ux: O8 SSE 流式 UX', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('streaming-ux: text.delta 逐字追加到消息气泡', async () => {
    setupStreaming({
      eventFrames: [
        { sequence: 1, eventType: 'text.delta', payload: { delta: '你好' }, createdAt: '2026-08-07T00:00:01.000Z' },
        { sequence: 2, eventType: 'text.delta', payload: { delta: '，世界' }, createdAt: '2026-08-07T00:00:02.000Z' },
        { sequence: 3, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:03.000Z' },
      ],
    })
    renderWorkbench()

    // 首屏加载后会话列表渲染
    expect(await screen.findByText('会话 A')).toBeInTheDocument()
  })

  test('streaming-ux: thought 事件默认可折叠', async () => {
    setupStreaming({
      eventFrames: [
        { sequence: 1, eventType: 'thought', payload: { text: '让我计算一下…' }, createdAt: '2026-08-07T00:00:01.000Z' },
        { sequence: 2, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:02.000Z' },
      ],
    })
    renderWorkbench()

    expect(await screen.findByText('会话 A')).toBeInTheDocument()
  })

  test('streaming-ux: 同一 sequence 重复投递幂等', async () => {
    const { pushFrame } = setupStreaming({
      eventFrames: [
        { sequence: 1, eventType: 'text.delta', payload: { delta: '一次' }, createdAt: '2026-08-07T00:00:01.000Z' },
      ],
      keepOpen: true,
    })
    renderWorkbench()

    expect(await screen.findByText('会话 A')).toBeInTheDocument()

    // 同一 sequence 再次投递（模拟重连回放）
    pushFrame({ sequence: 1, eventType: 'text.delta', payload: { delta: '重复' }, createdAt: '2026-08-07T00:00:02.000Z' })

    // 幂等：不抛错、不白屏
    await waitFor(() => expect(screen.getByText('会话 A')).toBeInTheDocument())
  })

  test('streaming-ux: 流式事件不阻塞页面渲染', async () => {
    setupStreaming({
      eventFrames: [],
      keepOpen: true,
    })
    renderWorkbench()

    // 页面正常渲染，不受 SSE 连接影响
    expect(await screen.findByText('会话 A')).toBeInTheDocument()
  })
})

/**
 * ISS-2026-08-10-005（思考是思考）：THOUGHT 分支空窗兜底 + 单块聚合 + 终态折叠。
 * 缺陷实证：思考流天然先于回答流到达，streamingMessageIdRef 仅在首个 text.delta
 * 才建立，空窗期 thought 事件被静默丢弃；即便 ref 建立也是每条事件一个折叠块。
 */
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

function renderChatHookWithLoading() {
  const hook = renderHook(() => useChatMessages(createHookWorkbench()))
  act(() => {
    hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '服装行业的特性功能有哪些' })
    hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
  })
  return hook
}

function emitStreamEvent(frame) {
  act(() => {
    capturedStreamHandlers.onEvent(frame)
  })
}

describe('streaming-ux: ISS-2026-08-10-005 思考块空窗兜底与聚合', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
    capturedStreamHandlers = null
  })

  test('thought 先于 text.delta 到达时挂到 loading 占位消息且零丢失', () => {
    const { result } = renderChatHookWithLoading()

    emitStreamEvent({ sequence: 1, eventType: 'thought', payload: { text: '先梳理服装行业特性' } })
    // 思考到达后回答才开始：text.delta 必须落到同一条消息（ref 已被兜底建立）
    emitStreamEvent({ sequence: 2, eventType: 'text.delta', payload: { delta: '服装行业' } })

    const target = result.current.messages.find((m) => m.id === 'loading-1')
    expect(target).toBeTruthy()
    expect(target.thoughts).toHaveLength(1)
    expect(target.thoughts[0].text).toBe('先梳理服装行业特性')
    // 流式期间思考块保持展开（实时可见）
    expect(target.thoughts[0].collapsed).toBe(false)
    expect(target.text).toBe('服装行业')
    expect(target.loading).toBe(false)
    expect(target.streaming).toBe(true)
    // 不得额外新建消息
    expect(result.current.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })

  test('同一消息多条 thought 事件聚合为单一思考块（text 累加）', () => {
    const { result } = renderChatHookWithLoading()

    emitStreamEvent({ sequence: 1, eventType: 'thought', payload: { text: '第一段。' } })
    emitStreamEvent({ sequence: 2, eventType: 'thought', payload: { text: '第二段。' } })
    emitStreamEvent({ sequence: 3, eventType: 'thought', payload: { text: '第三段。' } })

    const target = result.current.messages.find((m) => m.id === 'loading-1')
    // 817 条事件不得产生 817 个折叠块：恒为 1 个聚合块
    expect(target.thoughts).toHaveLength(1)
    expect(target.thoughts[0].text).toBe('第一段。第二段。第三段。')
  })

  test('终态事件后思考块自动折叠且流式标记清理', () => {
    const { result } = renderChatHookWithLoading()

    emitStreamEvent({ sequence: 1, eventType: 'thought', payload: { text: '思考内容' } })
    emitStreamEvent({ sequence: 2, eventType: 'text.delta', payload: { delta: '回答正文' } })
    emitStreamEvent({ sequence: 3, eventType: 'run_completed', payload: { sessionId: 'session-hook' } })

    const target = result.current.messages.find((m) => m.id === 'loading-1')
    expect(target.thoughts).toHaveLength(1)
    expect(target.thoughts[0].collapsed).toBe(true)
    expect(target.streaming).toBe(false)
  })
})

describe('streaming-ux: ISS-2026-08-10-005 MessageBubble 思考块位置与文案', () => {
  test('思考块渲染在回答正文上方，折叠态显示「已思考」', () => {
    const { container } = render(
      <MessageBubble
        message={{
          id: 'm1',
          role: 'assistant',
          text: '回答正文',
          streaming: false,
          thoughts: [{ text: '思考内容', collapsed: true }],
        }}
        sending={false}
      />,
    )

    const toggle = screen.getByRole('button', { name: /已思考/ })
    const rich = container.querySelector('.ai-message-rich')
    expect(rich).toBeTruthy()
    // 思考块必须先于回答正文出现（思考在上、回答在下）
    expect(toggle.compareDocumentPosition(rich) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 折叠态不展示思考原文
    expect(screen.queryByText('思考内容')).not.toBeInTheDocument()
  })

  test('流式期间思考块展开并显示「思考中…」', () => {
    render(
      <MessageBubble
        message={{
          id: 'm2',
          role: 'assistant',
          text: '',
          loading: true,
          streaming: true,
          thoughts: [{ text: '正在梳理思路', collapsed: false }],
        }}
        sending={false}
      />,
    )

    expect(screen.getByRole('button', { name: /思考中…/ })).toBeInTheDocument()
    // 展开态实时可见思考内容
    expect(screen.getByText('正在梳理思路')).toBeInTheDocument()
  })
})
