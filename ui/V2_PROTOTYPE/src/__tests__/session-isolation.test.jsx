/**
 * G1 会话隔离守护测试（RP-047 Batch D · Step 1）。
 * 常驻回归资产：会话 A 请求进行中切到 B 并发送，断言——
 * 1) 切换后 B 的历史消息正常展示；
 * 2) A 进行中不阻塞 B 发送；
 * 3) A 的迟到响应不写入 B 视图、不抢回当前渲染源、B 状态不被清空；
 * 4) 切回 A 后 A 的最终消息仍可见（状态按会话键保留）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
// ISS-2026-09-03-005：挂载真实生产路径（路由 / → HomePage → AiHomeWorkbench）；
// HomeWorkspace 在生产中无路由可达，其 PageShell 壳会掩盖真实渲染结构。
import HomePage from '../pages/HomePage.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function buildSession(sessionId, title, history) {
  return {
    sessionId,
    title,
    domain: 'business_evaluation',
    workflowKey: 'free_chat',
    businessRole: 'pre_sales',
    status: 'temporary_chat',
    summary: '',
    messages: history.map((message, index) => ({
      messageId: `${sessionId}-msg-${index + 1}`,
      role: message.role,
      content: message.content,
      attachmentIds: [],
      createdAt: '2026-06-14T00:00:00.000Z',
    })),
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
  }
}

function buildChatPayload(sessionId, body, answerText) {
  const messages = (body.messages || []).map((message, index) => ({
    messageId: `${sessionId}-req-msg-${index + 1}`,
    role: message.role,
    content: message.content,
    attachmentIds: [],
    createdAt: '2026-06-14T00:00:00.000Z',
  }))
  return {
    success: true,
    data: {
      intent: 'domain_qa',
      answer: answerText,
      businessRole: 'pre_sales',
      roleLabel: '售前顾问',
      model: 'kimi-k2.5',
      suggestedActions: [],
      trace: { intentConfidence: 0.8, routingRule: 'mock', contextRefs: [] },
      session: {
        ...buildSession(sessionId, sessionId === 'session-a' ? '会话 A' : '会话 B', []),
        messages: [
          ...messages,
          {
            messageId: `${sessionId}-assistant`,
            role: 'assistant',
            content: answerText,
            createdAt: '2026-06-14T00:00:01.000Z',
          },
        ],
        updatedAt: '2026-06-14T00:00:01.000Z',
      },
    },
  }
}

/**
 * 安装双会话 MSW 场景：会话 A 的 chat 响应被延迟门控，
 * 会话 B 的 chat 响应即时返回。
 *
 * ISS-2026-08-09-003（离页返回旧缓存渲染）：mock 升级为有状态持久化——
 * chat 请求到达即落库用户消息、响应放行时追加 assistant，GET /ai-sessions
 * 始终反映后端最新状态，以支撑「会话切回触发重拉、后端 messages 为准对账」
 * 的回归路径（真实后端在异步通道下本就会落库，见工单根因取证）。
 */
function setupDualSessions() {
  const chatRequests = []
  let resolveAGate
  const aGate = new Promise((resolve) => { resolveAGate = resolve })
  const histories = {
    'session-a': [{ role: 'user', content: '你好 A' }, { role: 'assistant', content: 'A 的历史回复' }],
    'session-b': [{ role: 'user', content: '你好 B' }, { role: 'assistant', content: 'B 的历史回复' }],
  }
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: {
        items: [
          buildSession('session-a', '会话 A', histories['session-a']),
          buildSession('session-b', '会话 B', histories['session-b']),
        ],
      },
    })),
    http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
      const body = await request.json()
      chatRequests.push(body.sessionId)
      const sessionId = body.sessionId === 'session-a' ? 'session-a' : 'session-b'
      histories[sessionId] = (body.messages || []).map((message) => ({ role: message.role, content: message.content }))
      if (sessionId === 'session-a') await aGate
      const answerText = `模型回复：${sessionId === 'session-a' ? 'A' : 'B'}-${body.messages.at(-1)?.content || ''}`
      histories[sessionId] = [...histories[sessionId], { role: 'assistant', content: answerText }]
      return HttpResponse.json(buildChatPayload(sessionId, body, answerText))
    }),
  )
  return { chatRequests, resolveAGate, histories }
}

/**
 * ISS-2026-08-09-003（离页返回旧缓存渲染）异步通道场景：
 * Run 提交即在后端落库用户消息；completeRun 模拟离页期间后台完成、
 * assistant 完整回复落库（工单根因取证：23:43:43 用户消息 / 23:44:00 回复均已落库）。
 */
function setupAsyncChannel() {
  const histories = {
    'session-a': [{ role: 'user', content: '你好 A' }, { role: 'assistant', content: 'A 的历史回复' }],
    'session-b': [{ role: 'user', content: '你好 B' }, { role: 'assistant', content: 'B 的历史回复' }],
  }
  const runSubmissions = []
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: {
        items: [
          buildSession('session-a', '会话 A', histories['session-a']),
          buildSession('session-b', '会话 B', histories['session-b']),
        ],
      },
    })),
    http.post(`${BASE}/ai-sessions/:sessionId/runs`, async ({ params, request }) => {
      const body = await request.json()
      runSubmissions.push(params.sessionId)
      histories[params.sessionId] = [...(histories[params.sessionId] || []), { role: 'user', content: body.content }]
      return HttpResponse.json({
        success: true,
        data: { runId: 'run-async-1', sessionId: params.sessionId, status: 'queued', eventCursor: 1 },
      })
    }),
  )
  return {
    runSubmissions,
    completeRun(sessionId, answerText) {
      histories[sessionId] = [...histories[sessionId], { role: 'assistant', content: answerText }]
    },
  }
}

function renderWorkbench() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter><HomePage /></MemoryRouter>
    </ToastProvider>,
  )
}

function clickSessionCard(title) {
  fireEvent.click(screen.getByText(title).closest('[role="button"]'))
}

async function sendFromComposer(text) {
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
}

describe('session-isolation: G1 会话隔离', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('session-isolation: A 请求进行中切换到 B，B 的历史消息正常展示', async () => {
    setupDualSessions()
    renderWorkbench()

    // 初始激活会话为列表首项（会话 A）
    await screen.findByText('A 的历史回复')
    await sendFromComposer('进行中的问题 A')
    await screen.findByText('正在理解你的问题')

    clickSessionCard('会话 B')
    expect(await screen.findByText('B 的历史回复')).toBeInTheDocument()
    expect(screen.queryByText('A 的历史回复')).not.toBeInTheDocument()
  })

  test('session-isolation: A 请求进行中不阻塞会话 B 发送', async () => {
    const { chatRequests } = setupDualSessions()
    renderWorkbench()

    await screen.findByText('A 的历史回复')
    await sendFromComposer('进行中的问题 A')
    await screen.findByText('正在理解你的问题')

    clickSessionCard('会话 B')
    await screen.findByText('B 的历史回复')
    await sendFromComposer('问题 B')

    expect(await screen.findByText('模型回复：B-问题 B')).toBeInTheDocument()
    expect(chatRequests).toContain('session-b')
  })

  test('session-isolation: A 的迟到响应不写入 B 视图也不抢回当前会话', async () => {
    const { chatRequests, resolveAGate } = setupDualSessions()
    renderWorkbench()

    await screen.findByText('A 的历史回复')
    await sendFromComposer('进行中的问题 A')
    await screen.findByText('正在理解你的问题')

    clickSessionCard('会话 B')
    await screen.findByText('B 的历史回复')
    await sendFromComposer('问题 B')
    await screen.findByText('模型回复：B-问题 B')

    // 放行 A 的迟到响应，等待前端完成处理（写入会话 A 的 store 视图）
    resolveAGate()
    await waitFor(() => {
      expect(sessionRuntimeStore.getSessionMessages('session-a')?.some(
        (message) => message.text === '模型回复：A-进行中的问题 A',
      )).toBe(true)
    })
    expect(chatRequests.filter((id) => id === 'session-a')).toHaveLength(1)

    // A 的最终消息不写入当前（B）视图
    expect(screen.queryByText('模型回复：A-进行中的问题 A')).not.toBeInTheDocument()
    // 渲染源未被抢回：当前激活仍是会话 B
    expect(screen.getByText('会话 B').closest('[role="button"]')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('会话 A').closest('[role="button"]')).toHaveAttribute('aria-pressed', 'false')
    // B 的已有状态未被清空
    expect(screen.getByText('B 的历史回复')).toBeInTheDocument()
    expect(screen.getByText('问题 B')).toBeInTheDocument()
    expect(screen.getByText('模型回复：B-问题 B')).toBeInTheDocument()
  })

  test('session-isolation: 切回 A 后 A 的最终消息仍可见且不含 B 内容', async () => {
    const { resolveAGate } = setupDualSessions()
    renderWorkbench()

    await screen.findByText('A 的历史回复')
    await sendFromComposer('进行中的问题 A')
    await screen.findByText('正在理解你的问题')

    clickSessionCard('会话 B')
    await screen.findByText('B 的历史回复')
    await sendFromComposer('问题 B')
    await screen.findByText('模型回复：B-问题 B')

    resolveAGate()
    await waitFor(() => {
      expect(sessionRuntimeStore.getSessionMessages('session-a')?.some(
        (message) => message.text === '模型回复：A-进行中的问题 A',
      )).toBe(true)
    })

    clickSessionCard('会话 A')
    expect(await screen.findByText('模型回复：A-进行中的问题 A')).toBeInTheDocument()
    expect(screen.getByText('进行中的问题 A')).toBeInTheDocument()
    // A 视图不混入 B 的消息
    expect(screen.queryByText('模型回复：B-问题 B')).not.toBeInTheDocument()
    expect(screen.queryByText('B 的历史回复')).not.toBeInTheDocument()
  })

  test('session-isolation: SessionRail 七态徽标按会话键展示运行状态（Step 5）', async () => {
    setupDualSessions()
    renderWorkbench()
    await screen.findByText('A 的历史回复')

    // 活跃态映射：排队中 / 执行中 / 恢复中 / 等待确认 / 失败 / 已取消
    const activeStates = [
      ['queued', '排队中'],
      ['running', '执行中'],
      ['recovering', '恢复中'],
      ['waiting', '等待确认'],
      ['failed', '失败'],
      ['cancelled', '已取消'],
    ]
    for (const [status, label] of activeStates) {
      act(() => sessionRuntimeStore.setSessionRunStatus('session-a', status))
      expect(await screen.findByText(label)).toBeInTheDocument()
      act(() => sessionRuntimeStore.setSessionRunStatus('session-a', ''))
      await waitFor(() => expect(screen.queryByText(label)).not.toBeInTheDocument())
    }

    // 已完成 + 未读 → 已完成未读
    act(() => {
      sessionRuntimeStore.setSessionRunStatus('session-a', 'completed')
      sessionRuntimeStore.markSessionUnread('session-a', true)
    })
    expect(await screen.findByText('已完成未读')).toBeInTheDocument()
    // 已完成且已读（无未读标记）不展示徽标
    act(() => sessionRuntimeStore.markSessionUnread('session-a', false))
    await waitFor(() => expect(screen.queryByText('已完成未读')).not.toBeInTheDocument())
  })

  test('session-isolation: 切换到已完成未读会话后徽标消失（Step 5）', async () => {
    setupDualSessions()
    renderWorkbench()
    await screen.findByText('A 的历史回复')

    act(() => {
      sessionRuntimeStore.setSessionRunStatus('session-b', 'completed')
      sessionRuntimeStore.markSessionUnread('session-b', true)
    })
    expect(await screen.findByText('已完成未读')).toBeInTheDocument()

    clickSessionCard('会话 B')
    await screen.findByText('B 的历史回复')
    await waitFor(() => expect(screen.queryByText('已完成未读')).not.toBeInTheDocument())
  })

  // ISS-2026-08-09-003（离页返回旧缓存渲染、AI 回复不显示）RED 回归 ①：
  // 异步通道发送后切走，后台完成后切回会话——后端已落库的 assistant 回复必须渲染。
  test('ISS-2026-08-09-003: 异步通道完成后切回会话，assistant 回复必须渲染', async () => {
    const asyncChannel = setupAsyncChannel()
    renderWorkbench()

    await screen.findByText('A 的历史回复')
    await sendFromComposer('利润中心是什么？')
    await screen.findByText('正在理解你的问题')
    expect(asyncChannel.runSubmissions).toContain('session-a')

    // 切走：用户在后台执行期间离开会话（离页期间无 SSE 订阅，迟到结果进不了本地快照）
    clickSessionCard('会话 B')
    await screen.findByText('B 的历史回复')

    // 离页期间后台完成：后端落库 assistant 完整切题回复（工单根因取证 23:44:00）
    asyncChannel.completeRun('session-a', '利润中心是承载独立损益核算的最小经营单元。')

    // 切回会话：必须以后端 messages 为准渲染迟到回复，并清除已过期的 loading 占位
    clickSessionCard('会话 A')
    expect(await screen.findByText('利润中心是承载独立损益核算的最小经营单元。')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('正在理解你的问题')).not.toBeInTheDocument())
  })

  // ISS-2026-08-09-003（离页返回旧缓存渲染、AI 回复不显示）RED 回归 ②：
  // 会话切换时本地残留 loading 占位不得阻断目标会话消息刷新（历史同款 ISS 先例，记忆 3ad0df16）。
  test('ISS-2026-08-09-003: 会话切换时本地残留 loading 占位不得阻断目标会话消息刷新', async () => {
    // 目标会话 B：后端已有完整问答；本地 store 残留离页瞬间的「进行中」快照
    const histories = {
      'session-a': [{ role: 'user', content: '你好 A' }, { role: 'assistant', content: 'A 的历史回复' }],
      'session-b': [
        { role: 'user', content: '你好 B' },
        { role: 'assistant', content: 'B 的历史回复' },
        { role: 'user', content: '问题 B' },
        { role: 'assistant', content: 'B 的最新回复' },
      ],
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
        success: true,
        data: {
          items: [
            buildSession('session-a', '会话 A', histories['session-a']),
            buildSession('session-b', '会话 B', histories['session-b']),
          ],
        },
      })),
    )
    sessionRuntimeStore.setSessionMessages('session-b', [
      { id: 'local-user-1', role: 'user', text: '问题 B' },
      { id: 'local-loading-1', role: 'assistant', text: '正在理解你的问题', loading: true },
    ])
    renderWorkbench()

    await screen.findByText('A 的历史回复')
    clickSessionCard('会话 B')

    // 后端已覆盖该轮问答：后端消息必须刷新渲染，残留 loading 占位不得阻断也不得残留
    expect(await screen.findByText('B 的最新回复')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('正在理解你的问题')).not.toBeInTheDocument())
  })

  // ISS-2026-08-10-001（ISS-003 复验残留：回复未完成时返回占位不恢复）RED 回归：
  // 异步通道回复未完成时直接离开工作台页面（组件卸载，未切换会话）再进入——
  // 卸载瞬间的本地进行中占位必须写入快照并参与重挂载对账：问题气泡与
  // 「正在理解你的问题」占位均恢复渲染（后端尚无 assistant，后端消息为准、
  // 仅保留未完成进行中占位，与 ISS-003 C2 同一合并语义）。
  test('ISS-2026-08-10-001: 回复未完成时离页再返回，问题气泡与进行中占位均恢复渲染', async () => {
    const asyncChannel = setupAsyncChannel()
    const firstRender = renderWorkbench()

    await screen.findByText('A 的历史回复')
    await sendFromComposer('利润中心是什么？')
    await screen.findByText('正在理解你的问题')
    expect(asyncChannel.runSubmissions).toContain('session-a')

    // 回复未完成时离开工作台页面（整个工作台组件卸载）
    firstRender.unmount()

    // 重新进入工作台：后端此刻只有用户消息（assistant 未写完），
    // 问题气泡与进行中占位都必须从卸载快照对账恢复。
    renderWorkbench()
    expect(await screen.findByText('利润中心是什么？')).toBeInTheDocument()
    expect(await screen.findByText('正在理解你的问题')).toBeInTheDocument()
  })
})
