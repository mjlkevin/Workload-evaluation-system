import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockAiTools, mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function mockToolsResponse(items) {
  server.use(http.get(`${BASE}/system/ai-tools`, () => HttpResponse.json({ success: true, data: { items } })))
}

describe('System management AI tool inventory', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('admin sees the code-registered tools with write flags', async () => {
    renderAppAt('/system/tools')

    expect(await screen.findByRole('heading', { name: '工具清单' }, { timeout: 3000 })).toBeInTheDocument()
    expect(await screen.findByText('estimate_implementation', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('create_project')).toBeInTheDocument()
    expect(screen.getByText('list_tools')).toBeInTheDocument()

    // 写数据标记：3 个写工具带「会写数据」徽章，其余 6 个为「只读」
    expect(screen.getAllByText('会写数据')).toHaveLength(3)
    expect(screen.getAllByText('只读')).toHaveLength(6)
    expect(screen.getByText(/共 9 个工具/)).toBeInTheDocument()
    expect(screen.getByText(/其中 3 个会写数据/)).toBeInTheDocument()

    // admin 持有全部能力位：9 条「可调用」，没有一条被标记为不可调用
    expect(screen.getAllByText('可调用')).toHaveLength(9)
    expect(screen.queryByText('不可调用')).not.toBeInTheDocument()
    expect(screen.getByText(/你本人可调用 9 个/)).toBeInTheDocument()

    // 权限位与分类可见
    expect(screen.getAllByText('estimates:write').length).toBeGreaterThan(0)
    expect(screen.getByText('discovery')).toBeInTheDocument()

    // 侧边栏提供工具清单入口
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).getByRole('link', { name: /工具清单/ })).toHaveAttribute('href', '/system/tools')
  })

  test('tools the viewer cannot call stay listed with a quiet marker', async () => {
    // 系统管理员未必持有 estimates:* ——清单不得因此少报一个工具
    mockToolsResponse(mockAiTools.map((tool) => ({ ...tool, callable: tool.capability === 'estimates:read' })))
    renderAppAt('/system/tools')

    expect(await screen.findByText('create_project', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(10) // 表头 + 全部 9 个工具
    expect(screen.getAllByText('不可调用')).toHaveLength(4)
    expect(screen.getAllByText('可调用')).toHaveLength(5)
    expect(screen.getByText(/共 9 个工具/)).toBeInTheDocument()
    expect(screen.getByText(/你本人可调用 5 个/)).toBeInTheDocument()

    // 这是权限差异，不是错误：不得复用「会写数据」的 warn 告警色
    const marker = screen.getAllByText('不可调用')[0].closest('.bdg')
    expect(marker).toHaveClass('brd')
    expect(marker).not.toHaveClass('warn')
  })

  test('page states the inventory is code-driven and not editable here', async () => {
    renderAppAt('/system/tools')

    expect(
      await screen.findByText(
        '当前工具清单来自代码，不可在此编辑；清单列出系统注册的全部工具，「不可调用」只表示你本人缺少对应权限。启用/停用与审批策略将在后续版本提供。',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
  })

  test('empty registry renders the empty state without blanking the page', async () => {
    mockToolsResponse([])
    renderAppAt('/system/tools')

    expect(await screen.findByText('暂无已注册的工具', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工具清单' })).toBeInTheDocument()
    expect(screen.getByText(/共 0 个工具/)).toBeInTheDocument()
  })

  test('failed request renders the error state without blanking the page', async () => {
    server.use(
      http.get(`${BASE}/system/ai-tools`, () => new HttpResponse(null, { status: 500 })),
    )
    renderAppAt('/system/tools')

    expect(await screen.findByText(/工具清单加载失败/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工具清单' })).toBeInTheDocument()
    expect(screen.queryByText('estimate_implementation')).not.toBeInTheDocument()
  })

  test('non-admin user is redirected away from the tool inventory page', async () => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[2] } })),
    )
    renderAppAt('/system/tools')

    expect(await screen.findByRole('heading', { name: 'AI 工作台' }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '工具清单' })).not.toBeInTheDocument()
  })
})
