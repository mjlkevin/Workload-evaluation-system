import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// RP-055：API Key 管理从独立卡片迁入场景编辑弹窗（按供应商维度）
async function openScenarioEditDialog() {
  const scenarioTable = await screen.findByRole('table', { name: '场景模型绑定' })
  const editButtons = within(scenarioTable).getAllByRole('button', { name: '编辑' })
  fireEvent.click(editButtons[0])
  return screen.findByRole('dialog', { name: /编辑 实施评估/ })
}

beforeEach(() => {
  // 非 JWT 形状 token：isAuthenticated 视为有效，仅用于启用 API 调用路径
  localStorage.setItem('wes_token', 'test-token-not-a-jwt')
})

describe('SystemManagement 供应商 API Key 测试连接反馈（内嵌场景编辑弹窗）', () => {
  test('失败时页面内联展示错误信息（不再仅依赖 toast）', async () => {
    server.use(
      http.post(`${BASE}/system/requirement-settings/providers/:providerId/api-key/test`, () =>
        HttpResponse.json(
          { code: 40001, message: 'API Key 无效或未授权', details: [] },
          { status: 400 },
        ),
      ),
    )
    renderModelSection()
    const dialog = await openScenarioEditDialog()

    const input = within(dialog).getByPlaceholderText(INPUT_PLACEHOLDER)
    fireEvent.change(input, { target: { value: 'sk-invalid-key' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '测试连接' }))

    const hits = await within(dialog).findAllByText('API Key 无效或未授权')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  test('成功时内联展示通过结果与模型/延迟明细', async () => {
    renderModelSection()
    const dialog = await openScenarioEditDialog()

    const input = within(dialog).getByPlaceholderText(INPUT_PLACEHOLDER)
    fireEvent.change(input, { target: { value: 'sk-valid-key' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '测试连接' }))

    const hits = await within(dialog).findAllByText(/连接测试通过/)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const detailHits = await within(dialog).findAllByText(/延迟: 600ms/)
    expect(detailHits.length).toBeGreaterThanOrEqual(1)
  })

  test('未输入新密钥时「保存密钥」按钮禁用，不发请求', async () => {
    let putCalls = 0
    server.use(
      http.put(`${BASE}/system/requirement-settings/providers/:providerId/api-key`, () => {
        putCalls += 1
        return HttpResponse.json({ success: true, data: { providerId: 'moonshot', keySource: 'store', keyHint: '····wxyz' } })
      }),
    )
    renderModelSection()
    const dialog = await openScenarioEditDialog()

    const saveKeyBtn = within(dialog).getByRole('button', { name: '保存密钥' })
    expect(saveKeyBtn).toBeDisabled()
    await waitFor(() => expect(putCalls).toBe(0))
  })
})
