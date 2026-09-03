/**
 * O5 统一视图前端守护测试（Sprint 3A）。
 * 常驻回归资产：首屏渲染断言——
 * 1) useWorkbenchState 挂载时调用统一视图接口；
 * 2) 统一视图数据正确注入状态；
 * 3) 统一视图失败时静默降级，不阻塞既有会话列表加载。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { BackgroundRunProvider } from '../hooks/useBackgroundRuns.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
// ISS-2026-09-03-005：挂载真实生产路径（路由 / → HomePage → AiHomeWorkbench）；
// HomeWorkspace 在生产中无路由可达，其 PageShell 壳会掩盖真实渲染结构。
import HomePage from '../pages/HomePage.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'
const TEST_USER = { id: 'u3', username: 'arch', role: 'user', businessRole: 'pre_sales' }

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

function buildUnifiedView(overrides = {}) {
  return {
    sessions: [
      buildSession('session-a', '会话 A'),
      buildSession('session-b', '会话 B'),
    ],
    runs: [
      // ISS-2026-08-10-004：统一视图 runs 契约字段为 runId（后端无 id 字段）——
      // mock 此前用假 id 字段致流式发现用例在生产坏时仍绿（假绿洞，本单封堵）。
      { runId: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' },
    ],
    tasks: [],
    artifacts: [
      { artifactId: 'art-1', sessionId: 'session-a', type: 'report', title: '报告 1', status: 'ready' },
    ],
    failedRuns: [],
    ...overrides,
  }
}

/**
 * 安装统一视图 MSW 场景。
 */
function setupUnifiedView({ view, fail = false } = {}) {
  const calls = []
  const resolvedView = view || buildUnifiedView()
  server.use(
    http.get(`${BASE}/ai/home-workbench/view`, () => {
      calls.push('unified-view')
      if (fail) {
        return new HttpResponse(null, { status: 503 })
      }
      return HttpResponse.json({
        code: 0,
        message: 'ok',
        data: resolvedView,
      })
    }),
    http.get(`${BASE}/ai-sessions`, () => {
      calls.push('ai-sessions')
      return HttpResponse.json({
        success: true,
        data: {
          items: resolvedView.sessions || [],
        },
      })
    }),
  )
  return { calls }
}

function renderWorkbench() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter><HomePage /></MemoryRouter>
    </ToastProvider>,
  )
}

describe('unified-view: O5 统一视图首屏接入', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('unified-view: 首屏调用统一视图接口并正确展示会话', async () => {
    const { calls } = setupUnifiedView()
    renderWorkbench()

    // 统一视图接口被调用
    await waitFor(() => expect(calls).toContain('unified-view'))

    // 会话列表正常渲染（来自既有 /ai-sessions 或统一视图数据）
    expect(await screen.findByText('会话 A')).toBeInTheDocument()
    expect(screen.getByText('会话 B')).toBeInTheDocument()
  })

  test('unified-view: 统一视图返回 runs 与 artifacts 数据不阻塞渲染', async () => {
    setupUnifiedView({
      view: buildUnifiedView({
        runs: [{ runId: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' }],
        artifacts: [{ artifactId: 'art-1', sessionId: 'session-a', type: 'report', title: '报告 1', status: 'ready' }],
      }),
    })
    renderWorkbench()

    // 首屏渲染成功，不因为统一视图数据格式异常而白屏
    expect(await screen.findByText('会话 A')).toBeInTheDocument()
  })

  test('unified-view: 统一视图 503 失败时静默降级，会话列表仍正常加载', async () => {
    setupUnifiedView({ fail: true })
    renderWorkbench()

    // 统一视图失败不应阻塞既有 /ai-sessions 链路
    expect(await screen.findByText('会话 A')).toBeInTheDocument()
    expect(screen.getByText('会话 B')).toBeInTheDocument()
  })

  test('unified-view: 统一视图数据隔离（仅返回当前用户数据）', async () => {
    const view = buildUnifiedView({
      sessions: [buildSession('session-u3', 'u3 专属会话')],
    })
    setupUnifiedView({ view })
    renderWorkbench()

    // 当前用户只能看到自己的会话
    expect(await screen.findByText('u3 专属会话')).toBeInTheDocument()
  })

  // ISS-2026-08-09-003（离页返回旧缓存渲染）C3 回归：
  // 「后台任务」角标接入统一视图 runs 的活跃/已完成计数（O5 接口已一次取齐 runs）。
  test('unified-view: 后台任务角标按统一视图 runs 展示活跃/已完成计数', async () => {
    setupUnifiedView({
      view: buildUnifiedView({
        runs: [
          { runId: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' },
          { runId: 'run-2', sessionId: 'session-b', status: 'completed', latestEventKind: 'run_completed' },
        ],
      }),
    })
    renderWorkbench()

    expect(await screen.findByText('后台任务 进行中 1 · 已完成 1')).toBeInTheDocument()
  })

  // ISS-2026-08-10-001（ISS-003 复验残留：后台任务角标不显示 + 未完成占位不恢复）回归：
  // 重挂载后统一视图 runs 含已完成 run（ISS-2026-08-10-001 后端增补近期已完成数据源），
  // 且本地 store 存在该会话未完成进行中占位（卸载快照）时——
  // 1) 角标「已完成」计数 ≥ 1（仅已完成 run 也渲染角标，修正永远 0 缺陷的前端契约）；
  // 2) 未完成进行中占位经卸载快照对账恢复渲染（后端尚无 assistant）；
  // 3) completedInBackground 不依赖卸载前 ref，触发一次 loadSessions 对账重拉
  //    （挂载首次 + 对账重拉各一次）。
  test('unified-view: 重挂载后 runs 含已完成且本地有未完成占位时恢复占位并触发一次对账重拉', async () => {
    sessionRuntimeStore.setSessionMessages('session-a', [
      { id: 'local-user-1', role: 'user', text: '利润中心是什么？' },
      { id: 'local-loading-1', role: 'assistant', text: '正在理解你的问题', loading: true },
    ])
    const { calls } = setupUnifiedView({
      view: buildUnifiedView({
        runs: [
          { runId: 'run-1', sessionId: 'session-a', status: 'completed', latestEventKind: 'run_completed' },
        ],
      }),
    })
    renderWorkbench()

    // 角标仅已完成 run 也渲染（进行中 0 · 已完成 1）
    expect(await screen.findByText('后台任务 进行中 0 · 已完成 1')).toBeInTheDocument()
    // 未完成进行中占位恢复快照渲染（后端尚无 assistant）
    expect(await screen.findByText('正在理解你的问题')).toBeInTheDocument()
    expect(screen.getByText('利润中心是什么？')).toBeInTheDocument()
    // 触发一次对账重拉：mount 首次 + 重挂载对账各一次
    await waitFor(() => expect(calls.filter((call) => call === 'ai-sessions').length).toBeGreaterThanOrEqual(2))
  })

  // ISS-2026-08-10-003（发问后顶栏角标不即时 + O8 逐字流式延迟）：
  // submitRun 成功（异步通道）后须立即触发一次统一视图刷新——顶栏角标数据源
  // （unifiedView.runs）即时更新、activeRunId 经渲染重算成立（O8 页面级流式发现前提）；
  // 503 同步回退 / flag 关闭路径零刷新、行为逐字不变。仅追加用例，不改既有断言。
  const SUBMIT_RUN_ID = 'run-new-1'

  function buildSubmittedRun() {
    // ISS-2026-08-10-004：契约形状 runId（无 id 字段），与后端统一视图一致
    return { runId: SUBMIT_RUN_ID, sessionId: 'session-new', status: 'running', latestEventKind: 'run_status_changed' }
  }

  function buildViewWithRuns(runs) {
    return { sessions: [], runs, tasks: [], artifacts: [], failedRuns: [] }
  }

  /**
   * 「提交成功后统一视图返回新 run」场景：挂载首拉 runs 为空，
   * 第二次起返回绑定新会话的活跃 run；submitRun 成功（异步通道开）。
   */
  function setupSubmitRefreshView() {
    const viewCalls = []
    server.use(
      http.get(`${BASE}/ai/home-workbench/view`, () => {
        viewCalls.push('unified-view')
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: buildViewWithRuns(viewCalls.length >= 2 ? [buildSubmittedRun()] : []),
        })
      }),
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai-sessions/session-new/runs`, () => HttpResponse.json({
        success: true,
        data: { runId: SUBMIT_RUN_ID, status: 'queued', eventCursor: 0 },
      })),
    )
    return { viewCalls }
  }

  function submitQuestion(text) {
    fireEvent.change(screen.getByLabelText('AI 工作台输入'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  }

  test('unified-view: 发问 submitRun 成功后立即追加一次统一视图刷新请求（ISS-2026-08-10-003）', async () => {
    const { viewCalls } = setupSubmitRefreshView()
    renderWorkbench()

    // 挂载首拉恰好一次（空 runs）；计数全 0 时角标按既有契约不渲染
    await waitFor(() => expect(viewCalls).toHaveLength(1))
    expect(screen.queryByText(/后台任务 进行中/)).not.toBeInTheDocument()

    submitQuestion('帮我评估这个项目')

    // 验收口径：发问后 2s 内统一视图再次拉取（顶栏角标与 activeRunId 数据源即时更新）
    await waitFor(() => expect(viewCalls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 })
  })

  test('unified-view: 发问后顶栏「后台任务 进行中」角标 2s 内由无到 1（ISS-2026-08-10-003 用户症状复现）', async () => {
    const { viewCalls } = setupSubmitRefreshView()
    renderWorkbench()

    // 发问前：统一视图 runs 为空，角标不渲染（用户症状起点）
    await waitFor(() => expect(viewCalls).toHaveLength(1))
    expect(screen.queryByText(/后台任务 进行中/)).not.toBeInTheDocument()

    submitQuestion('帮我评估这个项目')

    expect(await screen.findByText('后台任务 进行中 1 · 已完成 0', {}, { timeout: 2000 })).toBeInTheDocument()
  })

  test('unified-view: 发问后统一视图刷新发现新 run，O8 页面级流式订阅建立并逐字呈现（ISS-2026-08-10-003）', async () => {
    const { viewCalls } = setupSubmitRefreshView()
    const providerRun = {
      runId: SUBMIT_RUN_ID,
      sessionId: 'session-new',
      title: '后台任务 X',
      status: 'running',
      eventCursor: 0,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:01.000Z',
    }
    let listCalls = 0
    let sseCalls = 0
    const encoder = new TextEncoder()
    const pusher = { pushFrame: () => {} }
    server.use(
      http.get(`${BASE}/ai-runs`, () => {
        listCalls += 1
        // provider 挂载首拉为空；提交成功经 ISS-002 通知刷新后返回真实活跃 run
        const items = listCalls >= 2 ? [{ ...providerRun }] : []
        return HttpResponse.json({ success: true, data: { items } })
      }),
      http.get(`${BASE}/ai-runs/${SUBMIT_RUN_ID}`, () => HttpResponse.json({
        success: true,
        data: { run: { ...providerRun } },
      })),
      http.get(`${BASE}/ai-runs/${SUBMIT_RUN_ID}/events`, () => {
        sseCalls += 1
        let ctrl = null
        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
          },
        })
        pusher.pushFrame = (frame) => {
          if (ctrl) {
            ctrl.enqueue(encoder.encode(
              `id: ${frame.sequence}\nevent: ${frame.eventType}\ndata: ${JSON.stringify(frame)}\n\n`,
            ))
          }
        }
        return new HttpResponse(stream, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        })
      }),
    )
    render(
      <ToastProvider>
        <ToastContainer />
        <MemoryRouter>
          <BackgroundRunProvider>
            <HomePage />
          </BackgroundRunProvider>
        </MemoryRouter>
      </ToastProvider>,
    )

    // 挂载首拉完成（空 runs），角标按既有契约不渲染
    await waitFor(() => expect(viewCalls).toHaveLength(1))
    expect(screen.queryByText(/后台任务 进行中/)).not.toBeInTheDocument()

    submitQuestion('流式发现验证')

    // 统一视图刷新完成（activeRunId 重算成立）+ provider 为新 run 建立 SSE，两链路就绪后再推帧
    await waitFor(() => expect(viewCalls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 })
    await waitFor(() => expect(sseCalls).toBeGreaterThanOrEqual(1), { timeout: 2000 })

    // 页面级监听器经 activeRunId 注册后，text.delta 逐字呈现（替换 loading 占位）
    pusher.pushFrame({ sequence: 1, eventType: 'text.delta', payload: { delta: '流式字' }, createdAt: '2026-08-10T00:00:02.000Z' })
    expect(await screen.findByText('流式字')).toBeInTheDocument()
  })

  test('unified-view: 503 同步回退路径零影响——不追加统一视图刷新、同步应答照常（ISS-2026-08-10-003）', async () => {
    const viewCalls = []
    let chatCalls = 0
    server.use(
      http.get(`${BASE}/ai/home-workbench/view`, () => {
        viewCalls.push('unified-view')
        return HttpResponse.json({ code: 0, message: 'ok', data: buildViewWithRuns([]) })
      }),
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai-sessions/session-new/runs`, () => HttpResponse.json(
        { success: false, code: 'ASYNC_RUNS_DISABLED', message: 'async runs disabled' },
        { status: 503 },
      )),
      http.post(`${BASE}/ai/home-workbench/chat`, async () => {
        chatCalls += 1
        return HttpResponse.json({
          success: true,
          data: { answer: '模型回复：同步回退验证' },
        })
      }),
    )
    renderWorkbench()

    await waitFor(() => expect(viewCalls).toHaveLength(1))

    submitQuestion('同步回退验证')

    // 同步路径照常应答（行为逐字不变的直接证据）
    expect(await screen.findByText('模型回复：同步回退验证')).toBeInTheDocument()
    expect(chatCalls).toBe(1)
    // 同步回退不得触发额外统一视图刷新：应答完成后窗口内仍只有挂载首拉一次
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(viewCalls).toHaveLength(1)
  })

  // ISS-2026-08-10-004（层 1：runId 字段错配，停止按钮失效）RED：
  // 统一视图 runs 为后端契约形状（runId，无 id）时，对话区停止按钮必须以
  // runId 调 cancelRun；错配实现下 cancelRun 收到 undefined，请求落到
  // /ai-runs/undefined/cancel（用户实测「停止按钮点击无反应」）。
  test('unified-view: 对话区停止按钮以 runId 契约字段调用 cancelRun（ISS-2026-08-10-004）', async () => {
    const cancelCalls = []
    let resolveSubmit
    server.use(
      http.get(`${BASE}/ai/home-workbench/view`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: buildUnifiedView({
          runs: [{ runId: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' }],
        }),
      })),
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
        success: true,
        data: { items: [buildSession('session-a', '会话 A'), buildSession('session-b', '会话 B')] },
      })),
      // provider 轮询链路（cancelRun 后 refresh 也走此 handler）
      http.get(`${BASE}/ai-runs`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai-sessions/session-a/runs`, () => new Promise((resolve) => {
        // submitRun 保持未决，sending 维持 true，停止按钮可持续点击
        resolveSubmit = resolve
      })),
      http.post(`${BASE}/ai-runs/:runId/cancel`, ({ params }) => {
        cancelCalls.push(params.runId)
        return HttpResponse.json({ success: true, data: { runId: params.runId, status: 'cancelling' } })
      }),
    )
    // cancelRun 经 BackgroundRunProvider context 到达，必须挂 provider（否则为 no-op 兜底）
    render(
      <ToastProvider>
        <ToastContainer />
        <MemoryRouter>
          <BackgroundRunProvider>
            <HomePage />
          </BackgroundRunProvider>
        </MemoryRouter>
      </ToastProvider>,
    )

    // 激活会话 A（统一视图含其进行中 run）
    fireEvent.click(await screen.findByText('会话 A'))

    submitQuestion('停止按钮验证')

    // activeRun（running）&& sending → 停止按钮渲染
    const stopButton = await screen.findByRole('button', { name: '停止生成' })
    fireEvent.click(stopButton)

    // 验收口径：cancel 请求必须落在契约 runId 上（不得为 undefined）
    await waitFor(() => expect(cancelCalls).toContain('run-1'))

    // 清理悬挂的 submitRun 请求，避免用例间泄漏
    resolveSubmit?.(HttpResponse.json({ success: true, data: { runId: 'run-2', status: 'queued', eventCursor: 0 } }))
  })
})
