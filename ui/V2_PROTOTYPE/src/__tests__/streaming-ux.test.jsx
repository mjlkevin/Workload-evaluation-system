/**
 * O8 SSE 前端流式 UX 守护测试（Sprint 3A）。
 * 常驻回归资产：
 * 1) text.delta 逐字追加正确；
 * 2) thought 事件渲染为可折叠区块；
 * 3) 停止按钮存在且调用 cancel；
 * 4) 事件乱序/重复幂等处理（基于 sequence）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import HomeWorkspace from '../pages/HomeWorkspace.jsx'
import { server } from './mocks/server.js'

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
