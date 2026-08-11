import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
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

describe('ModelProviders · 多供应商管理（ISS-2026-08-11-001 / RP-055）', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('供应商管理区以表格呈现：供应商/Base URL/模型/API Key/状态/操作', async () => {
    renderAppAtModelConfig()

    const table = await screen.findByRole('table', { name: '模型供应商' })
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual(['供应商', 'Base URL', '模型', 'API Key', '状态', '操作'])

    // 供应商行依赖草稿接口异步渲染，先在表内等其出现（场景表也会显示供应商名）
    await within(table).findByText('Moonshot（月之暗面）')
    expect(within(table).getByText('Moonshot（月之暗面）')).toBeInTheDocument()
    expect(within(table).getByText('智谱 GLM')).toBeInTheDocument()
    expect(within(table).getByText('https://open.bigmodel.cn/api/paas/v4')).toBeInTheDocument()
    // 模型 chips
    expect(within(table).getByText('kimi-k3')).toBeInTheDocument()
    expect(within(table).getByText('glm-4.6')).toBeInTheDocument()
    // Key 状态：moonshot 已配置（显示 hint）；智谱未配置
    expect(within(table).getByText(/····epCz/)).toBeInTheDocument()
    expect(within(table).getByText('未配置')).toBeInTheDocument()
  })

  test('提供「新增供应商」入口：点击弹出新增 Dialog（名称/Base URL/模型 ID）', async () => {
    renderAppAtModelConfig()

    const addBtn = await screen.findByRole('button', { name: /新增供应商/ })
    fireEvent.click(addBtn)

    const dialog = await screen.findByRole('dialog', { name: '新增供应商' })
    expect(within(dialog).getByText('供应商名称')).toBeInTheDocument()
    expect(within(dialog).getByText('Base URL')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('如 gpt-4o')).toBeInTheDocument()
    // 新建模式：Key 块提示保存后再配置
    expect(within(dialog).getByText(/保存供应商后可配置 API Key/)).toBeInTheDocument()
  })

  test('独立「API Key 管理」卡片已下线', async () => {
    renderAppAtModelConfig()

    await screen.findByRole('table', { name: '模型供应商' })
    expect(screen.queryByText('API Key 管理')).not.toBeInTheDocument()
  })

  test('页面去除 KIMI 固有文案：场景更名为业务命名', async () => {
    renderAppAtModelConfig()

    const table = await screen.findByRole('table', { name: '场景模型绑定' })
    expect(screen.queryByText('KIMI 评估')).not.toBeInTheDocument()
    expect(screen.queryByText('生成模型')).not.toBeInTheDocument()
    expect(within(table).getByText('实施评估')).toBeInTheDocument()
    expect(within(table).getByText('内容生成')).toBeInTheDocument()
  })

  test('场景编辑弹窗内嵌供应商选择、模型目录选择与该供应商 Key 管理块', async () => {
    renderAppAtModelConfig()

    const scenarioTable = await screen.findByRole('table', { name: '场景模型绑定' })
    const editButtons = within(scenarioTable).getAllByRole('button', { name: '编辑' })
    fireEvent.click(editButtons[0])

    const dialog = await screen.findByRole('dialog', { name: /编辑 实施评估/ })
    // 供应商下拉 + 模型下拉
    expect(within(dialog).getByText('模型供应商')).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: 'Moonshot（月之暗面）' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: '智谱 GLM' })).toBeInTheDocument()
    // 内嵌 Key 管理块：显示当前供应商 key hint + 测试连接按钮
    expect(within(dialog).getByText(/····epCz/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '测试连接' })).toBeInTheDocument()
  })

  test('新增供应商保存后草稿 PATCH 携带 modelProviders', async () => {
    let captured = null
    server.use(
      http.patch(`${BASE}/system/requirement-settings/draft`, async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ success: true, data: { version: 2, draft: captured, updatedAt: new Date().toISOString() } })
      }),
    )

    renderAppAtModelConfig()
    fireEvent.click(await screen.findByRole('button', { name: /新增供应商/ }))
    const dialog = await screen.findByRole('dialog', { name: '新增供应商' })
    fireEvent.change(within(dialog).getByPlaceholderText('如 OpenAI'), { target: { value: 'OpenAI' } })
    fireEvent.change(within(dialog).getByPlaceholderText('https://api.openai.com/v1'), { target: { value: 'https://api.openai.com/v1' } })
    fireEvent.change(within(dialog).getByPlaceholderText('如 gpt-4o'), { target: { value: 'gpt-4o' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存供应商' }))

    await waitFor(() => expect(captured).not.toBeNull())
    const names = (captured.modelProviders || []).map((p) => p.name)
    expect(names).toContain('OpenAI')
    const created = captured.modelProviders.find((p) => p.name === 'OpenAI')
    expect(created.baseUrl).toBe('https://api.openai.com/v1')
    expect(created.models.map((m) => m.id)).toContain('gpt-4o')
  })
})
