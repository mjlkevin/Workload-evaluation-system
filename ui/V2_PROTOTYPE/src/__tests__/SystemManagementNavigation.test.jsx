import { render, screen, within } from '@testing-library/react'
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
  })

  test('redirects /system to the default system submodule page', async () => {
    renderAppAt('/system')

    expect(await screen.findByRole('heading', { name: '编码规则' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '系统管理' })).not.toBeInTheDocument()
  })

  test('renders system management as a non-clickable parent with submodule links', async () => {
    renderAppAt('/system/model-config')

    await screen.findByRole('heading', { name: '模型配置' })

    expect(screen.queryByRole('link', { name: /系统管理/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /系统管理/ })).toBeInTheDocument()

    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).getByRole('link', { name: /编码规则/ })).toHaveAttribute('href', '/system/code-rules')
    expect(within(navigation).getByRole('link', { name: /模型配置/ })).toHaveAttribute('href', '/system/model-config')
    expect(within(navigation).getByRole('link', { name: /知识库/ })).toHaveAttribute('href', '/system/knowledge-base')
    expect(within(navigation).getByRole('link', { name: /RateCard/ })).toHaveAttribute('href', '/system/rate-card')
    expect(within(navigation).getByRole('link', { name: /DSL 规则集/ })).toHaveAttribute('href', '/system/dsl-rules')
    expect(within(navigation).getByRole('link', { name: /模板/ })).toHaveAttribute('href', '/system/templates')
    expect(within(navigation).getByRole('link', { name: /测试结果/ })).toHaveAttribute('href', '/system/test-results')
  })

  test('opens a dedicated page for each system management submodule', async () => {
    renderAppAt('/system/dsl-rules')

    expect(await screen.findByRole('heading', { name: 'DSL 规则集' })).toBeInTheDocument()
    expect(screen.getAllByText(/实施评估依赖规则/).length).toBeGreaterThan(0)
  })
})
