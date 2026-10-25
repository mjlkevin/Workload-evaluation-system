import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
}

describe('System management navigation', () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })))
    server.use(http.get(`${BASE}/system/state-machines`, () => HttpResponse.json({ code: 0, data: { items: [] } })))
  })

  test('redirects /system to the default system submodule page', async () => {
    renderAppAt('/system')

    expect(await screen.findByRole('heading', { name: '编码规则' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '系统管理' })).not.toBeInTheDocument()
  })

  test('旧扁平路由全量重定向到三级新址（外部链接/书签不断链）', async () => {
    renderAppAt('/system/code-rules')
    expect(await screen.findByRole('heading', { name: '编码规则' })).toBeInTheDocument()

    renderAppAt('/system/model-config')
    expect(await screen.findByRole('heading', { name: '模型配置' })).toBeInTheDocument()
  })

  test('renders system management as a non-clickable parent with submodule links', async () => {
    renderAppAt('/system/ai/model-config')

    await screen.findByRole('heading', { name: '模型配置' })

    expect(screen.queryByRole('link', { name: /系统管理/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /系统管理/ })).toBeInTheDocument()

    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).getByRole('link', { name: /编码规则/ })).toHaveAttribute('href', '/system/rules/code-rules')
    expect(within(navigation).getByRole('link', { name: /模型配置/ })).toHaveAttribute('href', '/system/ai/model-config')
    expect(within(navigation).getByRole('link', { name: /知识库/ })).toHaveAttribute('href', '/system/ai/knowledge-base')
    expect(within(navigation).getByRole('link', { name: /RateCard/ })).toHaveAttribute('href', '/system/rules/rate-card')
    expect(within(navigation).getByRole('link', { name: /DSL 规则集/ })).toHaveAttribute('href', '/system/rules/dsl-rules')
    expect(within(navigation).getByRole('link', { name: /模板/ })).toHaveAttribute('href', '/system/rules/templates')
    expect(within(navigation).getByRole('link', { name: /测试结果/ })).toHaveAttribute('href', '/system/ops/test-results')
    expect(within(navigation).getByRole('link', { name: /状态机规则/ })).toHaveAttribute('href', '/system/rules/state-machines')
  })

  test('opens a dedicated page for each system management submodule', async () => {
    renderAppAt('/system/rules/dsl-rules')

    expect(await screen.findByRole('heading', { name: 'DSL 规则集' })).toBeInTheDocument()
    expect(screen.getAllByText(/实施评估依赖规则/).length).toBeGreaterThan(0)
  })

  test('页签条两级：一级分组切换 + 组内只显本组子页', async () => {
    renderAppAt('/system/ai/model-config')

    const groupBar = await screen.findByRole('tablist', { name: '系统管理分组' })
    expect(within(groupBar).getByRole('tab', { name: /规则与标准/ })).toBeInTheDocument()
    expect(within(groupBar).getByRole('tab', { name: /AI 与模型/, selected: true })).toBeInTheDocument()
    expect(within(groupBar).getByRole('tab', { name: /运行与审计/ })).toBeInTheDocument()

    // 组内子页签只渲染当前分组：AI 组有知识库，不应串入规则组的编码规则
    const sectionBar = screen.getByRole('tablist', { name: '系统管理配置分类' })
    expect(within(sectionBar).getByRole('tab', { name: /知识库/ })).toBeInTheDocument()
    expect(within(sectionBar).queryByRole('tab', { name: /编码规则/ })).not.toBeInTheDocument()

    // 切换分组 → 跳到目标分组默认子页（URL 驱动，非局部状态）
    fireEvent.click(within(groupBar).getByRole('tab', { name: /规则与标准/ }))
    expect(await screen.findByRole('heading', { name: '编码规则' })).toBeInTheDocument()
  })

  test('两级页签均支持方向键与 Home/End，Tab 仅进入当前选中项', async () => {
    renderAppAt('/system/rules/state-machines')
    const groups = await screen.findByRole('tablist', { name: '系统管理分组' })
    const rules = within(groups).getByRole('tab', { name: '规则与标准' })
    expect(rules).toHaveAttribute('tabindex', '0')
    expect(within(groups).getByRole('tab', { name: 'AI 与模型' })).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(rules, { key: 'ArrowRight' })
    expect(await screen.findByRole('heading', { name: '模型配置' })).toBeInTheDocument()
    expect(within(groups).getByRole('tab', { name: 'AI 与模型' })).toHaveFocus()

    const sections = screen.getByRole('tablist', { name: '系统管理配置分类' })
    fireEvent.keyDown(within(sections).getByRole('tab', { selected: true }), { key: 'End' })
    expect(await screen.findByRole('heading', { name: '记忆管理' })).toBeInTheDocument()
    expect(within(sections).getByRole('tab', { selected: true })).toHaveFocus()
    fireEvent.keyDown(within(sections).getByRole('tab', { selected: true }), { key: 'Home' })
    expect(await screen.findByRole('heading', { name: '模型配置' })).toBeInTheDocument()
  })
})
