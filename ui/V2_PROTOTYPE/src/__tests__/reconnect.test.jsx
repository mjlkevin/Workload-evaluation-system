/**
 * G3 重连守护测试（RP-047 Batch D · Step 3）。
 * 常驻回归资产：刷新/重登按 spec §12.4 恢复序列——
 * 1) 模拟刷新（store 重建）后从持久 cursor 续订，事件不丢不重；
 * 2) 恢复序列将 Run 按 sessionId 合并进 store 并读取 snapshot；
 * 3) 登出清理敏感缓存（cursor/草稿/活跃会话键）但零 cancel。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import Shell from '../components/Layout/Shell.jsx'
import { useBackgroundRuns, useRunEventStream } from '../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'
const TEST_USER = { id: 'u3', username: 'tester', role: 'admin' }

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

function frame(sequence, eventType = 'run_status_changed') {
  return { sequence, eventType, payload: { status: 'running' }, createdAt: `2026-08-07T00:00:0${sequence}.000Z` }
}

function buildActiveRun(overrides = {}) {
  return {
    runId: 'run-1',
    sessionId: 'session-a',
    title: '后台任务 A',
    status: 'running',
    eventCursor: 0,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:01.000Z',
    ...overrides,
  }
}

/**
 * 安装 G3 场景 handlers。
 * eventFrames：忠实回放语义——只返回 sequence > after 的帧。
 * sseRequestAfters：记录每次事件订阅请求携带的 after（断言续订游标）。
 */
function setupReconnect({ listResponses, eventFrames, snapshotStatus, sseRequestAfters }) {
  const cancelCalls = []
  const snapshotCalls = []
  let listCallCount = 0
  server.use(
    http.get(`${BASE}/ai-runs`, () => {
      const items = listResponses[Math.min(listCallCount, listResponses.length - 1)]
      listCallCount += 1
      return HttpResponse.json({ success: true, data: { items } })
    }),
    http.get(`${BASE}/ai-runs/run-1/events`, ({ request }) => {
      const url = new URL(request.url)
      const after = Number(url.searchParams.get('after') || 0)
      sseRequestAfters.push(after)
      return sseResponse(eventFrames.filter((item) => item.sequence > after))
    }),
    http.get(`${BASE}/ai-runs/run-1`, () => {
      snapshotCalls.push('run-1')
      return HttpResponse.json({
        success: true,
        data: {
          run: { runId: 'run-1', status: snapshotStatus || 'running' },
          attempt: null,
          checkpoint: null,
          output: null,
        },
      })
    }),
    http.post(`${BASE}/ai-runs/run-1/cancel`, () => {
      cancelCalls.push('run-1')
      return HttpResponse.json({ success: true, data: { runId: 'run-1', status: 'cancelling' } })
    }),
  )
  return { cancelCalls, snapshotCalls }
}

function ReconnectProbe({ onEvent }) {
  const { activeCount } = useBackgroundRuns()
  useRunEventStream('run-1', { onEvent })
  return <div>探针 · 活跃任务 {activeCount}</div>
}

function renderShellApp(probeProps = {}) {
  return render(
    <MemoryRouter initialEntries={['/ai']}>
      <Shell currentUser={TEST_USER}>
        <Routes>
          <Route path="/ai" element={<ReconnectProbe {...probeProps} />} />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </Shell>
    </MemoryRouter>,
  )
}

describe('reconnect: G3 重连与恢复', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('reconnect: 模拟刷新后从持久 cursor 续订，事件不丢不重', async () => {
    const sseRequestAfters = []
    const { cancelCalls } = setupReconnect({
      listResponses: [[buildActiveRun()]],
      // 阶段 A 服务端只推到 seq2（模拟断线前已消费 1、2）
      eventFrames: [frame(1), frame(2)],
      sseRequestAfters,
    })

    const phaseAEvents = []
    const viewA = renderShellApp({ onEvent: (event) => phaseAEvents.push(event.sequence) })
    await waitFor(() => expect(localStorage.getItem('wes-run-cursor:run-1')).toBe('2'))
    viewA.unmount() // 模拟刷新：内存 store 重建，localStorage 存活
    sessionRuntimeStore.resetAllSessionViews()

    // 阶段 B：服务端补齐 seq3，忠实回放（after=2 时只返回 3）
    setupReconnect({
      listResponses: [[buildActiveRun()]],
      eventFrames: [frame(1), frame(2), frame(3)],
      sseRequestAfters,
    })
    const phaseBEvents = []
    renderShellApp({ onEvent: (event) => phaseBEvents.push(event.sequence) })

    await waitFor(() => expect(phaseBEvents).toContain(3))
    // 续订游标：阶段 B 首个订阅必须从持久 cursor 2 续订；
    // 后续重订阅（流关闭后重建）携带当时已推进的 cursor，均不得回退重放
    const phaseBAfters = sseRequestAfters.slice(2)
    expect(phaseBAfters.length).toBeGreaterThan(0)
    expect(phaseBAfters[0]).toBe(2)
    phaseBAfters.forEach((after) => expect(after).toBeGreaterThanOrEqual(2))
    // 不重：阶段 B 不得重放已消费的 1、2；不丢：3 恰一次
    expect(phaseBEvents).not.toContain(1)
    expect(phaseBEvents).not.toContain(2)
    expect(phaseBEvents.filter((sequence) => sequence === 3)).toHaveLength(1)
    expect(cancelCalls).toHaveLength(0)
  })

  test('reconnect: 恢复序列按 sessionId 合并 Run 并读取 snapshot', async () => {
    const sseRequestAfters = []
    const { snapshotCalls } = setupReconnect({
      listResponses: [[buildActiveRun()]],
      eventFrames: [],
      snapshotStatus: 'waiting',
      sseRequestAfters,
    })
    renderShellApp({ onEvent: vi.fn() })

    await screen.findByText('探针 · 活跃任务 1')
    // snapshot 读取后 Run 状态以 snapshot 为准，并按 sessionId 合并进 store
    await waitFor(() => {
      expect(sessionRuntimeStore.getSessionView('session-a')?.runStatus).toBe('waiting')
    })
    expect(snapshotCalls).toHaveLength(1)
  })

  test('reconnect: 登出清理敏感缓存（cursor/草稿/活跃会话键）但零 cancel', async () => {
    localStorage.setItem('wes-run-cursor:run-1', '5')
    localStorage.setItem('wes-ai-composer-draft:u3:session-a', '未发送的草稿')
    localStorage.setItem('wes-ai-active-session-id', 'session-a')

    const sseRequestAfters = []
    const { cancelCalls } = setupReconnect({
      listResponses: [[]],
      eventFrames: [],
      sseRequestAfters,
    })
    renderShellApp({ onEvent: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    expect(await screen.findByText('登录页')).toBeInTheDocument()
    expect(localStorage.getItem('wes-run-cursor:run-1')).toBeNull()
    expect(localStorage.getItem('wes-ai-composer-draft:u3:session-a')).toBeNull()
    expect(localStorage.getItem('wes-ai-active-session-id')).toBeNull()
    expect(sessionRuntimeStore.getSnapshot()).toEqual({})
    expect(cancelCalls).toHaveLength(0)
  })
})
