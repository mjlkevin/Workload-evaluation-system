import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { delay, http, HttpResponse } from 'msw'
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
    const table = await screen.findByRole('table', { name: '场景模型绑定' })
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual(['场景', '生效模型', '来源', '关键参数', '最近验证', '状态', '操作'])

    // 三个场景行（业务命名，去 KIMI 文案；侧栏导航有同名链接，须限定表内）
    expect(within(table).getByText('实施评估')).toBeInTheDocument()
    expect(within(table).getByText('文件解析')).toBeInTheDocument()
    expect(within(table).getByText('内容生成')).toBeInTheDocument()

    // 生效模型来自 effective 接口
    expect(within(table).getByText('kimi-k2.6')).toBeInTheDocument()
  })

  test('最近验证列显示 ✓ 与实测模型；来源列显示界面绑定徽标', async () => {
    renderAppAtModelConfig()

    await screen.findByRole('table', { name: '场景模型绑定' })
    // assessment 行 mock 带 lastVerified(ok=true, model=kimi-k2.5)
    expect(screen.getAllByText(/✓/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('界面绑定').length).toBeGreaterThanOrEqual(1)
  })

  test('内容生成行置灰为"规划中"，编辑与验证按钮禁用', async () => {
    renderAppAtModelConfig()

    const scenarioTable = await screen.findByRole('table', { name: '场景模型绑定' })
    expect(within(scenarioTable).getByText('规划中')).toBeInTheDocument()
    const verifyButtons = Array.from(scenarioTable.querySelectorAll('button')).filter((b) => b.textContent.includes('验证此场景'))
    const editButtons = Array.from(scenarioTable.querySelectorAll('button')).filter((b) => b.textContent === '编辑')
    // 三行顺序：评估 / 解析 / 生成 —— 生成行（最后一个）禁用
    expect(verifyButtons[verifyButtons.length - 1]).toBeDisabled()
    expect(editButtons[editButtons.length - 1]).toBeDisabled()
    // 评估行可用
    expect(editButtons[0]).toBeEnabled()
    expect(verifyButtons[0]).toBeEnabled()
  })

  test('明确查看入口打开统一详情，保留接线与差异并可关闭', async () => {
    renderAppAtModelConfig()

    const scenarioTable = await screen.findByRole('table', { name: '场景模型绑定' })
    fireEvent.click(within(scenarioTable).getByRole('button', { name: '查看 实施评估' }))
    expect(screen.getByRole('dialog', { name: '场景模型详情' })).toBeInTheDocument()

    // 展开详情：接线参数 chips + notes + 草稿 vs 生效
    expect(await screen.findByText('接线参数')).toBeInTheDocument()
    expect(screen.getByText('maxTokens')).toBeInTheDocument()
    expect(screen.getByText(/temperature 配置暂不生效/)).toBeInTheDocument()
    expect(screen.getByText('草稿 vs 生效')).toBeInTheDocument()

    // 再点收起
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭', exact: true }))
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
  test('供应商与场景列表可搜索，查看不触发编辑或验证', async () => {
    renderAppAtModelConfig()
    await screen.findByRole('table', { name: '场景模型绑定' })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索场景模型绑定' }), { target: { value: '文件解析' } })
    expect(within(screen.getByRole('table', { name: '场景模型绑定' })).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('searchbox', { name: '搜索模型供应商' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看 文件解析' }))
    expect(within(screen.getByRole('dialog', { name: '场景模型详情' })).getByText('接线参数')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '编辑 文件解析' })).not.toBeInTheDocument()
  })

  test('模型读取失败明确报错且可重试，不把默认表格当生效配置', async () => {
    let fail = true
    server.use(http.get(`${BASE}/system/requirement-settings`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { draft: { modelProviders: [] } } })))
    renderAppAtModelConfig()
    expect((await screen.findAllByRole('alert')).some((node) => node.textContent.includes('模型配置加载失败'))).toBe(true)
    expect(screen.queryByRole('table', { name: '场景模型绑定' })).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0])
    expect(await screen.findByRole('table', { name: '场景模型绑定' })).toBeInTheDocument()
  })

  test('effective read failure cannot silently promote a draft model to active, and retry refreshes effective state', async () => {
    let fail = true
    server.use(http.get(`${BASE}/system/requirement-settings/effective`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { credentials: { configured: true }, scenarios: [{ key: 'assessment', wired: true, resolvedModel: 'restored-effective-model', wiredParams: [], providerName: '恢复供应商' }] } })))
    renderAppAtModelConfig()
    expect((await screen.findAllByRole('alert')).some((node) => node.textContent.includes('生效模型加载失败'))).toBe(true)
    expect(screen.queryByRole('table', { name: '场景模型绑定' })).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0])
    expect(await screen.findByText('restored-effective-model')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看 实施评估' }))
    expect(within(screen.getByRole('dialog')).getByText('恢复供应商')).toBeInTheDocument()
  })

  test('model loading and read failure block save and activation to protect the stored configuration', async () => {
    let writes = 0
    server.use(
      http.get(`${BASE}/system/requirement-settings`, async () => { await delay(80); return new HttpResponse(null, { status: 500 }) }),
      http.patch(`${BASE}/system/requirement-settings/draft`, () => { writes += 1; return HttpResponse.json({ data: {} }) }),
      http.post(`${BASE}/system/requirement-settings/activate`, () => { writes += 1; return HttpResponse.json({ data: {} }) }),
    )
    renderAppAtModelConfig()
    const save = await screen.findByRole('button', { name: '保存草稿' })
    const activate = screen.getByRole('button', { name: /生效配置/ })
    expect(save).toBeDisabled()
    expect(activate).toBeDisabled()
    await screen.findAllByRole('alert')
    expect(save).toBeDisabled()
    expect(activate).toBeDisabled()
    fireEvent.click(save); fireEvent.click(activate)
    expect(writes).toBe(0)
  })

})
