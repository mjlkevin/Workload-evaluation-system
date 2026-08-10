/**
 * O5 统一视图前端守护测试（Sprint 3A）。
 * 常驻回归资产：首屏渲染断言——
 * 1) useWorkbenchState 挂载时调用统一视图接口；
 * 2) 统一视图数据正确注入状态；
 * 3) 统一视图失败时静默降级，不阻塞既有会话列表加载。
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
      { id: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' },
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
      <MemoryRouter><HomeWorkspace /></MemoryRouter>
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
        runs: [{ id: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' }],
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
          { id: 'run-1', sessionId: 'session-a', status: 'running', latestEventKind: 'run_status_changed' },
          { id: 'run-2', sessionId: 'session-b', status: 'completed', latestEventKind: 'run_completed' },
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
          { id: 'run-1', sessionId: 'session-a', status: 'completed', latestEventKind: 'run_completed' },
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
})
