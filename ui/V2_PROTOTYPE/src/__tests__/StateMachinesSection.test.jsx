import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

// 目录 fixture 与后端 StateMachineDescriptor 结构逐字段对齐（截样）
const fixtureCatalog = [
  {
    id: 'project',
    objectLabel: '项目',
    domain: 'business_object',
    sourceRef: 'apps/api/src/modules/project-evaluations/',
    axes: [
      {
        key: 'status',
        label: '项目状态',
        initial: 'draft',
        statuses: [
          { key: 'draft', label: '草稿', description: '初始态' },
          { key: 'reviewing', label: '待评审', description: '已人工确认' },
          { key: 'published', label: '已发布', description: '发布口径', terminal: true },
        ],
        transitions: [
          { from: 'draft', to: 'reviewing', trigger: '确认 AI 实施评估草稿 POST /confirm', guard: '人工确认才流转', implemented: true },
          { from: 'reviewing', to: 'published', trigger: '评审通过发布（待实现）', guard: '暂无写入路径', implemented: false },
        ],
      },
    ],
    invariants: ['非法 projectStatus 仓储层兜底为 draft'],
  },
  {
    id: 'ai_session',
    objectLabel: 'AI 会话',
    domain: 'business_object',
    sourceRef: 'apps/api/src/modules/ai-sessions/',
    axes: [
      {
        key: 'status',
        label: '会话阶段',
        initial: 'temporary_chat',
        statuses: [
          { key: 'temporary_chat', label: '临时对话', description: '默认态' },
          { key: 'archived', label: '已归档', description: '归档', terminal: true },
        ],
        transitions: [
          { from: 'temporary_chat', to: 'archived', trigger: '会话归档（status 直写）', guard: '值域校验', implemented: true },
        ],
      },
    ],
    invariants: ['阶段标签不构成硬性状态机'],
  },
  {
    id: 'version_document',
    objectLabel: '版本文档（评估/需求/资源/开发/总方案）',
    domain: 'version_document',
    sourceRef: 'apps/api/src/types/index.ts + modules/versions/',
    axes: [
      {
        key: 'status',
        label: '文档主状态',
        initial: 'draft',
        statuses: [
          { key: 'draft', label: '草稿', description: '默认主状态' },
          { key: 'archived', label: '已归档', description: '归档态', terminal: true },
        ],
        transitions: [{ from: 'draft', to: 'archived', trigger: 'PATCH /status', guard: 'admin/operator 本人', implemented: true }],
      },
      {
        key: 'checkout',
        label: '编辑锁（检出状态）',
        initial: 'checked_in',
        statuses: [
          { key: 'checked_in', label: '已检入', description: '只读态' },
          { key: 'checked_out', label: '已检出', description: '排他编辑态' },
        ],
        transitions: [
          { from: 'checked_in', to: 'checked_out', trigger: 'checkout POST /checkout', guard: '非历史归档（40902）；并发 CAS 恰一赢家', implemented: true },
          { from: 'checked_out', to: 'checked_in', trigger: 'checkin POST /checkin', guard: '检入人=检出人（40301）', implemented: true },
          { from: 'checked_out', to: 'checked_out', trigger: 'save-draft PATCH /save-draft', guard: '检出人本人；不递增版本号', implemented: true },
          { from: 'checked_out', to: 'checked_in', trigger: 'undo-checkout POST /undo-checkout', guard: '仅检出人；回滚快照', implemented: true },
          { from: 'checked_in', to: 'checked_out', trigger: 'promote POST /promote', guard: 'drafting + 非历史归档', implemented: true },
          { from: 'checked_out', to: 'checked_in', trigger: 'force-unlock PATCH /force-unlock', guard: '仅 system:manage（管理员）', implemented: true },
        ],
      },
      {
        key: 'doc',
        label: '版本文档审核态',
        initial: 'drafting',
        statuses: [
          { key: 'drafting', label: '修订中', description: '活跃态' },
          { key: 'reviewed', label: '已审核', description: '只读闸门' },
        ],
        transitions: [{ from: 'drafting', to: 'reviewed', trigger: '文档审核标记（暂无现行写入端点）', guard: 'reviewed 后检出被拒', implemented: false }],
      },
    ],
    invariants: ['历史归档版本不可检出、不可升版', '检入递增自然数、升版字母+1 且自然数归 1'],
  },
]

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('系统管理 · 状态机规则可视化页', () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })))
    server.use(http.get(`${BASE}/system/state-machines`, () => HttpResponse.json({ code: 0, message: 'ok', data: { items: fixtureCatalog } })))
  })

  test('列表同时展示业务对象与版本文档，源码只在详情可见', async () => {
    renderAppAt('/system/rules/state-machines')
    const table = await screen.findByRole('table', { name: '状态机对象列表' })
    expect(within(table).getByText('项目')).toBeInTheDocument()
    expect(within(table).getByText('版本文档（评估/需求/资源/开发/总方案）')).toBeInTheDocument()
    expect(within(table).queryByText('apps/api/src/modules/project-evaluations/')).not.toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: '查看 项目' }))
    expect(within(screen.getByRole('dialog', { name: '状态机规则详情' })).getByText('apps/api/src/modules/project-evaluations/')).toBeVisible()
  })

  test('详情显示状态流、转换表、未实现标记与约束', async () => {
    renderAppAt('/system/rules/state-machines')
    await screen.findByRole('table', { name: '状态机对象列表' })
    expect(screen.queryByText('人工确认才流转')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看 项目' }))
    const dialog = screen.getByRole('dialog', { name: '状态机规则详情' })
    expect(within(dialog).getByText('人工确认才流转')).toBeVisible()
    expect(within(dialog).getByText('暂无写入路径')).toBeVisible()
    expect(within(dialog).getByText('未实现')).toBeVisible()
    expect(within(dialog).getByText('非法 projectStatus 仓储层兜底为 draft')).toBeVisible()
  })

  test('搜索覆盖守卫，域筛选和重置在同一列表生效', async () => {
    renderAppAt('/system/rules/state-machines')
    const table = await screen.findByRole('table', { name: '状态机对象列表' })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索状态机对象' }), { target: { value: '会话' } })
    expect(within(table).queryByText('项目')).not.toBeInTheDocument()
    expect(within(table).getByText('AI 会话')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索状态机对象' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '筛选状态机对象' }), { target: { value: 'version_document' } })
    expect(within(table).queryByText('项目')).not.toBeInTheDocument()
    expect(within(table).getByText('版本文档（评估/需求/资源/开发/总方案）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索状态机对象' }), { target: { value: '人工确认才流转' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('项目')).toBeInTheDocument()
  })

  test('版本文档详情保留三轴、六动作与全部守卫', async () => {
    renderAppAt('/system/rules/state-machines')
    await screen.findByRole('table', { name: '状态机对象列表' })
    fireEvent.click(screen.getByRole('button', { name: '查看 版本文档（评估/需求/资源/开发/总方案）' }))
    const block = screen.getByRole('dialog', { name: '状态机规则详情' })
    for (const label of ['文档主状态', '编辑锁（检出状态）', '版本文档审核态']) expect(within(block).getByText(label)).toBeVisible()
    for (const action of ['checkout', 'checkin', 'save-draft', 'undo-checkout', 'promote', 'force-unlock']) {
      expect(within(block).getAllByText(new RegExp(action)).length).toBeGreaterThan(0)
    }
    expect(within(block).getByText('历史归档版本不可检出、不可升版')).toBeVisible()
  })

  test('只读页面与详情不出现状态修改入口', async () => {
    renderAppAt('/system/rules/state-machines')
    await screen.findByRole('table', { name: '状态机对象列表' })
    fireEvent.click(screen.getByRole('button', { name: '查看 项目' }))
    for (const label of ['保存', '生效', '新增', '激活', '禁用']) expect(screen.queryByRole('button', { name: new RegExp(label) })).not.toBeInTheDocument()
  })

  test('列表真实统计未实现数量，关闭详情恢复原触发按钮焦点', async () => {
    renderAppAt('/system/rules/state-machines')
    const table = await screen.findByRole('table', { name: '状态机对象列表' })
    const trigger = within(table).getByRole('button', { name: '查看 项目' })
    expect(within(trigger.closest('tr')).getByText('1 项未实现')).toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('无结果可重置关键词与域筛选，恢复全部对象', async () => {
    renderAppAt('/system/rules/state-machines')
    await screen.findByRole('table', { name: '状态机对象列表' })
    fireEvent.change(screen.getByRole('combobox', { name: '筛选状态机对象' }), { target: { value: 'version_document' } })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索状态机对象' }), { target: { value: '不存在的对象' } })
    expect(screen.getByText('没有匹配的状态机对象')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    expect(screen.getByRole('searchbox', { name: '搜索状态机对象' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: '筛选状态机对象' })).toHaveValue('all')
    expect(screen.getByRole('option', { name: '全部域' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  })

  test('分页可到达后续对象，搜索状态说明后回到有效页', async () => {
    const extras = Array.from({ length: 10 }, (_, index) => ({ ...fixtureCatalog[0], id: `extra${index}`, objectLabel: `后续对象${index}` }))
    server.use(http.get(`${BASE}/system/state-machines`, () => HttpResponse.json({ data: { items: [...fixtureCatalog, ...extras] } })))
    renderAppAt('/system/rules/state-machines')
    const table = await screen.findByRole('table', { name: '状态机对象列表' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(within(table).getByRole('button', { name: '查看 后续对象9' }))
    expect(within(screen.getByRole('dialog')).getByText('人工确认才流转')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索状态机对象' }), { target: { value: '排他编辑态' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  test('目录加载失败可重试，不把失败当成空目录', async () => {
    let fail = true
    server.use(http.get(`${BASE}/system/state-machines`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { items: fixtureCatalog } })))
    renderAppAt('/system/rules/state-machines')
    expect(await screen.findByRole('alert')).toHaveTextContent('状态机目录加载失败')
    expect(screen.queryByText('暂无状态机对象')).not.toBeInTheDocument()
    fail = false; fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('table', { name: '状态机对象列表' })).toBeInTheDocument()
  })
  test('目录未声明流转时不将其标为全部落地', async () => {
    const item = { ...fixtureCatalog[0], axes: [{ ...fixtureCatalog[0].axes[0], transitions: [] }] }
    server.use(http.get(`${BASE}/system/state-machines`, () => HttpResponse.json({ data: { items: [item] } })))
    renderAppAt('/system/rules/state-machines')
    const table = await screen.findByRole('table', { name: '状态机对象列表' })
    expect(within(table).getByText('未声明流转')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看 项目' }))
    expect(within(screen.getByRole('dialog')).getByText('目录未声明状态流转')).toBeInTheDocument()
  })

})
