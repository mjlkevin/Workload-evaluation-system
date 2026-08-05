import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'
const INPUT_PLACEHOLDER = '输入新 API Key（留空则不修改）'

function renderModelSection() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter>
        <SystemManagement sectionId="model" />
      </MemoryRouter>
    </ToastProvider>
  )
}

beforeEach(() => {
  // 非 JWT 形状 token：isAuthenticated 视为有效，仅用于启用 API 调用路径
  localStorage.setItem('wes_token', 'test-token-not-a-jwt')
})

describe('SystemManagement API Key 测试连接反馈', () => {
  test('失败时页面内联展示错误信息（不再仅依赖 toast）', async () => {
    server.use(
      http.post(`${BASE}/system/requirement-settings/kimi-api-key/test`, () =>
        HttpResponse.json(
          { code: 40001, message: 'API Key 无效或未授权', details: [] },
          { status: 400 },
        ),
      ),
    )
    renderModelSection()

    const input = await screen.findByPlaceholderText(INPUT_PLACEHOLDER)
    fireEvent.change(input, { target: { value: 'sk-invalid-key' } })
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

    const hits = await screen.findAllByText('API Key 无效或未授权')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  test('成功时内联展示通过结果与模型/延迟明细', async () => {
    server.use(
      http.post(`${BASE}/system/requirement-settings/kimi-api-key/test`, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            ok: true,
            testedSource: 'request_body',
            requestedModel: 'kimi-k3',
            respondedModel: 'kimi-k3',
            modelMatch: true,
            latencyMs: 120,
            httpStatus: 200,
          },
        }),
      ),
    )
    renderModelSection()

    const input = await screen.findByPlaceholderText(INPUT_PLACEHOLDER)
    fireEvent.change(input, { target: { value: 'sk-valid-key' } })
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

    const hits = await screen.findAllByText(/连接测试通过/)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    // toast detail 与页面内联结果行各含一处明细，双匹配为预期行为
    const detailHits = await screen.findAllByText(/延迟: 120ms/)
    expect(detailHits.length).toBeGreaterThanOrEqual(1)
  })

  test('未输入密钥时直接提示且不发请求', async () => {
    let calls = 0
    server.use(
      http.post(`${BASE}/system/requirement-settings/kimi-api-key/test`, () => {
        calls += 1
        return HttpResponse.json({ code: 0, message: 'ok', data: { ok: true } })
      }),
    )
    renderModelSection()

    await screen.findByPlaceholderText(INPUT_PLACEHOLDER)
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

    const hits = await screen.findAllByText('请先输入要测试的 API Key')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(calls).toBe(0))
  })
})
