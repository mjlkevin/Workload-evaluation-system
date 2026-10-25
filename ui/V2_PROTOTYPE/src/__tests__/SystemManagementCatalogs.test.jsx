import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const renderPage = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
beforeEach(() => server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ data: { user: mockUsers[0] } }))))

describe('系统规则资产目录统一列表', () => {
  test('模板按真实 list 响应读取版本，详情可读全量且无虚假使用入口', async () => {
    server.use(http.get('/api/v1/templates', () => HttpResponse.json({ data: { list: [{ templateId: 'real-template', templateName: '实际模板', templateVersion: '2026.10' }] } })))
    renderPage('/system/rules/templates')
    const table = await screen.findByRole('table', { name: '模板列表' })
    expect(within(table).getByText('实际模板')).toBeInTheDocument()
    expect(within(table).getByText('2026.10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用', exact: true })).not.toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: '查看 实际模板' }))
    const dialog = screen.getByRole('dialog', { name: '模板详情' })
    expect(within(dialog).getByText('real-template')).toBeInTheDocument()
    expect(within(dialog).getByText('2026.10')).toBeInTheDocument()
  })

  test('模板失败可重试，空数组不回退成默认资产', async () => {
    let fail = true
    server.use(http.get('/api/v1/templates', () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { list: [] } })))
    renderPage('/system/rules/templates')
    expect(await screen.findByRole('alert')).toHaveTextContent('模板加载失败')
    expect(screen.queryByText('快速交付轻量版')).not.toBeInTheDocument()
    fail = false; fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('暂无模板')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '模板列表' })).not.toBeInTheDocument()
  })

  test('模板长说明与标签参与搜索，后续页也可查看完整字段', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, name: `模板${index}`, description: `说明${index}`, tags: ['标签'] }))
    server.use(http.get('/api/v1/templates', () => HttpResponse.json({ data: { items } })))
    renderPage('/system/rules/templates')
    const table = await screen.findByRole('table', { name: '模板列表' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(within(table).getByRole('button', { name: '查看 模板11' }))
    expect(within(screen.getByRole('dialog')).getByText('说明11')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索模板' }), { target: { value: '说明0' } })
    expect(within(table).getByText('模板0')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
  })

  test('RateCard 明示默认参考来源，单价准确且无未接通编辑入口', async () => {
    renderPage('/system/rules/rate-card')
    const table = await screen.findByRole('table', { name: 'RateCard列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(screen.getAllByText('默认参考数据').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '编辑', exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('当前生效')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索RateCard' }), { target: { value: '架构师' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    fireEvent.click(within(table).getByRole('button', { name: '查看 架构师' }))
    expect(within(screen.getByRole('dialog', { name: '角色费率详情' })).getByText('¥4,000 CNY')).toBeInTheDocument()
  })
})
