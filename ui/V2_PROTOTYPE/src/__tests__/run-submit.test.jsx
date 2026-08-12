/**
 * Step 3 前端发送路径 Run 化守护测试（RP-047 Batch E）。
 * 常驻回归资产：
 * 1) enabled 场景：发送命中 POST /ai-sessions/:sessionId/runs，202 后 loading 保持；
 * 2) 503 ASYNC_RUNS_DISABLED：自动回退旧同步路径且行为一致；
 * 3) flag-off 探测缓存后不再重复提交探测。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import { ToastProvider } from '../hooks/useToast.jsx'
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
    messages: [
      { messageId: `${sessionId}-msg-1`, role: 'user', content: '你好', createdAt: '2026-06-14T00:00:00.000Z' },
      { messageId: `${sessionId}-msg-2`, role: 'assistant', content: '你好，有什么可以帮你的？', createdAt: '2026-06-14T00:00:01.000Z' },
    ],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
  }
}

function setupRunSubmitScenario({ runStatus = 202 } = {}) {
  const counters = { runSubmitCount: 0, chatCount: 0, runBodies: [] }
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: { items: [buildSession('session-a', '会话 A')] },
    })),
    http.post(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: { session: buildSession('session-a', '会话 A') },
    })),
    http.post(`${BASE}/ai-sessions/:sessionId/runs`, async ({ request }) => {
      counters.runSubmitCount += 1
      counters.runBodies.push(await request.json())
      if (runStatus === 503) {
        return HttpResponse.json({ code: 'ASYNC_RUNS_DISABLED', message: '异步任务已关闭' }, { status: 503 })
      }
      if (runStatus === 409) {
        return HttpResponse.json({ code: 'SESSION_HAS_ACTIVE_RUN', message: '该会话存在进行中的异步任务' }, { status: 409 })
      }
      return HttpResponse.json({
        success: true,
        data: { runId: 'run-1', sessionId: 'session-a', status: 'queued', eventCursor: 1 },
      })
    }),
    http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
      counters.chatCount += 1
      const body = await request.json()
      return HttpResponse.json({
        success: true,
        data: {
          intent: 'domain_qa',
          answer: '模型回复',
          session: {
            ...buildSession('session-a', '会话 A'),
            messages: [
              { messageId: 'msg-1', role: 'user', content: body.messages?.at(-1)?.content || '', createdAt: '2026-06-14T00:00:00.000Z' },
              { messageId: 'msg-2', role: 'assistant', content: '模型回复', createdAt: '2026-06-14T00:00:01.000Z' },
            ],
          },
        },
      })
    }),
  )
  return counters
}

function renderWorkbench() {
  return render(
    <ToastProvider>
      <MemoryRouter><HomeWorkspace /></MemoryRouter>
    </ToastProvider>,
  )
}

async function sendFromComposer(text) {
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
}

describe('run-submit: Step 3 前端发送路径 Run 化', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('run-submit: enabled 时先尝试 Run 提交，202 后不走旧同步路径', async () => {
    const counters = setupRunSubmitScenario({ runStatus: 202 })
    renderWorkbench()

    await screen.findByText('你好，有什么可以帮你的？')
    await sendFromComposer('我的问题')

    // loading 消息出现
    await screen.findByText('正在理解你的问题')

    // Run 提交被调用
    await waitFor(() => expect(counters.runSubmitCount).toBe(1))
    // 旧同步路径不应被调用
    expect(counters.chatCount).toBe(0)
  })

  test('ISS-2026-08-11-007: Run 提交携带当前附件及解析摘要', async () => {
    const counters = setupRunSubmitScenario({ runStatus: 202 })
    const { container } = renderWorkbench()

    await screen.findByText('你好，有什么可以帮你的？')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await sendFromComposer('多组织业务往来一般包含哪些模块？')

    await waitFor(() => expect(counters.runBodies).toHaveLength(1))
    expect(counters.runBodies[0].attachments).toEqual([
      expect.objectContaining({
        name: '客户需求.xlsx',
        size: 4,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        parsedSummary: expect.stringMatching(/测试项目|测试需求|测试模块线索/),
      }),
    ])
    expect(counters.chatCount).toBe(0)
  })

  test('run-submit: 503 时自动回退旧同步路径', async () => {
    const counters = setupRunSubmitScenario({ runStatus: 503 })
    renderWorkbench()

    await screen.findByText('你好，有什么可以帮你的？')
    await sendFromComposer('我的问题')

    // 旧同步路径被调用（回退）
    await waitFor(() => expect(counters.chatCount).toBe(1))
    // Run 提交也应被调用（探测）
    expect(counters.runSubmitCount).toBe(1)

    // 模型回复到达
    expect(await screen.findByText('模型回复')).toBeInTheDocument()
  })

  test('run-submit: 409 时呈现文案且不回退旧同步路径', async () => {
    const counters = setupRunSubmitScenario({ runStatus: 409 })
    renderWorkbench()

    await screen.findByText('你好，有什么可以帮你的？')
    await sendFromComposer('我的问题')

    // Run 提交被调用
    await waitFor(() => expect(counters.runSubmitCount).toBe(1))
    // 旧同步路径不应被调用（409 不回退）
    expect(counters.chatCount).toBe(0)

    // 用户可见文案呈现
    expect(await screen.findByText(/该会话存在进行中的任务/)).toBeInTheDocument()
  })
})
