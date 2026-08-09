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

describe('System management sessions audit', () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })))
  })

  test('admin sees all users sessions on the sessions tab', async () => {
    renderAppAt('/system/sessions')

    expect(await screen.findByRole('heading', { name: '会话管理' })).toBeInTheDocument()
    expect(await screen.findByText('金蝶云星空评估会话')).toBeInTheDocument()
    expect(screen.getByText('标准治理评审会话')).toBeInTheDocument()
    // 跨用户聚合：admin 与 arch 的会话都出现（状态徽章 + 筛选下拉各含一份文本）
    expect(screen.getAllByText('粗估').length).toBeGreaterThan(0)
    expect(screen.getAllByText('标准评审').length).toBeGreaterThan(0)
    expect(screen.getByText(/共 2 条 AI 会话/)).toBeInTheDocument()

    // 侧边栏提供会话管理入口
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).getByRole('link', { name: /会话管理/ })).toHaveAttribute('href', '/system/sessions')
  })

  test('status filter narrows the audit list via server-side query', async () => {
    renderAppAt('/system/sessions')

    await screen.findByText('金蝶云星空评估会话')
    fireEvent.change(screen.getByRole('combobox', { name: '会话状态' }), { target: { value: 'standard_review' } })

    await waitFor(() => {
      expect(screen.queryByText('金蝶云星空评估会话')).not.toBeInTheDocument()
    }, { timeout: 3000 })
    expect(screen.getByText('标准治理评审会话')).toBeInTheDocument()
  })

  test('non-admin user is redirected away from the sessions audit page', async () => {
    server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[2] } })))

    renderAppAt('/system/sessions')

    expect(await screen.findByRole('heading', { name: 'AI 工作台' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '会话管理' })).not.toBeInTheDocument()
  })
})
