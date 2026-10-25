import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { StrictMode } from 'react'
import useSystemManagement from '../hooks/useSystemManagement.js'
import { mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const URL = '/api/v1/system/implementation-dependency-rules'
const rule = { id: 'dep-combo', subject: '组合测试', scope: 'feature', trigger: '业务场景', logic: 'combo', dependencies: ['基础模块'], anyOfGroups: [['模块甲', '模块乙'], ['模块丙']], comboDependencies: ['组合条件'], note: '完整备注', enabled: true }
let draft, active, writes, failGet, failSave, version
const renderPage = () => render(<MemoryRouter initialEntries={['/system/rules/dsl-rules']}><App /></MemoryRouter>)
const edit = () => { fireEvent.click(screen.getByRole('button', { name: '编辑启用 组合测试' })); return screen.getByRole('dialog', { name: '编辑规则启用状态' }) }

beforeEach(() => {
  draft = [rule]; active = [rule]; writes = []; failGet = false; failSave = false; version = 3
  server.use(
    http.get('/api/v1/auth/me', () => HttpResponse.json({ data: { user: mockUsers[0] } })),
    http.get(URL, () => failGet ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { version, draft: { rules: draft }, active: { rules: active } } })),
    http.patch(`${URL}/draft`, async ({ request }) => {
      const body = await request.json(); writes.push(body)
      if (failSave) return new HttpResponse(null, { status: 500 })
      draft = body.rules; return HttpResponse.json({ data: { version, draft: { rules: draft } } })
    }),
    http.post(`${URL}/activate`, () => { writes.push('activate'); active = draft; version += 1; return HttpResponse.json({ data: { version, active: { rules: active } } }) }),
  )
})

describe('DSL 规则统一列表', () => {
  test('完整条件留在详情，列表可搜索备注和分页到最后记录', async () => {
    draft = [...draft, ...Array.from({ length: 11 }, (_, i) => ({ ...rule, id: `r${i}`, subject: `规则${i}` }))]; active = draft
    renderPage()
    const table = await screen.findByRole('table', { name: 'DSL 规则列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    fireEvent.click(screen.getByRole('button', { name: '查看 组合测试' }))
    const dialog = screen.getByRole('dialog', { name: 'DSL 规则详情' })
    for (const value of ['模块甲、模块乙', '模块丙', '组合条件', '完整备注']) expect(within(dialog).getByText(value)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(within(table).getByText('规则10')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索DSL 规则' }), { target: { value: '完整备注' } })
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  test('弹窗取消不改草稿，应用后先保存再生效且不丢组合字段', async () => {
    renderPage(); await screen.findByRole('table', { name: 'DSL 规则列表' })
    let dialog = edit()
    fireEvent.click(within(dialog).getByLabelText('启用规则'))
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }))
    expect(screen.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
    expect(writes).toHaveLength(0)
    dialog = edit(); fireEvent.click(within(dialog).getByLabelText('启用规则'))
    fireEvent.click(within(dialog).getByRole('button', { name: '应用修改' }))
    expect(screen.getByRole('button', { name: '生效', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新', exact: true })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿', exact: true }))
    await screen.findByText('草稿未生效')
    expect(writes[0].rules[0]).toMatchObject({ ...rule, enabled: false })
    fireEvent.click(screen.getByRole('button', { name: '生效', exact: true }))
    await screen.findByText('生效版本 v4')
    expect(writes[1]).toBe('activate')
    expect(screen.getByText('草稿与生效一致')).toBeInTheDocument()
  })

  test('新增校验必填，添加只进入本地草稿', async () => {
    renderPage(); await screen.findByRole('table', { name: 'DSL 规则列表' })
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }))
    const dialog = screen.getByRole('dialog', { name: '新增实施依赖规则' })
    fireEvent.click(within(dialog).getByRole('button', { name: '添加规则' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('规则主题与触发场景必填')
    fireEvent.change(within(dialog).getByLabelText('规则主题'), { target: { value: '新增主题' } })
    fireEvent.change(within(dialog).getByLabelText('触发场景'), { target: { value: '新增场景' } })
    fireEvent.change(within(dialog).getByLabelText('依赖模块'), { target: { value: '甲，乙' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '添加规则' }))
    expect(screen.getByText('新增主题')).toBeInTheDocument()
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument()
    expect(writes).toHaveLength(0)
  })

  test('加载失败可重试，保存失败不丢本地编辑', async () => {
    failGet = true; renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('DSL 规则加载失败')
    expect(screen.queryByRole('table', { name: 'DSL 规则列表' })).not.toBeInTheDocument()
    failGet = false; fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('table', { name: 'DSL 规则列表' })
    const dialog = edit(); fireEvent.click(within(dialog).getByLabelText('启用规则')); fireEvent.click(within(dialog).getByRole('button', { name: '应用修改' }))
    failSave = true; fireEvent.click(screen.getByRole('button', { name: '保存草稿', exact: true }))
    await waitFor(() => expect(screen.getByText(/草稿保存失败/)).toBeInTheDocument())
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'DSL 规则列表' })).getByText('已停用')).toBeInTheDocument()
  })
  test('条目相同而互斥条件不同仍显示待生效，不覆盖未编辑的配置', async () => {
    const config = { rules: [rule], mutualExclusionRules: [{ left: '甲', right: '乙', reason: '不可并用' }] }
    server.use(
      http.get(URL, () => HttpResponse.json({ data: { version: 3, draft: config, active: { rules: [rule], mutualExclusionRules: [] } } })),
      http.post(`${URL}/activate`, () => { writes.push('activate'); return HttpResponse.json({ data: { version: 4, active: config } }) }),
    )
    renderPage(); await screen.findByRole('table', { name: 'DSL 规则列表' })
    expect(screen.getByText('草稿未生效')).toBeInTheDocument()
    expect(screen.queryByText('草稿与生效一致')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生效', exact: true }))
    await screen.findByText('生效版本 v4')
    expect(screen.getByText('草稿与生效一致')).toBeInTheDocument()
    expect(writes).toEqual(['activate'])
  })

  test('StrictMode 后到的旧请求不覆盖最新加载后的本地编辑', async () => {
    const releases = []
    server.use(http.get(URL, () => new Promise((resolve) => { releases.push(() => resolve(HttpResponse.json({ data: { rules: [rule] } }))) })))
    const { result } = renderHook(() => useSystemManagement({ enabled: true }), { wrapper: StrictMode })
    await waitFor(() => expect(releases).toHaveLength(2))
    await act(async () => { releases[1]() })
    await waitFor(() => expect(result.current.dslLoading).toBe(false))
    act(() => result.current.actions.toggleDsl(rule.id))
    expect(result.current.dslUnsaved).toBe(true)
    await act(async () => { releases[0]() })
    expect(result.current.dslRules[0].enabled).toBe(false)
    expect(result.current.dslUnsaved).toBe(true)
  })

})
