import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('ModelConfig · 表格 + 行详情（RP-053）', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('场景以表格行呈现：列含场景/生效模型/来源/关键参数/最近验证/状态/操作', async () => {
    renderAppAtModelConfig()

    // 表头列齐全
    const table = await screen.findByRole('table')
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual(['场景', '生效模型', '来源', '关键参数', '最近验证', '状态', '操作'])

    // 三个场景行
    expect(screen.getByText('KIMI 评估')).toBeInTheDocument()
    expect(screen.getByText('文件解析')).toBeInTheDocument()
    expect(screen.getByText('生成模型')).toBeInTheDocument()

    // 生效模型来自 effective 接口
    expect(screen.getByText('kimi-k2.6')).toBeInTheDocument()
  })

  test('最近验证列显示 ✓ 与实测模型；来源列显示界面配置徽标', async () => {
    renderAppAtModelConfig()

    await screen.findByRole('table')
    // assessment 行 mock 带 lastVerified(ok=true, model=kimi-k2.5)
    expect(screen.getAllByText(/✓/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('界面配置').length).toBeGreaterThanOrEqual(1)
  })

  test('生成模型行置灰为"规划中"，编辑与验证按钮禁用', async () => {
    renderAppAtModelConfig()

    await screen.findByText('规划中')
    const verifyButtons = screen.getAllByRole('button', { name: '验证此场景' })
    const editButtons = screen.getAllByRole('button', { name: '编辑' })
    // 三行顺序：评估 / 解析 / 生成 —— 生成行（最后一个）禁用
    expect(verifyButtons[verifyButtons.length - 1]).toBeDisabled()
    expect(editButtons[editButtons.length - 1]).toBeDisabled()
    // 评估行可用
    expect(editButtons[0]).toBeEnabled()
    expect(verifyButtons[0]).toBeEnabled()
  })

  test('点击行展开行详情：显示接线参数与 notes；再点收起', async () => {
    renderAppAtModelConfig()

    const sceneCell = await screen.findByText('KIMI 评估')
    fireEvent.click(sceneCell.closest('tr'))

    // 展开详情：接线参数 chips + notes + 草稿 vs 生效
    expect(await screen.findByText('接线参数')).toBeInTheDocument()
    expect(screen.getByText('maxTokens')).toBeInTheDocument()
    expect(screen.getByText(/temperature 配置暂不生效/)).toBeInTheDocument()
    expect(screen.getByText('草稿 vs 生效')).toBeInTheDocument()

    // 再点收起
    fireEvent.click(screen.getByText('KIMI 评估').closest('tr'))
    await waitFor(() => expect(screen.queryByText('接线参数')).not.toBeInTheDocument())
  })

  test('验证此场景调用 scenario-test 并刷新最近验证', async () => {
    renderAppAtModelConfig()

    const verifyButtons = await screen.findAllByRole('button', { name: '验证此场景' })
    fireEvent.click(verifyButtons[0])

    // 成功后出现 toast 或行内刷新；scenario-test mock 返回 ok:true
    await waitFor(() => {
      // toast 成功文案（useToast 渲染到 body）
      expect(document.body.textContent).toMatch(/验证通过/)
    })
  })

  test('凭据健康徽标显示"凭据域托管"与 KEK 就绪', async () => {
    renderAppAtModelConfig()

    expect(await screen.findByText('凭据域托管（加密落库）')).toBeInTheDocument()
    expect(screen.getByText(/KEK 就绪/)).toBeInTheDocument()
    // 最近变更审计
    expect(screen.getByText(/最近变更/)).toBeInTheDocument()
  })
})
