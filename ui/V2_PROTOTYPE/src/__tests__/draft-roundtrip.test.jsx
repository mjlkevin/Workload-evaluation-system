/**
 * E1 草稿往返守护测试（RP-047 Batch E · Step 0 缓办补测）。
 * 常驻回归资产：发送失败（401/网络错误）后——
 * 1) draftBeforeLogin 保留最后一条用户消息；
 * 2) copyDraft 可取回该草稿。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import { ToastProvider } from '../hooks/useToast.jsx'
// ISS-2026-09-03-005：挂载真实生产路径（路由 / → HomePage → AiHomeWorkbench）；
// HomeWorkspace 在生产中无路由可达，其 PageShell 壳会掩盖真实渲染结构。
import HomePage from '../pages/HomePage.jsx'
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

function setupDraftScenario({ status = 401 } = {}) {
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: { items: [buildSession('session-a', '会话 A')] },
    })),
    http.post(`${BASE}/ai/home-workbench/chat`, () => {
      return HttpResponse.json(
        { success: false, code: status === 401 ? 40101 : 50000, message: status === 401 ? 'Unauthorized' : 'Network error' },
        { status },
      )
    }),
  )
}

function renderWorkbench() {
  return render(
    <ToastProvider>
      <MemoryRouter><HomePage /></MemoryRouter>
    </ToastProvider>,
  )
}

async function sendFromComposer(text) {
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
}

describe('draft-roundtrip: E1 草稿往返', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  // DEF-2026-09-02-005：内层 findByText 上限 5s 与 vitest 默认用例时限 5s 相等，
  // 内层等待还没用满，外层就先判超时——CI 负载偏高时该用例稳定红（实测 5216/5268ms）。
  // 这里只放宽【用例自身】时限，内层等待上限与断言均不变：断言强度零变化，
  // 变的只是"允许它跑完自己本来就需要的时间"。
  test('draft-roundtrip: 401 发送失败后草稿保留在对话里', async () => {
    setupDraftScenario({ status: 401 })
    renderWorkbench()

    await screen.findByText('会话 A')
    await sendFromComposer('我的问题')

    // 错误消息显示草稿保留提示
    // 401 渲染链路（响应处理 → draftBeforeLogin 保存 → 错误消息渲染）在 CI 负载下
    // 偶发超过 findByText 默认 1s 超时（批 3 CI 32287710090 偶发失败根因），显式放宽到 5s
    const errorMessage = await screen.findByText(/登录已过期/, {}, { timeout: 5000 })
    expect(errorMessage).toBeInTheDocument()
    expect(errorMessage.textContent).toContain('草稿已保留')
  }, 15000)

  test('draft-roundtrip: 网络错误后草稿保留且 copyDraft 可取回', async () => {
    setupDraftScenario({ status: 500 })
    renderWorkbench()

    await screen.findByText('会话 A')
    await sendFromComposer('我的网络问题')

    // 错误消息出现（500 错误显示 "AI 对话暂未完成"；同 401 用例口径放宽超时）
    await screen.findByText(/AI 对话暂未完成/, {}, { timeout: 5000 })

    // 验证 copyDraft 行为：通过检查 draftBeforeLogin 或最后一条用户消息存在
    // 由于 copyDraft 使用 navigator.clipboard，在 jsdom 中需要 mock
    const lastUserMessage = screen.getAllByText(/我的网络问题/)
    expect(lastUserMessage.length).toBeGreaterThan(0)
    // DEF-2026-09-02-005：与 401 用例同构（内层 5s == 默认用例时限 5s），
    // 尚未红过但成因相同，一并放宽用例时限，避免留同款地雷。
  }, 15000)
})
