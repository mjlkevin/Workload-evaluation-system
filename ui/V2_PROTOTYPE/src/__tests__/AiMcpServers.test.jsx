import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockUsers } from './mocks/data.js'
import { __resetMcpStoreForTest, __resetToolPolicyStoreForTest, __getMcpStoreForTest, __mcpProbeCallsForTest } from './mocks/handlers.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function mockInventoryWithMcpTool() {
  server.use(
    http.get(`${BASE}/system/ai-tools`, () =>
      HttpResponse.json({
        success: true,
        data: {
          items: [
            {
              name: 'estimate_implementation', description: 'd', capability: 'estimates:create',
              mutates: false, exfiltrates: false, category: 'presales', discoverable: false,
              callable: true, tokens: 40, injected: true, activePolicy: { enabled: true, visibleRoles: [], approvalStrategy: 'default', injectionMode: 'default' },
              origin: 'code', mcpServer: null, mcpApproval: null, mcpDigest: null,
            },
            {
              name: 'mcp__im_hub__send_summary', description: '把会话总结发送到 IM', capability: 'mcp:invoke',
              mutates: true, exfiltrates: true, category: 'mcp', discoverable: false,
              callable: true, tokens: 60, injected: true, activePolicy: { enabled: true, visibleRoles: [], approvalStrategy: 'default', injectionMode: 'default' },
              origin: 'mcp', mcpServer: { id: 'im_hub', name: 'IM Hub' }, mcpApproval: 'approved', mcpDigest: 'a'.repeat(32),
            },
          ],
          summary: { injectedCount: 2, injectedTokens: 100 },
        },
      })),
  )
}

describe('System management MCP servers (批次 7 第六配置区)', () => {
  beforeEach(() => {
    __resetToolPolicyStoreForTest()
    __resetMcpStoreForTest()
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })),
    )
  })

  test('工具清单同页呈现 MCP 工具并按 origin 可辨（默认已放行态 + 恒外发）', async () => {
    mockInventoryWithMcpTool()
    renderAppAt('/system/tools')
    expect(await screen.findByText('mcp__im_hub__send_summary', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('MCP · IM Hub')).toBeInTheDocument()
    // 外发徽章：MCP 工具恒「会外发」（按构造），代码工具「不外发」
    expect(screen.getByText('会外发')).toBeInTheDocument()
    expect(screen.getByText('不外发')).toBeInTheDocument()
  })

  test('登记服务 → 保存草稿 → 生效：三态徽章推进，active 后显示「已生效」', async () => {
    renderAppAt('/system/tools')
    expect(await screen.findByText('MCP 第三方服务（第六配置区）', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('未登记任何 MCP 服务（默认状态：什么都不连）')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '＋ 登记 MCP 服务' }))
    const dialog = await screen.findByRole('dialog', { name: '登记 MCP 服务' })
    fireEvent.change(within(dialog).getByPlaceholderText('im_hub'), { target: { value: 'im_hub' } })
    fireEvent.change(within(dialog).getByPlaceholderText('https://host/mcp'), { target: { value: 'https://im.example.internal/mcp' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /确定/ }))

    expect(screen.getByText('MCP：有未保存的修改')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存 MCP 草稿' }))
    await waitFor(() => expect(screen.getByText('MCP：草稿已保存')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('MCP：草稿未生效')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '生效 MCP 配置' }))
    await waitFor(() => {
      const row = screen.getByText('im_hub', { selector: 'td span.mono' }).closest('tr')
      expect(within(row).getByText('已生效')).toBeInTheDocument()
    })
    expect(screen.getByText('MCP：草稿与生效一致')).toBeInTheDocument()
    expect(__getMcpStoreForTest().version).toBe(2)
  })

  test('「拉取工具」每次真探测（无缓存）：点两次，probe 请求数 +2；放行条目由服务端盖章后回读', async () => {
    __resetMcpStoreForTest({
      draft: { schemaVersion: 1, servers: [{ id: 'im_hub', name: 'IM Hub', transport: 'http', url: 'https://im/mcp', authType: 'none', command: '', args: [], env: {}, credentialScope: '', timeoutMs: 8000, approvedTools: {} }] },
    })
    renderAppAt('/system/tools')
    expect(await screen.findByText('im_hub', { selector: 'td span.mono' }, { timeout: 3000 })).toBeInTheDocument()

    const before = __mcpProbeCallsForTest.count
    fireEvent.click(screen.getByRole('button', { name: '拉取工具' }))
    expect(await screen.findByText('mcp__im_hub__send_summary', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(__mcpProbeCallsForTest.count).toBe(before + 1)

    fireEvent.click(screen.getByRole('button', { name: '拉取工具' }))
    await waitFor(() => expect(__mcpProbeCallsForTest.count).toBe(before + 2))

    // 放行（进草稿）→ 保存草稿 → mock 服务端盖章 approvedBy=admin（不回显任何密钥）
    fireEvent.click(screen.getByRole('button', { name: '放行（进草稿）' }))
    fireEvent.click(screen.getByRole('button', { name: '保存 MCP 草稿' }))
    await waitFor(() => expect(__getMcpStoreForTest().draft.servers[0].approvedTools.send_summary?.approvedBy).toBe('admin'))
  })
})
