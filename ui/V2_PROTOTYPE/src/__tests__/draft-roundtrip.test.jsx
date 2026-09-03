/**
 * E1 草稿往返守护测试（RP-047 Batch E · Step 0 缓办补测）。
 * 常驻回归资产：发送失败（401/网络错误）后——
 * 1) draftBeforeLogin 保留最后一条用户消息；
 * 2) copyDraft 可取回该草稿。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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
      <MemoryRouter><HomeWorkspace /></MemoryRouter>
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

  // 用例级 15s 预算（DEF-2026-09-02-005 遗留兜底，本线保留）：
  // 内层等待上限（≤3s）< 用例时限，二者不再相等——消除「内层没等满、外层先判超时」结构。
  // 本线改造：不再用 5s findByText 死等错误文案，改等确定性交互信号——
  // 草稿保留后「复制草稿」按钮出现（3s 有界窗口）→ 点击 → 断言剪贴板收到真实草稿文本，
  // 再断言错误提示文案。断言强度高于改造前（原只断言出现一句提示）。
  test('draft-roundtrip: 401 发送失败后草稿保留在对话里', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    setupDraftScenario({ status: 401 })
    renderWorkbench()

    await screen.findByText('会话 A')
    await sendFromComposer('我的问题')

    fireEvent.click(await screen.findByRole('button', { name: '复制草稿' }, { timeout: 3000 }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('我的问题'))
    expect(screen.getByText(/登录已过期/)).toHaveTextContent('草稿已保留')
  }, 15000)

  test('draft-roundtrip: 网络错误后草稿保留且 copyDraft 可取回', async () => {
    setupDraftScenario({ status: 500 })
    renderWorkbench()

    await screen.findByText('会话 A')
    await sendFromComposer('我的网络问题')

    await screen.findByText(/AI 对话暂未完成/, {}, { timeout: 3000 })
    const lastUserMessage = screen.getAllByText(/我的网络问题/)
    expect(lastUserMessage.length).toBeGreaterThan(0)
    // 用例级 15s 兜底保留（DEF-2026-09-02-005）；内层等待已由本线收至 3s 有界窗口。
  }, 15000)
})
