import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockAiTools, mockAiToolsWithPolicy, mockUsers } from './mocks/data.js'
import { __resetToolPolicyStoreForTest } from './mocks/handlers.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function mockToolsResponse(items, summary) {
  server.use(
    http.get(`${BASE}/system/ai-tools`, () =>
      HttpResponse.json({
        success: true,
        data: { items, summary: summary || { injectedCount: 0, injectedTokens: 0 } },
      })),
  )
}

/** 取某工具所在行（按工具名单元格定位） */
function toolRow(name) {
  const cell = screen.getByText(name, { selector: 'td span.mono' })
  return cell.closest('tr')
}

describe('System management AI tool policy (批次 6a 清单 + 6b 策略)', () => {
  beforeEach(() => {
    __resetToolPolicyStoreForTest()
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('admin sees the code-registered tools with write flags', async () => {
    renderAppAt('/system/tools')

    expect(await screen.findByRole('heading', { name: '工具策略' }, { timeout: 3000 })).toBeInTheDocument()
    expect(await screen.findByText('estimate_implementation', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('create_project')).toBeInTheDocument()
    expect(screen.getByText('list_tools')).toBeInTheDocument()

    // 写数据标记：3 个写工具带「会写数据」徽章；其余为只读。外发维度独立显示（当前 0 个）
    expect(screen.getAllByText('会写数据')).toHaveLength(3)
    expect(screen.getAllByText('只读')).toHaveLength(6)
    expect(screen.queryAllByText('会外发')).toHaveLength(0)
    expect(screen.getAllByText('不外发')).toHaveLength(9)
    expect(screen.getByText(/共 9 个工具/)).toBeInTheDocument()
    expect(screen.getByText(/其中 3 个会写数据/)).toBeInTheDocument()
    expect(screen.getByText(/0 个会外发数据/)).toBeInTheDocument()

    // admin 持有全部能力位：9 条「可调用」，没有一条被标记为不可调用
    expect(screen.getAllByText('可调用')).toHaveLength(9)
    expect(screen.queryByText('不可调用')).not.toBeInTheDocument()
    expect(screen.getByText(/你本人可调用 9 个/)).toBeInTheDocument()

    // 权限位与分类可见
    expect(screen.getAllByText('estimates:write').length).toBeGreaterThan(0)
    expect(screen.getByText('discovery')).toBeInTheDocument()

    // 侧边栏入口（6b 起更名「工具策略」，路由不变）
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).getByRole('link', { name: /工具策略/ })).toHaveAttribute('href', '/system/tools')
  })

  test('tools the viewer cannot call stay listed with a quiet marker', async () => {
    // 系统管理员未必持有 estimates:* ——清单不得因此少报一个工具
    mockToolsResponse(mockAiToolsWithPolicy.map((tool) => ({ ...tool, callable: tool.capability === 'estimates:read' })))
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

  test('判据④：token 列与合计显示后端计量值（前端不自算）', async () => {
    renderAppAt('/system/tools')
    expect(await screen.findByText('estimate_implementation', {}, { timeout: 3000 })).toBeInTheDocument()

    // 夹具首个工具 tokens=40
    expect(within(toolRow('estimate_implementation')).getByText('40')).toBeInTheDocument()
    const expectedTotal = mockAiToolsWithPolicy.filter((tool) => tool.injected).reduce((sum, tool) => sum + tool.tokens, 0)
    expect(screen.getByText(new RegExp(`当前注入 \\d+ 个 / ${expectedTotal} tokens`))).toBeInTheDocument()
  })

  test('批次6b·判据①：取消勾选「启用」→ 草稿未生效 → 保存草稿 → 生效 → version 递增且记轨迹', async () => {
    renderAppAt('/system/tools')
    expect(await screen.findByText('estimate_implementation', {}, { timeout: 3000 })).toBeInTheDocument()

    expect(screen.getByText('草稿与生效一致')).toBeInTheDocument()
    const enabledCheckbox = within(toolRow('project_list')).getByLabelText('启用 project_list')
    fireEvent.click(enabledCheckbox)
    expect(screen.getByText('草稿未生效')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }))
    // 保存只落草稿：未生效前脏标记仍在，version 不动
    await waitFor(() => expect(screen.getByText(/生效版本 v1/)).toBeInTheDocument())
    expect(screen.getByText('草稿未生效')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^生效$/ }))
    await waitFor(() => expect(screen.getByText(/生效版本 v2/)).toBeInTheDocument())
    // 变更轨迹：草稿 + 生效两条，操作者与时点可见（限定在轨迹表内，避开侧边栏同名节点）
    const trajectoryHeading = screen.getByText(/变更轨迹/)
    const trajectoryTable = trajectoryHeading.parentElement.querySelector('table')
    expect(within(trajectoryTable).getAllByText('admin').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/project_list · enabled: true → false/).length).toBeGreaterThan(0)
  })

  test('批次6b·判据③口径：写/外发工具的审批显示为代码下限，策略下拉不可选', async () => {
    mockToolsResponse(mockAiToolsWithPolicy.map((tool) => (
      tool.name === 'knowledge_query' ? { ...tool, exfiltrates: true } : tool
    )))
    renderAppAt('/system/tools')
    expect(await screen.findByText('knowledge_query', {}, { timeout: 3000 })).toBeInTheDocument()

    // 外发徽章出现（合成：一个不改本地库但会外发的工具）
    expect(within(toolRow('knowledge_query')).getByText('会外发')).toBeInTheDocument()
    // 行内两个下拉：第一个是审批策略、第二个是注入模式
    // 写工具 create_project：审批锁定「必须审批（代码下限）」且禁用——策略没有免审批方向
    const writeApprovalSelect = within(toolRow('create_project')).getAllByRole('combobox')[0]
    expect(writeApprovalSelect).toBeDisabled()
    expect(within(writeApprovalSelect).getByRole('option', { selected: true }).textContent).toContain('必须审批')
    // 外发工具同理锁定
    const exfilApprovalSelect = within(toolRow('knowledge_query')).getAllByRole('combobox')[0]
    expect(exfilApprovalSelect).toBeDisabled()
    expect(within(exfilApprovalSelect).getByRole('option', { selected: true }).textContent).toContain('必须审批')
    // 只读工具 rule_lookup：策略可收紧为逐次确认
    const readOnlyApproval = within(toolRow('rule_lookup')).getAllByRole('combobox')[0]
    expect(readOnlyApproval).toBeEnabled()
    fireEvent.change(readOnlyApproval, { target: { value: 'user-confirm' } })
    expect(screen.getByText('草稿未生效')).toBeInTheDocument()
  })

  test('批次6b：策略停用只裁注入，不收本人权限（callable 仍按权限位）', async () => {
    renderAppAt('/system/tools')
    expect(await screen.findByText('rule_lookup', {}, { timeout: 3000 })).toBeInTheDocument()
    fireEvent.click(within(toolRow('rule_lookup')).getByLabelText('启用 rule_lookup'))
    const approval = within(toolRow('rule_lookup')).getByText('注入')
    expect(approval).toBeInTheDocument() // 未生效前，生效视图不变
    await waitFor(() => screen.getByText('草稿未生效'))
  })

  test('page states the code/data boundary: inventory read-only, policy is the editable decision', async () => {
    renderAppAt('/system/tools')
    expect(
      await screen.findByText(
        /工具本身（名称、参数、实现）来自代码，清单只读不可编辑；本页编辑的是\*\*策略决定\*\*/,
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
    // 「将在后续版本提供」的 6a 占位话术必须退役
    expect(screen.queryByText(/将在后续版本提供/)).not.toBeInTheDocument()
  })

  test('empty registry renders the empty state without blanking the page', async () => {
    mockToolsResponse([], { injectedCount: 0, injectedTokens: 0 })
    renderAppAt('/system/tools')

    expect(await screen.findByText('暂无已注册的工具', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工具策略' })).toBeInTheDocument()
    expect(screen.getByText(/共 0 个工具/)).toBeInTheDocument()
    // 6a 回归钉：夹具仍保留原始 9 工具形状
    expect(mockAiTools).toHaveLength(9)
  })

  test('failed request renders the error state without blanking the page', async () => {
    server.use(
      http.get(`${BASE}/system/ai-tools`, () => new HttpResponse(null, { status: 500 })),
    )
    renderAppAt('/system/tools')

    expect(await screen.findByText(/工具策略加载失败/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工具策略' })).toBeInTheDocument()
    expect(screen.queryByText('estimate_implementation')).not.toBeInTheDocument()
  })

  test('non-admin user is redirected away from the tool policy page', async () => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[2] } })),
    )
    renderAppAt('/system/tools')

    expect(await screen.findByRole('heading', { name: 'AI 工作台' }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '工具策略' })).not.toBeInTheDocument()
  })
})
