import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import AiSessionAuditPanel from '../components/system/AiSessionAuditPanel.jsx'
import { server } from './mocks/server.js'

const session = { sessionId: 'session-full-id-001', title: '审计会话', ownerUserId: 'owner-001', ownerUsername: 'audit-user', businessRole: 'presales', domain: 'business_evaluation', workflowKey: 'business-evaluation', status: 'rough_estimate', turnCount: 4, messageCount: 8, attachmentCount: 2, artifactCount: 1, firstUserMessage: '首轮完整返回内容', lastAssistantMessage: '最终完整返回内容', createdAt: '2026-10-20T01:23:00Z', updatedAt: '2026-10-21T04:56:00Z' }
const ok = (items) => HttpResponse.json({ code: 'OK', data: { items } })
const mockList = (items = [session]) => server.use(http.get('/api/v1/system/ai-sessions', () => ok(items)))

describe('会话审计统一列表与只读详情', () => {
  test('102条返回项按10行分页，摘要列表只留六列且只有服务端搜索', async () => {
    mockList(Array.from({ length: 102 }, (_, index) => ({ ...session, sessionId: `session-${index}`, title: `审计会话${index}` })))
    render(<AiSessionAuditPanel />)
    const table = await screen.findByRole('table', { name: '已加载会话列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(within(table).getAllByRole('columnheader').map((el) => el.textContent)).toEqual(['标题', '用户', '状态', '轮次', '最后活动', '操作'])
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
    expect(screen.getByRole('searchbox', { name: '会话搜索' })).toBeInTheDocument()
    expect(screen.getByText(/已加载 102 条 AI 会话/)).toBeInTheDocument()
    expect(screen.queryByText(session.firstUserMessage)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('button', { name: '查看审计会话10' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看审计会话0' })).not.toBeInTheDocument()
    for (let page = 2; page < 11; page++) fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '查看审计会话101' })).toBeInTheDocument()
  })

  test('完整返回字段只读显示于共享弹窗，关闭恢复焦点且无写API', async () => {
    mockList()
    const writes = vi.spyOn(apiClient, 'post')
    const patches = vi.spyOn(apiClient, 'patch')
    const puts = vi.spyOn(apiClient, 'put')
    const deletes = vi.spyOn(apiClient, 'delete')
    render(<AiSessionAuditPanel />)
    const trigger = await screen.findByRole('button', { name: `查看${session.title}` })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '会话详情' })
    for (const value of [session.sessionId, session.ownerUserId, session.ownerUsername, session.title, session.workflowKey, session.firstUserMessage, session.lastAssistantMessage, session.createdAt, session.updatedAt]) expect(within(dialog).getByText(value)).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /保存|应用|删除/ })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    for (const spy of [writes, patches, puts, deletes]) expect(spy).not.toHaveBeenCalled()
  })

  test('q、状态、领域、起止时间均向服务端传递，刷新保留，重置清空', async () => {
    const queries = []
    server.use(http.get('/api/v1/system/ai-sessions', ({ request }) => { queries.push(Object.fromEntries(new URL(request.url).searchParams)); return ok([session]) }))
    render(<AiSessionAuditPanel />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByRole('searchbox', { name: '会话搜索' }), { target: { value: '审计' } })
    fireEvent.change(screen.getByRole('combobox', { name: '会话状态' }), { target: { value: 'rough_estimate' } })
    fireEvent.change(screen.getByRole('combobox', { name: '会话领域' }), { target: { value: 'business_evaluation' } })
    fireEvent.change(screen.getByLabelText('最后活动起始日期'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('最后活动结束日期'), { target: { value: '2026-10-21' } })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await screen.findByRole('table')
    const expected = { q: '审计', status: 'rough_estimate', domain: 'business_evaluation', from: '2026-10-20', to: '2026-10-21' }
    expect(queries.at(-1)).toEqual(expected)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('table')
    expect(queries.at(-1)).toEqual(expected)
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    await screen.findByRole('table')
    expect(queries.at(-1)).toEqual({})
  })

  test('筛选改变即隐藏旧范围，防抖窗口内旧成功或失败响应不能更新列表', async () => {
    let resolveOld
    let rejectOlder
    const old = new Promise((resolve) => { resolveOld = resolve })
    const older = new Promise((_, reject) => { rejectOlder = reject })
    const reads = vi.spyOn(apiClient, 'get').mockImplementation((_path, params) => {
      if (params.q === '旧筛选') return old
      if (params.q === '更旧筛选') return older
      return Promise.resolve({ data: { items: [{ ...session, title: params.q || '最初会话' }] } })
    })
    render(<AiSessionAuditPanel />)
    await screen.findByRole('button', { name: '查看最初会话' })
    fireEvent.change(screen.getByRole('searchbox', { name: '会话搜索' }), { target: { value: '更旧筛选' } })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => expect(reads).toHaveBeenCalledWith('/system/ai-sessions', { q: '更旧筛选' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '旧筛选' } })
    await waitFor(() => expect(reads).toHaveBeenCalledWith('/system/ai-sessions', { q: '旧筛选' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '最新筛选' } })
    await act(async () => { resolveOld({ data: { items: [{ ...session, title: '旧响应会话' }] } }); rejectOlder(new Error('旧响应失败')) })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '查看最新筛选' })).toBeInTheDocument()
    expect(screen.queryByText('旧响应会话')).not.toBeInTheDocument()
  })

  test('后返回的旧请求不能覆盖已成功的新范围', async () => {
    let finish
    const gate = new Promise((resolve) => { finish = resolve })
    vi.spyOn(apiClient, 'get').mockImplementation((_path, params) => params.q ? Promise.resolve({ data: { items: [{ ...session, title: '新范围会话' }] } }) : gate)
    render(<AiSessionAuditPanel />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '新范围' } })
    await screen.findByRole('button', { name: '查看新范围会话' })
    await act(async () => { finish({ data: { items: [session] } }) })
    expect(screen.getByRole('button', { name: '查看新范围会话' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `查看${session.title}` })).not.toBeInTheDocument()
  })

  test('读取失败显式重试并保留服务端筛选，不显示旧成功列表', async () => {
    mockList()
    render(<AiSessionAuditPanel />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByRole('searchbox', { name: '会话搜索' }), { target: { value: '审计' } })
    await screen.findByRole('table')
    server.use(http.get('/api/v1/system/ai-sessions', () => HttpResponse.json({ message: '审计服务暂不可用' }, { status: 503 })))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('审计服务暂不可用')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const queries = []
    server.use(http.get('/api/v1/system/ai-sessions', ({ request }) => { queries.push(Object.fromEntries(new URL(request.url).searchParams)); return ok([]) }))
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('没有符合筛选条件的会话')).toBeInTheDocument()
    expect(queries).toEqual([{ q: '审计' }])
  })
})
