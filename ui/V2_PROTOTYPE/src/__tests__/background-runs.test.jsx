/**
 * G2 后台继续守护测试（RP-047 Batch D · Step 2）。
 * 常驻回归资产：离开 AI 页面（unmount）断言——
 * 1) 本地 SSE 关闭、零 cancel 调用；
 * 2) Shell 层 provider 仍持有 Run 摘要与活跃数量；
 * 3) 完成事件触发一次性通知（aria-live polite）。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import Shell from '../components/Layout/Shell.jsx'
import { useBackgroundRuns, useRunEventStream } from '../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
// ISS-2026-09-03-005：挂载真实生产路径（路由 / → HomePage → AiHomeWorkbench）；
// HomeWorkspace 在生产中无路由可达，其 PageShell 壳会掩盖真实渲染结构。
import HomePage from '../pages/HomePage.jsx'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
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

/**
 * 安装 G2 场景 MSW handlers。
 * listResponses：按调用次序返回的活跃 Run 列表（模拟终态后列表收敛）。
 * eventFrames：run-1 事件流帧；keepOpen=true 时流不主动关闭，
 * 并通过 pushFrame 在流打开后继续推帧（证明 Shell 层连接跨页存活）。
 */
function setupBackgroundRuns({ listResponses, eventFrames, keepOpen = false }) {
  const cancelCalls = []
  let listCallCount = 0
  const pusher = { pushFrame: () => {} }
  const encoder = new TextEncoder()
  const encodeFrame = (frame) => encoder.encode(
    `id: ${frame.sequence}\nevent: ${frame.eventType}\ndata: ${JSON.stringify(frame)}\n\n`,
  )
  server.use(
    http.get(`${BASE}/ai-runs`, () => {
      const items = listResponses[Math.min(listCallCount, listResponses.length - 1)]
      listCallCount += 1
      return HttpResponse.json({ success: true, data: { items } })
    }),
    http.get(`${BASE}/ai-runs/run-1/events`, () => {
      if (!keepOpen) return sseResponse(eventFrames)
      let ctrl = null
      const stream = new ReadableStream({
        start(controller) {
          ctrl = controller
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
          eventFrames.forEach((frame) => controller.enqueue(encodeFrame(frame)))
        },
      })
      pusher.pushFrame = (frame) => { if (ctrl) ctrl.enqueue(encodeFrame(frame)) }
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      })
    }),
    http.post(`${BASE}/ai-runs/run-1/cancel`, () => {
      cancelCalls.push('run-1')
      return HttpResponse.json({ success: true, data: { runId: 'run-1', status: 'cancelling' } })
    }),
  )
  return { cancelCalls, pusher }
}

function AiPageProbe() {
  const { activeCount } = useBackgroundRuns()
  useRunEventStream('run-1')
  return <div>AI 页面 · 活跃任务 {activeCount}</div>
}

function OtherPageProbe() {
  const { activeCount, runs } = useBackgroundRuns()
  return (
    <div>
      <div>其他页面 · 活跃任务 {activeCount}</div>
      {runs.map((run) => <div key={run.runId}>摘要：{run.title}</div>)}
    </div>
  )
}

function LeaveLink() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/other')}>离开 AI 页面</button>
}

function renderShellApp(initialPath = '/ai') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Shell currentUser={TEST_USER}>
        <Routes>
          <Route path="/ai" element={<><AiPageProbe /><LeaveLink /></>} />
          <Route path="/other" element={<OtherPageProbe />} />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </Shell>
    </MemoryRouter>,
  )
}

describe('background-runs: G2 后台继续', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('background-runs: Shell 展示活跃后台任务数量', async () => {
    setupBackgroundRuns({
      listResponses: [[buildActiveRun()]],
      eventFrames: [],
      keepOpen: true,
    })
    renderShellApp()

    expect(await screen.findByText(/后台任务 1/)).toBeInTheDocument()
  })

  test('background-runs: 离开 AI 页面零 cancel，Shell 层连接存活且事件继续推进 cursor', async () => {
    const { cancelCalls, pusher } = setupBackgroundRuns({
      listResponses: [[buildActiveRun()]],
      eventFrames: [],
      keepOpen: true,
    })
    renderShellApp()

    await screen.findByText('AI 页面 · 活跃任务 1')
    fireEvent.click(screen.getByRole('button', { name: '离开 AI 页面' }))

    // 页面级监听注销后：Shell 层 provider 仍持有 Run 摘要与活跃数量
    expect(await screen.findByText('其他页面 · 活跃任务 1')).toBeInTheDocument()
    expect(screen.getByText('摘要：后台任务 A')).toBeInTheDocument()
    // 离页后新事件仍经 Shell 层连接到达并推进持久 cursor（后台继续的直接证据）
    pusher.pushFrame({ sequence: 5, eventType: 'run_status_changed', payload: { status: 'running' }, createdAt: '2026-08-07T00:00:05.000Z' })
    await waitFor(() => expect(localStorage.getItem('wes-run-cursor:run-1')).toBe('5'))
    // 零 cancel：离页不得触发取消接口（spec §4.3）
    expect(cancelCalls).toHaveLength(0)
  })

  test('background-runs: 完成事件触发一次性通知且列表收敛', async () => {
    const { cancelCalls } = setupBackgroundRuns({
      listResponses: [[buildActiveRun()], []],
      eventFrames: [
        { sequence: 1, eventType: 'run_status_changed', payload: { status: 'running' }, createdAt: '2026-08-07T00:00:01.000Z' },
        { sequence: 2, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:02.000Z' },
      ],
    })
    renderShellApp()

    // 一次性完成通知出现在 aria-live 区域
    const liveRegion = await screen.findByRole('region', { name: '后台任务通知' })
    await waitFor(() => expect(liveRegion).toHaveTextContent(/后台任务 A.*已完成/))
    expect(cancelCalls).toHaveLength(0)
    // 活跃列表收敛为 0（Shell 指示器归零）
    await waitFor(() => expect(screen.getByText('后台任务 0')).toBeInTheDocument())
    await waitFor(() => expect(liveRegion.querySelectorAll('.background-run-notification')).toHaveLength(1))
  })

  test('background-runs: 终态事件写入会话终态与未读标记，列表收敛后不清除（Step 5）', async () => {
    const { pusher } = setupBackgroundRuns({
      listResponses: [[buildActiveRun()], []],
      eventFrames: [],
      keepOpen: true,
    })
    renderShellApp()
    await screen.findByText('AI 页面 · 活跃任务 1')

    pusher.pushFrame({ sequence: 9, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:09.000Z' })

    // 终态写入会话视图并标记未读（供 SessionRail 已完成未读徽标消费）
    await waitFor(() => {
      expect(sessionRuntimeStore.getSessionView('session-a')?.runStatus).toBe('completed')
    })
    expect(sessionRuntimeStore.getSessionView('session-a')?.unread).toBe(true)
    // 列表收敛后终态不被合并逻辑清除（徽标仍可展示）
    await screen.findByText('后台任务 0')
    expect(sessionRuntimeStore.getSessionView('session-a')?.runStatus).toBe('completed')
  })

  test('background-runs: Shell 后台任务指示器与通知九组类名样式全量定义且容器 fixed 离流（B1 返工）', () => {
    // 静态样式守护：vitest 不处理 CSS，以源码扫描断言定义存在
    //（与 aiWorkbenchReportGateConsistency 闸门扫描同模式）
    const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css')
    const css = fs.readFileSync(cssPath, 'utf8')
    const selectors = [
      '.shell-background-runs-indicator',
      '.shell-background-runs-notifications',
      '.background-run-notification--completed',
      '.background-run-notification--failed',
      '.background-run-notification--cancelled',
      '.background-run-notification-text',
      '.background-run-notification-dismiss',
    ]
    for (const selector of selectors) {
      expect(css, `缺少 ${selector} 样式定义`).toContain(selector)
    }
    // 容器必须 position:fixed 离开 .shell grid 流：修复第 3 子项掉到第 2 行
    //（首行 ≥100vh）导致指示器与通知常态不可见的问题
    const containerRule = css.match(/\.shell-background-runs\s*\{[^}]*\}/)
    expect(containerRule, '缺少 .shell-background-runs 容器规则').toBeTruthy()
    expect(containerRule[0], '容器必须 fixed 定位方可常态可见').toMatch(/position:\s*fixed/)
  })

  test('background-runs: 通知区保持 role="region" + aria-live="polite"（T1）', async () => {
    setupBackgroundRuns({ listResponses: [[buildActiveRun()]], eventFrames: [], keepOpen: true })
    renderShellApp()

    const liveRegion = await screen.findByRole('region', { name: '后台任务通知' })
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
  })

  test('background-runs: 同一 run_completed 终态帧重复投递仅产生恰 1 条通知（N2 去重）', async () => {
    const { pusher } = setupBackgroundRuns({
      listResponses: [[buildActiveRun()], []],
      eventFrames: [],
      keepOpen: true,
    })
    renderShellApp()
    await screen.findByText('AI 页面 · 活跃任务 1')

    pusher.pushFrame({ sequence: 7, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:07.000Z' })
    const liveRegion = await screen.findByRole('region', { name: '后台任务通知' })
    await waitFor(() => expect(liveRegion.querySelectorAll('.background-run-notification')).toHaveLength(1))

    // 同一终态帧再次投递（如重连回放）：notifiedRef 按 runId:eventType 去重
    pusher.pushFrame({ sequence: 8, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:08.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(liveRegion.querySelectorAll('.background-run-notification')).toHaveLength(1)
  })

  // ISS-2026-08-10-002（右下角全局「后台任务」角标不计数）：
  // provider 缺「新 run 创建」刷新触发——context 需暴露节流刷新入口 notifyRunsChanged，
  // 由工作台提交成功 / 统一视图发现新 runId 时调用；零 cancel 硬口径不变。
  test('background-runs: 新 run 创建经 context 刷新入口计数变 1 并建立 SSE 消费终态（ISS-2026-08-10-002）', async () => {
    const { cancelCalls, pusher } = setupBackgroundRuns({
      listResponses: [[], [buildActiveRun()], []],
      eventFrames: [],
      keepOpen: true,
    })
    // 恢复序列会读 run-1 快照：补默认快照 handler，避免 MSW unhandled 噪音
    server.use(
      http.get(`${BASE}/ai-runs/run-1`, () => HttpResponse.json({
        success: true,
        data: { run: { ...buildActiveRun() } },
      })),
    )
    let contextApi = null
    function ContextProbe() {
      contextApi = useBackgroundRuns()
      return null
    }
    render(
      <MemoryRouter initialEntries={['/other']}>
        <Shell currentUser={TEST_USER}>
          <Routes>
            <Route path="/other" element={<><ContextProbe /><OtherPageProbe /></>} />
          </Routes>
        </Shell>
      </MemoryRouter>,
    )

    // 挂载首拉返回空列表：角标为 0（用户症状起点）
    expect(await screen.findByText('其他页面 · 活跃任务 0')).toBeInTheDocument()

    // 后端随后出现新活跃 run（如工作台提交成功）：调用 context 暴露的节流刷新入口
    expect(typeof contextApi.notifyRunsChanged).toBe('function')
    await act(async () => { contextApi.notifyRunsChanged() })

    // activeCount 变 1 → 订阅协调 effect 为新 run 建立 provider 级 SSE
    expect(await screen.findByText('其他页面 · 活跃任务 1')).toBeInTheDocument()

    // SSE 已建立的直接证据：终态帧被消费 → 一次性通知 + 列表收敛归零
    pusher.pushFrame({ sequence: 3, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:03.000Z' })
    const liveRegion = await screen.findByRole('region', { name: '后台任务通知' })
    await waitFor(() => expect(liveRegion).toHaveTextContent(/后台任务 A.*已完成/))
    await waitFor(() => expect(screen.getByText('其他页面 · 活跃任务 0')).toBeInTheDocument())
    expect(cancelCalls).toHaveLength(0)
  })

  test('background-runs: 刷新入口节流——窗口期多次调用仅 leading 一次列表请求（ISS-2026-08-10-002）', async () => {
    let listCalls = 0
    server.use(
      http.get(`${BASE}/ai-runs`, () => {
        listCalls += 1
        return HttpResponse.json({ success: true, data: { items: [] } })
      }),
    )
    let contextApi = null
    function ContextProbe() {
      contextApi = useBackgroundRuns()
      return null
    }
    render(
      <MemoryRouter initialEntries={['/other']}>
        <Shell currentUser={TEST_USER}>
          <Routes>
            <Route path="/other" element={<ContextProbe />} />
          </Routes>
        </Shell>
      </MemoryRouter>,
    )
    // 挂载首拉恰好一次
    await waitFor(() => expect(listCalls).toBe(1))

    expect(typeof contextApi.notifyRunsChanged).toBe('function')
    await act(async () => {
      contextApi.notifyRunsChanged()
      contextApi.notifyRunsChanged()
      contextApi.notifyRunsChanged()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    // 三连调用在节流窗口内：leading 恰好追加一次，不放大请求量
    expect(listCalls).toBe(2)
  })

  test('background-runs: 工作台提交成功后右下角角标 2s 内计数为 1（ISS-2026-08-10-002 用户症状复现）', async () => {
    let listCalls = 0
    server.use(
      http.get(`${BASE}/ai/home-workbench/view`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: { sessions: [], runs: [], tasks: [], artifacts: [], failedRuns: [] },
      })),
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai-sessions/session-new/runs`, () => HttpResponse.json({
        success: true,
        data: { runId: 'run-1', status: 'queued', eventCursor: 0 },
      })),
      http.get(`${BASE}/ai-runs`, () => {
        listCalls += 1
        // 挂载首拉为空；提交成功触发刷新后返回真实活跃 run（后端无数据源缺口）
        const items = listCalls >= 2 ? [buildActiveRun()] : []
        return HttpResponse.json({ success: true, data: { items } })
      }),
      http.get(`${BASE}/ai-runs/run-1`, () => HttpResponse.json({
        success: true,
        data: { run: { ...buildActiveRun() } },
      })),
      http.get(`${BASE}/ai-runs/run-1/events`, () => sseResponse([])),
    )
    render(
      <MemoryRouter initialEntries={['/ai']}>
        <Shell currentUser={TEST_USER}>
          <Routes>
            <Route path="/ai" element={<ToastProvider><ToastContainer /><HomePage /></ToastProvider>} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </Shell>
      </MemoryRouter>,
    )

    // 发问前：右下角全局角标 0
    expect(await screen.findByText('后台任务 0')).toBeInTheDocument()

    // 用户发问：createSession → submitRun 成功创建 run（异步开关开）
    fireEvent.change(screen.getByLabelText('AI 工作台输入'), { target: { value: '帮我评估这个项目' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // 验收口径：发问后 2s 内右下角角标 ≥1（提交成功回调触发 provider 刷新）
    expect(await screen.findByText('后台任务 1', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(listCalls).toBeGreaterThanOrEqual(2)
  })

  test('background-runs: 指示器点击弹出任务清单气泡，外部点击失焦后消失（RP-058）', async () => {
    setupBackgroundRuns({ listResponses: [[buildActiveRun()]], eventFrames: [], keepOpen: true })
    renderShellApp()

    // 指示器为可点击控件，点击后附近弹出气泡清单
    const indicator = await screen.findByRole('button', { name: /后台任务 1/ })
    fireEvent.click(indicator)
    const popover = await screen.findByRole('dialog', { name: '后台任务清单' })
    expect(popover).toHaveTextContent('后台任务 A')

    // 鼠标失焦（点击气泡外）后气泡消失
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '后台任务清单' })).not.toBeInTheDocument())
  })

  test('background-runs: 已完成通知默认 5 秒后自动消失（RP-058）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      setupBackgroundRuns({
        listResponses: [[buildActiveRun()], []],
        eventFrames: [
          { sequence: 1, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:01.000Z' },
        ],
      })
      renderShellApp()
      const liveRegion = await screen.findByRole('region', { name: '后台任务通知' })
      await waitFor(() => expect(liveRegion).toHaveTextContent(/后台任务 A.*已完成/))

      // 推进 5 秒：completed 通知自动消失（无需手动点 ×）
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(liveRegion.querySelectorAll('.background-run-notification')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('background-runs: 点击已完成通知跳转对应会话并触发【已完成未读】消失（RP-058）', async () => {
    setupBackgroundRuns({
      listResponses: [[buildActiveRun()], []],
      eventFrames: [
        { sequence: 2, eventType: 'run_completed', payload: {}, createdAt: '2026-08-07T00:00:02.000Z' },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/other']}>
        <Shell currentUser={TEST_USER}>
          <Routes>
            <Route path="/" element={<div>AI 工作台首页</div>} />
            <Route path="/other" element={<OtherPageProbe />} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </Shell>
      </MemoryRouter>,
    )
    const liveRegion = await screen.findByRole('region', { name: '后台任务通知' })
    await waitFor(() => expect(liveRegion).toHaveTextContent(/后台任务 A.*已完成/))
    // 前置事实：终态已写入未读（SessionRail 已完成未读徽标数据源）
    expect(sessionRuntimeStore.getSessionView('session-a')?.unread).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /查看会话：后台任务 A 已完成/ }))

    // 跳转对应会话（工作台首页）+ 预置活跃会话 + 未读清除（徽标消失）+ 通知自身消失
    expect(await screen.findByText('AI 工作台首页')).toBeInTheDocument()
    expect(localStorage.getItem('wes-ai-active-session-id')).toBe('session-a')
    expect(sessionRuntimeStore.getSessionView('session-a')?.unread).toBe(false)
    expect(liveRegion.querySelectorAll('.background-run-notification')).toHaveLength(0)
  })
})
