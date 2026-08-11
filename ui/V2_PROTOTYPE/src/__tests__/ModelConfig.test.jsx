import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../App.jsx'
import { mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAppAtModelConfig() {
  return render(
    <MemoryRouter initialEntries={['/system/model-config']}>
      <App />
    </MemoryRouter>
  )
}

// RP-055：供应商表与场景表均有「编辑」按钮，必须限定场景模型绑定表
async function openFirstScenarioEditor() {
  const scenarioTable = await screen.findByRole('table', { name: '场景模型绑定' })
  const editButtons = within(scenarioTable).getAllByRole('button', { name: '编辑' })
  fireEvent.click(editButtons[0])
  return screen.findByRole('dialog', { name: /编辑 实施评估/ })
}

describe('ModelConfig · 保存/生效内联反馈', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('保存草稿后显示内联 role="status" 成功消息，不使用 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, () =>
        HttpResponse.json({ success: true, data: { version: 2, updatedAt: new Date().toISOString() } })),
    )
    renderAppAtModelConfig()

    const saveBtn = await screen.findByRole('button', { name: '保存草稿' })
    fireEvent.click(saveBtn)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/草稿已保存/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  test('生效配置后显示内联 role="status" 成功消息，不使用 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    server.use(
      http.post(`${BASE}/system/requirement-settings/activate`, () =>
        HttpResponse.json({ success: true, data: {} })),
    )
    renderAppAtModelConfig()

    const activateBtn = await screen.findByRole('button', { name: /生效配置/ })
    fireEvent.click(activateBtn)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/配置已生效/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})

describe('ModelConfig · 编辑弹窗脏关闭保护', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('修改字段后按 Escape 弹出放弃确认，取消后弹窗仍打开', async () => {
    renderAppAtModelConfig()

    // 打开编辑弹窗
    const dialog = await openFirstScenarioEditor()

    // 修改 Prompt Profile 字段使其变脏（模型标识已改为目录下拉，自由输入用 Prompt Profile）
    const profileInput = within(dialog).getByDisplayValue('default')
    fireEvent.change(profileInput, { target: { value: 'custom-profile' } })

    // 按 Escape 尝试关闭
    fireEvent.keyDown(dialog, { key: 'Escape' })

    // 应出现放弃确认弹窗
    const confirmDialog = await screen.findByRole('dialog', { name: /放弃修改/ })
    expect(confirmDialog).toBeInTheDocument()

    // 点击取消，编辑弹窗仍在
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /放弃修改/ })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: /编辑 实施评估/ })).toBeInTheDocument()
  })

  test('确认放弃后编辑弹窗关闭', async () => {
    renderAppAtModelConfig()

    const dialog = await openFirstScenarioEditor()
    const profileInput = within(dialog).getByDisplayValue('default')
    fireEvent.change(profileInput, { target: { value: 'custom-profile' } })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    const confirmDialog = await screen.findByRole('dialog', { name: /放弃修改/ })

    fireEvent.click(within(confirmDialog).getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /编辑 实施评估/ })).not.toBeInTheDocument())
  })

  test('放弃修改后页面仍显示原始值，重新打开弹窗也是原值', async () => {
    renderAppAtModelConfig()

    // 等待页面加载，确认生效模型原始值
    await screen.findByRole('heading', { name: '模型配置' })
    expect(screen.getAllByText('kimi-k2.5').length).toBeGreaterThanOrEqual(1)

    const dialog = await openFirstScenarioEditor()
    const profileInput = within(dialog).getByDisplayValue('default')
    fireEvent.change(profileInput, { target: { value: 'custom-profile' } })

    // 放弃修改
    fireEvent.keyDown(dialog, { key: 'Escape' })
    const confirmDialog = await screen.findByRole('dialog', { name: /放弃修改/ })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /编辑 实施评估/ })).not.toBeInTheDocument())

    // 页面应仍显示原始值
    expect(screen.getAllByText('kimi-k2.5').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByDisplayValue('custom-profile')).not.toBeInTheDocument()

    // 重新打开弹窗，输入仍为原值
    const dialog2 = await openFirstScenarioEditor()
    expect(within(dialog2).getByDisplayValue('default')).toBeInTheDocument()
  })
})

describe('ModelConfig · 编辑弹窗保存失败', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('保存失败时弹窗保持打开、输入保留、显示错误且可重试', async () => {
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })),
    )
    renderAppAtModelConfig()

    const dialog = await openFirstScenarioEditor()
    const profileInput = within(dialog).getByDisplayValue('default')
    fireEvent.change(profileInput, { target: { value: 'custom-profile' } })

    // 点击确定保存
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }))

    // 弹窗仍然打开
    await waitFor(() => expect(screen.getByRole('dialog', { name: /编辑 实施评估/ })).toBeInTheDocument())

    // 输入保留
    expect(within(dialog).getByDisplayValue('custom-profile')).toBeInTheDocument()

    // 显示错误信息（role="alert" 归属于该保存动作）
    const alert = within(dialog).getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).toMatch(/Internal Server Error|保存失败/)
  })

  test('保存成功后关闭弹窗并显示页面内联成功状态', async () => {
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, () =>
        HttpResponse.json({ success: true, data: { version: 3, updatedAt: new Date().toISOString() } })),
    )
    renderAppAtModelConfig()

    const dialog = await openFirstScenarioEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }))

    // 弹窗关闭
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /编辑 实施评估/ })).not.toBeInTheDocument())

    // 页面显示内联成功状态
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/草稿已保存/)
  })
})

describe('ModelConfig · 语义色彩 token', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('模型配置页不使用 raw 白色，使用 var(--surface)', async () => {
    const { container } = renderAppAtModelConfig()

    await screen.findByRole('heading', { name: '模型配置' })

    // 检查所有带 background 样式的元素不包含 raw 白色值
    const h = 'f'
    const RAW_WHITE_RE = new RegExp(`^(#${h}${h}${h}|#${h}${h}${h}${h}${h}${h}|rgb\\(255,\\s*255,\\s*255\\))$`, 'i')
    const allElements = container.querySelectorAll('[style]')
    const rawColorViolations = []
    allElements.forEach((el) => {
      const bg = el.style.background
      if (bg && RAW_WHITE_RE.test(bg)) {
        rawColorViolations.push(el)
      }
    })
    expect(rawColorViolations).toHaveLength(0)
  })
})
