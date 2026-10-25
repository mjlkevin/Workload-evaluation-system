import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import MemoryManagementPanel from '../components/system/MemoryManagementPanel.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { server } from './mocks/server.js'

const atom = { memoryAtomId: 'atom-1', factKey: 'project.name', factText: '项目正式名称为蓝海集团。', confidence: 91, status: 'draft', projectId: 'project-1', ownerUserId: 'owner-1', sourceType: 'distill', harnessRunId: 'run-1', metadata: { evidence: '原始会话' }, createdAt: '2026-10-20T00:00:00Z' }
const scene = { memorySceneId: 'scene-1', sceneTitle: '项目名称变更', sceneSummary: '将项目名称正式变更为蓝海集团项目。', atomIds: ['atom-1', 'atom-not-loaded'], status: 'active' }
const ok = (data) => HttpResponse.json({ code: 'OK', data })
function mockList(data = { atoms: [atom], scenes: [scene], totalAtoms: 1, totalScenes: 1 }) {
  server.use(http.get('/api/v1/memory', () => ok(data)))
}
function renderPanel(path = '/system/memory') {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><MemoryManagementPanel /></ToastProvider></MemoryRouter>)
}
async function openDetail(name) {
  fireEvent.click(screen.getByRole('button', { name: `查看${name}` }))
  return screen.findByRole('dialog')
}

describe('记忆管理统一列表与详情', () => {
  test('场景和原子同表显示，类型可辨，完整详情和取消不触发写入', async () => {
    mockList()
    const writes = []
    server.use(http.post('/api/v1/memory/:kind/:action', ({ request }) => { writes.push(request.url); return ok({}) }))
    renderPanel()
    const table = await screen.findByRole('table', { name: '已加载记忆列表' })
    expect(within(table).getByText('原子事实')).toBeInTheDocument()
    expect(within(table).getByText('场景块')).toBeInTheDocument()
    expect(within(table).getByText(atom.factKey)).toBeInTheDocument()
    expect(within(table).getByText(scene.sceneTitle)).toBeInTheDocument()
    const detail = await openDetail(atom.factKey)
    for (const value of [atom.factText, '91%', 'project-1', 'owner-1', 'distill', 'run-1', atom.createdAt]) expect(within(detail).getByText(value)).toBeInTheDocument()
    expect(within(detail).getByText(/原始会话/)).toBeInTheDocument()
    fireEvent.click(within(detail).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(writes).toEqual([])
    const sceneDetail = await openDetail(scene.sceneTitle)
    expect(within(sceneDetail).getByText('atom-not-loaded')).toBeInTheDocument()
    expect(within(sceneDetail).getByText(atom.factKey)).toBeInTheDocument()
  })

  test('搜索和类型筛选只作用于已加载范围，10行分页保留全部入口', async () => {
    mockList({ atoms: Array.from({ length: 11 }, (_, i) => ({ ...atom, memoryAtomId: `a-${i}`, factKey: `事实${i}` })), scenes: [scene], totalAtoms: 11, totalScenes: 1 })
    renderPanel()
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('button', { name: '查看事实10' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索已加载记忆' }), { target: { value: '名称变更' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    fireEvent.change(screen.getByRole('combobox', { name: '筛选已加载记忆' }), { target: { value: 'scene' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).queryByText('事实0')).not.toBeInTheDocument()
  })

  test('按独立服务端总数加载更多，不能把前50条宣称全量', async () => {
    const queries = []
    server.use(http.get('/api/v1/memory', ({ request }) => {
      const params = Object.fromEntries(new URL(request.url).searchParams)
      queries.push(params)
      return ok({ atoms: params.page === '1' ? Array.from({ length: 50 }, (_, i) => ({ ...atom, memoryAtomId: `a-${i}`, factKey: `已加载${i}` })) : [{ ...atom, memoryAtomId: 'last', factKey: '最后一条事实' }], scenes: params.page === '1' ? [scene] : [], totalAtoms: 51, totalScenes: 1 })
    }))
    renderPanel('/system/memory?status=draft&projectId=project-1')
    expect(await screen.findByText('已加载 51 / 52 条记忆')).toBeInTheDocument()
    expect(screen.getByText(/搜索和类型筛选仅覆盖已加载记忆/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '加载更多记忆' }))
    expect(await screen.findByText('已加载 52 / 52 条记忆')).toBeInTheDocument()
    expect(queries[1]).toMatchObject({ page: '2', pageSize: '50', status: 'draft', projectId: 'project-1' })
    expect(screen.queryByRole('button', { name: '加载更多记忆' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '最后一条事实' } })
    expect(screen.getByRole('button', { name: '查看最后一条事实' })).toBeInTheDocument()
  })

  test.each([['atom', atom.factKey, '/atoms/confirm', 'atom-1', '确认生效'], ['scene', scene.sceneTitle, '/scenes/archive', 'scene-1', '归档'], ['atom', atom.factKey, '/atoms/archive', 'atom-1', '归档'], ['scene', scene.sceneTitle, '/scenes/confirm', 'scene-1', '确认生效']])('%s 操作固定详情目标且忙时禁止重复与关闭', async (_kind, title, endpoint, id, action) => {
    mockList({ atoms: [atom], scenes: [{ ...scene, status: 'draft' }], totalAtoms: 1, totalScenes: 1 })
    let finish
    const gate = new Promise((resolve) => { finish = resolve })
    const bodies = []
    server.use(http.post(`/api/v1/memory${endpoint}`, async ({ request }) => { bodies.push(await request.json()); await gate; return ok({}) }))
    renderPanel()
    await screen.findByRole('table')
    const dialog = await openDetail(title)
    const button = within(dialog).getByRole('button', { name: `${action}：${title}` })
    fireEvent.click(button)
    await waitFor(() => expect(bodies).toHaveLength(1))
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(bodies).toEqual([{ memoryIds: [id] }])
    finish()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('操作失败保留目标和错误，可重试且不误报成功', async () => {
    mockList()
    let calls = 0
    server.use(http.post('/api/v1/memory/atoms/confirm', () => { calls++; return calls === 1 ? HttpResponse.json({ message: '确认服务暂不可用' }, { status: 503 }) : ok({}) }))
    renderPanel()
    await screen.findByRole('table')
    const dialog = await openDetail(atom.factKey)
    fireEvent.click(within(dialog).getByRole('button', { name: `确认生效：${atom.factKey}` }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('确认服务暂不可用')
    expect(within(dialog).getByText(atom.factText)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: `确认生效：${atom.factKey}` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toBe(2)
  })

  test('读取失败清除旧成功列表并提供重试', async () => {
    mockList()
    renderPanel()
    await screen.findByRole('table')
    server.use(http.get('/api/v1/memory', () => HttpResponse.json({ message: '记忆读取失败' }, { status: 503 })))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('记忆读取失败')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('已加载 2 / 2 条记忆')).not.toBeInTheDocument()
    mockList()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })


  test('同页切换项目与状态后忽略旧请求结果，保留新 query 范围', async () => {
    let finishOld
    const oldGate = new Promise((resolve) => { finishOld = resolve })
    let resolveOldResponse
    const oldResponse = new Promise((resolve) => { resolveOldResponse = resolve })
    const readMemory = apiClient.get.bind(apiClient)
    const readSpy = vi.spyOn(apiClient, 'get').mockImplementation(async (path, params, options) => {
      const response = await readMemory(path, params, options)
      if (params?.projectId === 'old-project') resolveOldResponse(response)
      return response
    })
    const queries = []
    server.use(http.get('/api/v1/memory', async ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams)
      queries.push(query)
      if (query.projectId === 'old-project') {
        await oldGate
        return ok({ atoms: [atom], scenes: [], totalAtoms: 1, totalScenes: 0 })
      }
      return ok({ atoms: [], scenes: [{ ...scene, sceneTitle: '新项目记忆' }], totalAtoms: 0, totalScenes: 1 })
    }))
    render(<MemoryRouter initialEntries={['/system/memory?projectId=old-project&status=draft']}><ToastProvider><Link to="/system/memory?projectId=new-project&status=active">切换项目</Link><MemoryManagementPanel /></ToastProvider></MemoryRouter>)
    await waitFor(() => expect(queries).toHaveLength(1))
    fireEvent.click(screen.getByRole('link', { name: '切换项目' }))
    expect(await screen.findByRole('button', { name: '查看新项目记忆' })).toBeInTheDocument()
    try {
      // Observe the real HTTP client's completed JSON read, then let React flush
      // the stale continuation before checking which project's rows survived.
      await act(async () => {
        finishOld()
        expect((await oldResponse).data.atoms[0].memoryAtomId).toBe(atom.memoryAtomId)
      })
      expect(queries).toHaveLength(2)
      expect(queries[1]).toMatchObject({ projectId: 'new-project', status: 'active', page: '1' })
      expect(screen.getByRole('combobox', { name: '记忆状态' })).toHaveValue('active')
      expect(screen.getByRole('button', { name: '查看新项目记忆' })).toBeInTheDocument()
      expect(screen.queryByText(atom.factKey)).not.toBeInTheDocument()
    } finally {
      readSpy.mockRestore()
    }
  })

  test('跨服务页重复的原子和场景按各自 ID 去重，并保留后页的新内容', async () => {
    const firstAtoms = Array.from({ length: 50 }, (_, i) => ({ ...atom, memoryAtomId: `dedup-atom-${i}`, factKey: `原子${i}` }))
    const firstScenes = Array.from({ length: 50 }, (_, i) => ({ ...scene, memorySceneId: `dedup-scene-${i}`, sceneTitle: `场景${i}` }))
    server.use(http.get('/api/v1/memory', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      return ok({
        atoms: page === '1' ? firstAtoms : [{ ...firstAtoms[0], factKey: '后页更新的原子', factText: '重复原子的最新完整内容' }, { ...atom, memoryAtomId: 'dedup-last-atom', factKey: '末页新增原子' }],
        scenes: page === '1' ? firstScenes : [{ ...firstScenes[0], sceneTitle: '后页更新的场景', sceneSummary: '重复场景的最新完整内容' }, { ...scene, memorySceneId: 'dedup-last-scene', sceneTitle: '末页新增场景' }],
        totalAtoms: 51,
        totalScenes: 51,
      })
    }))
    renderPanel()
    expect(await screen.findByText('已加载 100 / 102 条记忆')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '加载更多记忆' }))
    expect(await screen.findByText('已加载 102 / 102 条记忆')).toBeInTheDocument()
    expect(screen.getByText(/51 条原子事实 · 51 个场景块/)).toBeInTheDocument()
    for (const [query, title, content] of [['后页更新的原子', '后页更新的原子', '重复原子的最新完整内容'], ['后页更新的场景', '后页更新的场景', '重复场景的最新完整内容'], ['末页新增', '末页新增原子', atom.factText]]) {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
      expect(screen.getAllByRole('button', { name: `查看${title}` })).toHaveLength(1)
      const dialog = await openDetail(title)
      expect(within(dialog).getByText(content)).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    }
    expect(screen.getByRole('button', { name: '查看末页新增场景' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '原子0' } })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '场景0' } })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('缺失 total 时只报告已加载数量，并通过整页结果提供继续加载入口', async () => {
    mockList({ atoms: Array.from({ length: 50 }, (_, i) => ({ ...atom, memoryAtomId: `unknown-${i}`, factKey: `未知总数${i}` })), scenes: [] })
    renderPanel()
    expect(await screen.findByText('已加载 50 条记忆（总数暂不可用）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加载更多记忆' })).toBeInTheDocument()
  })

  test('加载更多失败后停止展示过期范围，重试从第一页重新读取', async () => {
    const queries = []
    let retry = false
    server.use(http.get('/api/v1/memory', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      queries.push(page)
      if (page === '2') return HttpResponse.json({ message: '后续页读取失败' }, { status: 503 })
      return ok({ atoms: [{ ...atom, factKey: retry ? '重试后的记忆' : atom.factKey }], scenes: [], totalAtoms: retry ? 1 : 51, totalScenes: 0 })
    }))
    renderPanel()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: '加载更多记忆' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('后续页读取失败')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    retry = true
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('button', { name: '查看重试后的记忆' })).toBeInTheDocument()
    expect(queries).toEqual(['1', '2', '1'])
  })

  test('已归档记忆详情只读，关闭后焦点回到查看入口', async () => {
    mockList({ atoms: [{ ...atom, status: 'archived' }], scenes: [], totalAtoms: 1, totalScenes: 0 })
    renderPanel()
    await screen.findByRole('table')
    const trigger = screen.getByRole('button', { name: `查看${atom.factKey}` })
    trigger.focus()
    const dialog = await openDetail(atom.factKey)
    expect(within(dialog).queryByRole('button', { name: /确认生效：/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /归档：/ })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  test('加载状态明确，首次成功空结果前不显示空态', async () => {
    let finish
    const gate = new Promise((resolve) => { finish = resolve })
    server.use(http.get('/api/v1/memory', async () => { await gate; return ok({ atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 }) }))
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载已加载记忆')
    expect(screen.queryByText('暂无记忆数据')).not.toBeInTheDocument()
    finish()
    expect(await screen.findByText('暂无记忆数据')).toBeInTheDocument()
  })
})
