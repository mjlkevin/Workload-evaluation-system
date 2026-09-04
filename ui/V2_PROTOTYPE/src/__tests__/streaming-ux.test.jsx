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
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
// ISS-2026-09-03-005：挂载真实生产路径（路由 / → HomePage → AiHomeWorkbench）。
// 原第二宿主 HomeWorkspace 已随 ISS-2026-09-03-001（用户裁决：删除）移出代码库。
import HomePage from '../pages/HomePage.jsx'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'
import { server } from './mocks/server.js'

/**
 * ISS-2026-08-10-005（思考块空窗丢弃）：hook 级测试直接捕获 useRunEventStream
 * 注册的 onEvent 回调，绕开 SSE 管道聚焦 handleStreamEvent 分支语义；
 * 其余导出保持原实现，工作台页面级用例不受影响。
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
      <MemoryRouter><HomePage /></MemoryRouter>
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

  test('ISS-2026-08-11-007: text.delta 不把 formBlock 协议 JSON 渲染为回复正文', () => {
    const { result } = renderChatHookWithLoading()
    const protocol = '\n\n```json\n{"formBlock":{"blockId":"b1","title":"补充信息","submitLabel":"提交","fields":[]}}\n```'

    emitStreamEvent({ sequence: 1, eventType: 'text.delta', payload: { delta: '请补充关键项目信息。' } })
    emitStreamEvent({ sequence: 2, eventType: 'text.delta', payload: { delta: protocol } })

    const target = result.current.messages.find((m) => m.id === 'loading-1')
    expect(target.text).toBe('请补充关键项目信息。')
    expect(target.text).not.toContain('formBlock')
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

// ============================================================
// ISS-2026-08-16-001（RUN_COMPLETED 竞态：回复不直接显示）RED 守护
// ============================================================
// 根因：projector 投影有 5s 轮询延迟，RUN_COMPLETED 事件到达时后端会话
// 可能尚未包含 assistant 回复。loadSessions 立即返回的 activeSession 无新消息，
// 对账合并后 loading 占位被保留或消息为空，用户需切页面才能看到回复。
// 修复契约：终态事件到达时，采用「延迟重试」策略——立即重拉一次，若未取到
// 回复则延迟 1s 后重试，最多 3 次，确保 projector 投影完成后消息能收敛。

describe('streaming-ux: ISS-2026-08-16-001 RUN_COMPLETED 竞态修复', () => {
  beforeEach(() => {
    sessionRuntimeStore.resetAllSessionViews()
    capturedStreamHandlers = null
  })

  test('RUN_COMPLETED 到达时若后端无 assistant 回复，应延迟重试 loadSessions', async () => {
    // 场景：projector 投影延迟，RUN_COMPLETED 到达时后端会话尚无 assistant 回复
    const workbench = createHookWorkbench()
    let loadSessionsCallCount = 0
    workbench.loadSessions = async () => {
      loadSessionsCallCount += 1
      // 前两次调用返回无 assistant 回复的会话（投影未完成）
      if (loadSessionsCallCount <= 2) {
        workbench.activeSession = {
          ...workbench.activeSession,
          messages: [
            { messageId: 'msg-u1', role: 'user', content: '请解析这个文件并启动工作流。', createdAt: '2026-08-16T00:00:01.000Z' },
          ],
        }
      } else {
        // 第三次调用返回包含 assistant 回复的会话（投影完成）
        workbench.activeSession = {
          ...workbench.activeSession,
          messages: [
            { messageId: 'msg-u1', role: 'user', content: '请解析这个文件并启动工作流。', createdAt: '2026-08-16T00:00:01.000Z' },
            { messageId: 'msg-a1', role: 'assistant', content: '已解析文件并启动工作流，正在处理...', createdAt: '2026-08-16T00:00:02.000Z' },
          ],
        }
      }
    }
    const hook = renderHook(() => useChatMessages(workbench))
    act(() => {
      hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '请解析这个文件并启动工作流。' })
      hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    })

    // 模拟 RUN_COMPLETED 到达
    emitStreamEvent({ sequence: 1, eventType: 'run_completed', payload: { sessionId: 'session-hook' } })

    // 立即调用一次 loadSessions
    expect(loadSessionsCallCount).toBe(1)

    // 等待 1.5s 后应触发第二次调用（延迟重试）
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(loadSessionsCallCount).toBe(2)

    // 再等待 1.5s 后应触发第三次调用（投影完成，停止重试）
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(loadSessionsCallCount).toBe(3)

    // 再等待 1.5s 不应再调用（已取到回复，停止重试）
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(loadSessionsCallCount).toBe(3)
  })

  test('RUN_COMPLETED 到达时若后端已有 assistant 回复，不应重试', async () => {
    // 场景：projector 投影已完成，RUN_COMPLETED 到达时后端会话已包含 assistant 回复
    const workbench = createHookWorkbench()
    let loadSessionsCallCount = 0
    workbench.loadSessions = async () => {
      loadSessionsCallCount += 1
      workbench.activeSession = {
        ...workbench.activeSession,
        messages: [
          { messageId: 'msg-u1', role: 'user', content: '请解析这个文件并启动工作流。', createdAt: '2026-08-16T00:00:01.000Z' },
          { messageId: 'msg-a1', role: 'assistant', content: '已解析文件并启动工作流，正在处理...', createdAt: '2026-08-16T00:00:02.000Z' },
        ],
      }
    }
    const hook = renderHook(() => useChatMessages(workbench))
    act(() => {
      hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '请解析这个文件并启动工作流。' })
      hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    })

    // 模拟 RUN_COMPLETED 到达
    emitStreamEvent({ sequence: 1, eventType: 'run_completed', payload: { sessionId: 'session-hook' } })

    // 立即调用一次 loadSessions
    expect(loadSessionsCallCount).toBe(1)

    // 等待 1.5s 后不应再调用（已取到回复，停止重试）
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(loadSessionsCallCount).toBe(1)
  })

  test('ISS-2026-08-16-003: 多轮会话旧回复不得视为投影完成（应继续重试）', async () => {
    // 场景实证（session 574e9040）：会话已有第一轮回复，第二轮 RUN_COMPLETED
    // 到达时投影未完成。旧终止条件「任意 assistant 回复」恒为 true，重试立即
    // 终止，loading 占位滞留直到切页。新口径以「本轮已应答」为终止条件。
    const workbench = createHookWorkbench()
    let loadSessionsCallCount = 0
    workbench.loadSessions = async () => {
      loadSessionsCallCount += 1
      const base = [
        { messageId: 'msg-u0', role: 'user', content: '第一轮问题', createdAt: '2026-08-16T00:00:01.000Z' },
        { messageId: 'msg-a0', role: 'assistant', content: '第一轮回复', createdAt: '2026-08-16T00:00:02.000Z' },
        { messageId: 'msg-u1', role: 'user', content: '请基于当前附件生成需求解析报告', createdAt: '2026-08-16T00:00:03.000Z' },
      ]
      workbench.activeSession = {
        ...workbench.activeSession,
        messages: loadSessionsCallCount === 1
          ? base
          : [...base, { messageId: 'msg-a1', role: 'assistant', content: '报告已生成', createdAt: '2026-08-16T00:00:04.000Z' }],
      }
    }
    const hook = renderHook(() => useChatMessages(workbench))
    act(() => {
      hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '请基于当前附件生成需求解析报告' })
      hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    })

    emitStreamEvent({ sequence: 1, eventType: 'run_completed', payload: { sessionId: 'session-hook' } })
    expect(loadSessionsCallCount).toBe(1)

    // 旧代码在此处不会重试（第一轮回复已存在）；新代码应延迟重试
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(loadSessionsCallCount).toBe(2)

    // 第二次已取到本轮回复，停止重试
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(loadSessionsCallCount).toBe(2)
  })

  test('RUN_COMPLETED 到达时 streaming 消息应正常清理（不破坏既有流式路径）', () => {
    const hook = renderHook(() => useChatMessages(createHookWorkbench()))
    act(() => {
      hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '你好' })
      hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    })

    // 先有 text.delta 建立 streaming 状态
    emitStreamEvent({ sequence: 1, eventType: 'text.delta', payload: { delta: '你好' } })
    // RUN_COMPLETED 到达
    emitStreamEvent({ sequence: 2, eventType: 'run_completed', payload: { sessionId: 'session-hook' } })

    const target = hook.result.current.messages.find((m) => m.id === 'loading-1')
    expect(target).toBeTruthy()
    expect(target.streaming).toBe(false)
    expect(target.loading).toBe(false)
    expect(target.text).toBe('你好')
  })
})
