import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(within(navigation).getByRole('link', { name: /Skill 管理/ })).toHaveAttribute('href', '/system/ai/skills')
    expect(within(navigation).getByRole('link', { name: /模型配置/ })).toHaveAttribute('href', '/system/ai/model-config')
    expect(within(navigation).getByRole('link', { name: /知识库/ })).toHaveAttribute('href', '/system/ai/knowledge-base')
    expect(within(navigation).getByRole('link', { name: /RateCard/ })).toHaveAttribute('href', '/system/rules/rate-card')
    expect(within(navigation).getByRole('link', { name: /DSL 规则集/ })).toHaveAttribute('href', '/system/rules/dsl-rules')
    expect(within(navigation).getByRole('link', { name: /模板/ })).toHaveAttribute('href', '/system/rules/templates')
    expect(within(navigation).getByRole('link', { name: /测试结果/ })).toHaveAttribute('href', '/system/ops/test-results')
    expect(within(navigation).getByRole('link', { name: /状态机规则/ })).toHaveAttribute('href', '/system/rules/state-machines')
  })

  test('Skill 管理可从唯一三级路由到达', async () => {
    server.use(http.get(`${BASE}/skills`, () => HttpResponse.json({ code: 0, data: { items: [] } })), http.get(`${BASE}/skills/metadata`, () => HttpResponse.json({ code: 0, data: { viewerId: 'admin-1', roles: [], tools: [], modelScenarios: [], publishAvailable: false } })))
    renderAppAt('/system/ai/skills')
    expect(await screen.findByRole('heading', { name: 'Skill 管理' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '新建 Skill' })).toBeEnabled())
  })

  test('Workflow 管理三级入口挂载', async () => {
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ code: 0, data: { items: [] } })), http.get(`${BASE}/workflows/metadata`, () => HttpResponse.json({ code: 0, data: { viewerId: 'admin-1', roles: ['delivery'], tools: [], publishedSkills: [] } })))
    renderAppAt('/system/ai/workflows')
    expect(await screen.findByRole('heading', { name: 'Workflow 管理' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '新建 Workflow' })).toBeEnabled())
    expect(screen.getAllByRole('link', { name: /Workflow 管理/ })[0]).toHaveAttribute('href', '/system/ai/workflows')
  })

  test('opens a dedicated page for each system management submodule', async () => {
    renderAppAt('/system/rules/dsl-rules')

    expect(await screen.findByRole('heading', { name: 'DSL 规则集' })).toBeInTheDocument()
    expect(screen.getAllByText(/实施评估依赖规则/).length).toBeGreaterThan(0)
  })

  test('各页面正文不再重复渲染两层分类导航', async () => {
    renderAppAt('/system/ai/model-config')
    expect(await screen.findByRole('heading', { name: '模型配置' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '系统管理分组' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '系统管理配置分类' })).not.toBeInTheDocument()
  })

  test('从左侧菜单独立进入规则、模型和状态机页面', async () => {
    renderAppAt('/system/ai/model-config')
    await screen.findByRole('heading', { name: '模型配置' })
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    fireEvent.click(within(navigation).getByRole('link', { name: /编码规则/ }))
    expect(await screen.findByRole('heading', { name: '编码规则' })).toBeInTheDocument()
    fireEvent.click(within(navigation).getByRole('link', { name: /模型配置/ }))
    expect(await screen.findByRole('heading', { name: '模型配置' })).toBeInTheDocument()
    fireEvent.click(within(navigation).getByRole('link', { name: /状态机规则/ }))
    expect(await screen.findByRole('heading', { name: '状态机规则' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '系统管理配置分类' })).not.toBeInTheDocument()
  })
})
