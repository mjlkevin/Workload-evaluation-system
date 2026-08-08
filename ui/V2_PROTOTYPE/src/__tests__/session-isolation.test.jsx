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
import HomeWorkspace from '../pages/HomeWorkspace.jsx'
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
 */
function setupDualSessions() {
  const chatRequests = []
  let resolveAGate
  const aGate = new Promise((resolve) => { resolveAGate = resolve })
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: {
        items: [
          buildSession('session-a', '会话 A', [{ role: 'user', content: '你好 A' }, { role: 'assistant', content: 'A 的历史回复' }]),
          buildSession('session-b', '会话 B', [{ role: 'user', content: '你好 B' }, { role: 'assistant', content: 'B 的历史回复' }]),
        ],
      },
    })),
    http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
      const body = await request.json()
      chatRequests.push(body.sessionId)
      if (body.sessionId === 'session-a') {
        await aGate
        return HttpResponse.json(buildChatPayload('session-a', body, `模型回复：A-${body.messages.at(-1)?.content || ''}`))
      }
      return HttpResponse.json(buildChatPayload('session-b', body, `模型回复：B-${body.messages.at(-1)?.content || ''}`))
    }),
  )
  return { chatRequests, resolveAGate }
}

function renderWorkbench() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter><HomeWorkspace /></MemoryRouter>
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
})
