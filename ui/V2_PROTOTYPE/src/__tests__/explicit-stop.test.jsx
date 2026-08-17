/**
 * G4 明确停止守护测试（RP-047 Batch D · Step 4）。
 * 常驻回归资产：唯一 cancel 触发路径是用户显式点击停止——
 * 1) 卸载 / 路由切换 / 模拟刷新 / 登出四场景 cancel 调用次数为 0；
 * 2) SessionRail 行级"停止"经 ConfirmDialog 二次确认产生恰 1 次 cancel；
 * 3) 二次确认弹窗取消不产生 cancel。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import Shell from '../components/Layout/Shell.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import AiHomeWorkbench from '../pages/AiHomeWorkbench/index.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'
const TEST_USER = { id: 'u3', username: 'tester', role: 'admin' }

function buildActiveRun() {
  return {
    runId: 'run-1',
    sessionId: 'session-a',
    title: '后台任务 A',
    status: 'running',
    eventCursor: 0,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:01.000Z',
  }
}

function buildSession() {
  return {
    sessionId: 'session-a',
    title: '评估会话 A',
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
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:01.000Z',
  }
}

/**
 * 安装 G4 场景 handlers：会话列表含 session-a（run-1 归属会话），
 * 事件流 keepOpen（连接保持打开，令"不 cancel"的断言有意义）。
 */
function setupStopScenario({ listResponses = [[buildActiveRun()]] } = {}) {
  const cancelCalls = []
  let listCallCount = 0
  const encoder = new TextEncoder()
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: { items: [buildSession()] },
    })),
    http.get(`${BASE}/ai-runs`, () => {
      const items = listResponses[Math.min(listCallCount, listResponses.length - 1)]
      listCallCount += 1
      return HttpResponse.json({ success: true, data: { items } })
    }),
    http.get(`${BASE}/ai-runs/run-1/events`, () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        }, // keepOpen：不 close
      })
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      })
    }),
    http.get(`${BASE}/ai-runs/run-1`, () => HttpResponse.json({
      success: true,
      data: { run: { runId: 'run-1', status: 'running' }, attempt: null, checkpoint: null, output: null },
    })),
    http.post(`${BASE}/ai-runs/run-1/cancel`, () => {
      cancelCalls.push('run-1')
      return HttpResponse.json({ success: true, data: { runId: 'run-1', status: 'cancelling' } })
    }),
  )
  return { cancelCalls }
}

function LeaveLink() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/other')}>离开 AI 页面</button>
}

function renderWorkbenchApp() {
  return render(
    <MemoryRouter initialEntries={['/ai']}>
      <ToastProvider>
        <Shell currentUser={TEST_USER}>
          <Routes>
            <Route path="/ai" element={<><LeaveLink /><AiHomeWorkbench currentUser={TEST_USER} /></>} />
            <Route path="/other" element={<div>其他页面</div>} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </Shell>
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** 等待行级停止按钮出现（证明活跃 Run 已映射到会话行）。 */
async function waitForRowStop() {
  return screen.findByRole('button', { name: '停止后台任务：后台任务 A' })
}

/** 等待一个宏任务窗口，让卸载清理路径中的异步回调有机会执行。 */
function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

describe('explicit-stop: G4 明确停止', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('explicit-stop: 整树卸载零 cancel', async () => {
    const { cancelCalls } = setupStopScenario()
    const view = renderWorkbenchApp()
    await waitForRowStop()

    view.unmount()
    await flushAsync()
    expect(cancelCalls).toHaveLength(0)
  })

  test('explicit-stop: 路由切换零 cancel', async () => {
    const { cancelCalls } = setupStopScenario()
    renderWorkbenchApp()
    await waitForRowStop()

    fireEvent.click(screen.getByRole('button', { name: '离开 AI 页面' }))
    expect(await screen.findByText('其他页面')).toBeInTheDocument()
    expect(cancelCalls).toHaveLength(0)
  })

  test('explicit-stop: 模拟刷新（卸载重建）零 cancel', async () => {
    const { cancelCalls } = setupStopScenario()
    const viewA = renderWorkbenchApp()
    await waitForRowStop()
    viewA.unmount()

    renderWorkbenchApp()
    await waitForRowStop()
    expect(cancelCalls).toHaveLength(0)
  })

  test('explicit-stop: 登出零 cancel', async () => {
    const { cancelCalls } = setupStopScenario()
    renderWorkbenchApp()
    await waitForRowStop()

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByText('登录页')).toBeInTheDocument()
    expect(cancelCalls).toHaveLength(0)
  })

  test('explicit-stop: 行级停止经二次确认产生恰 1 次 cancel', async () => {
    // cancel 后列表收敛为空，行级停止入口随之消失
    const { cancelCalls } = setupStopScenario({ listResponses: [[buildActiveRun()], []] })
    renderWorkbenchApp()
    const rowStop = await waitForRowStop()

    fireEvent.click(rowStop)
    // 二次确认弹窗出现；确认前不得产生 cancel
    expect(await screen.findByRole('dialog', { name: '停止任务' })).toBeInTheDocument()
    expect(cancelCalls).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '确认停止' }))
    await waitFor(() => expect(cancelCalls).toHaveLength(1))
    // 停止后列表刷新收敛，行级停止按钮消失
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止后台任务：后台任务 A' })).not.toBeInTheDocument())
    expect(cancelCalls).toHaveLength(1)
  })

  test('explicit-stop: 二次确认取消不产生 cancel', async () => {
    const { cancelCalls } = setupStopScenario()
    renderWorkbenchApp()
    const rowStop = await waitForRowStop()

    fireEvent.click(rowStop)
    expect(await screen.findByRole('dialog', { name: '停止任务' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog', { name: '停止任务' })).not.toBeInTheDocument()
    expect(cancelCalls).toHaveLength(0)
  })

  test('explicit-stop: 停止确认弹窗支持 Esc 关闭且焦点落在弹窗内（键盘路径，Step 6）', async () => {
    const { cancelCalls } = setupStopScenario()
    renderWorkbenchApp()
    const rowStop = await waitForRowStop()

    fireEvent.click(rowStop)
    const dialog = await screen.findByRole('dialog', { name: '停止任务' })
    // aria-modal 弹窗必须可键盘关闭：Esc 等价于取消
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '停止任务' })).not.toBeInTheDocument()
    expect(cancelCalls).toHaveLength(0)

    // 重新打开：初始焦点应落在弹窗内（键盘用户可直接操作）
    fireEvent.click(screen.getByRole('button', { name: '停止后台任务：后台任务 A' }))
    const reopened = await screen.findByRole('dialog', { name: '停止任务' })
    expect(reopened.contains(document.activeElement)).toBe(true)
    expect(cancelCalls).toHaveLength(0)
  })
})
