import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

const codeRules = [
  {
    id: 'rule-global',
    moduleName: '总方案',
    moduleCode: 'GL',
    prefix: 'GL',
    format: '{PREFIX}{MM}{NNN}',
    sample: 'GL07001',
    status: 'draft',
    updatedAt: '2026-07-04T00:00:00.000Z',
  },
  {
    id: 'rule-implementation',
    moduleName: '实施评估',
    moduleCode: 'IA',
    prefix: 'IA',
    format: '{PREFIX}{MM}{NN}',
    sample: 'IA0701',
    status: 'active',
    effectiveAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  },
]

function renderCodeRules() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter>
        <SystemManagement sectionId="rules" />
      </MemoryRouter>
    </ToastProvider>
  )
}

describe('SystemManagement code rules actions', () => {
  test('uses rule id for activate and disable actions and shows visible feedback', async () => {
    const called = []
    server.use(
      http.get(`${BASE}/system/version-code-rules`, () => HttpResponse.json({ success: true, data: { items: codeRules } })),
      http.post(`${BASE}/system/version-code-rules/:ruleId/activate`, ({ params }) => {
        called.push(`activate:${params.ruleId}`)
        return HttpResponse.json({ success: true, data: { item: { ...codeRules[0], status: 'active' } } })
      }),
      http.post(`${BASE}/system/version-code-rules/:ruleId/disable`, ({ params }) => {
        called.push(`disable:${params.ruleId}`)
        return HttpResponse.json({ success: true, data: { item: { ...codeRules[0], status: 'disabled' } } })
      })
    )

    renderCodeRules()

    await screen.findByText('总方案')
    const row = screen.getByRole('table', { name: '编码规则列表' }).querySelector('tbody tr')
    fireEvent.click(within(row).getByRole('button', { name: '更多操作 总方案' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '生效' }))
    await waitFor(() => expect(called).toContain('activate:rule-global'))
    expect(await screen.findByRole('status')).toHaveTextContent('编码规则已生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))

    fireEvent.click(within(row).getByRole('button', { name: '更多操作 总方案' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '禁用' }))
    await waitFor(() => expect(called).toContain('disable:rule-global'))
    expect(await screen.findByRole('status')).toHaveTextContent('编码规则已禁用')
  })

  test('opens a configuration dialog and saves prefix and format with rule id', async () => {
    let capturedRuleId = null
    let capturedBody = null
    server.use(
      http.get(`${BASE}/system/version-code-rules`, () => HttpResponse.json({ success: true, data: { items: codeRules } })),
      http.patch(`${BASE}/system/version-code-rules/:ruleId/config`, async ({ params, request }) => {
        capturedRuleId = params.ruleId
        capturedBody = await request.json()
        return HttpResponse.json({ success: true, data: { item: { ...codeRules[0], ...capturedBody, status: 'draft' } } })
      })
    )

    renderCodeRules()

    await screen.findByText('总方案')
    const trigger = screen.getByRole('button', { name: '编辑 总方案' })
    fireEvent.click(trigger)

    let dialog = await screen.findByRole('dialog', { name: '编辑编码规则' })
    expect(dialog).toHaveClass('wes-dialog')
    await waitFor(() => expect(within(dialog).getByLabelText('前缀')).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑编码规则' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    dialog = await screen.findByRole('dialog', { name: '编辑编码规则' })

    fireEvent.change(within(dialog).getByLabelText('前缀'), { target: { value: 'GL-' } })
    fireEvent.change(within(dialog).getByLabelText('格式'), { target: { value: '{PREFIX}{YYYY}{NNN}' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(capturedRuleId).toBe('rule-global'))
    expect(capturedBody).toEqual({ prefix: 'GL-', format: '{PREFIX}{YYYY}{NNN}' })
    expect(await screen.findByRole('status')).toHaveTextContent('编码规则配置已保存')
  })
  test('列表按真实字段显示示例与生效时间，详情可由明确入口打开', async () => {
    server.use(http.get(`${BASE}/system/version-code-rules`, () => HttpResponse.json({ data: { items: codeRules } })))
    renderCodeRules()
    const table = await screen.findByRole('table', { name: '编码规则列表' })
    expect(within(table).getByText('GL07001')).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: '查看 实施评估' }))
    const dialog = screen.getByRole('dialog', { name: '编码规则详情' })
    expect(within(dialog).getByText('IA0701')).toBeInTheDocument()
    expect(within(dialog).getByText(/2026/)).toBeInTheDocument()
  })

  test('编辑未提交时关闭需要确认，放弃后不发送写请求', async () => {
    let writes = 0
    server.use(
      http.get(`${BASE}/system/version-code-rules`, () => HttpResponse.json({ data: { items: codeRules } })),
      http.patch(`${BASE}/system/version-code-rules/:id/config`, () => { writes += 1; return HttpResponse.json({ data: {} }) }),
    )
    renderCodeRules()
    fireEvent.click(await screen.findByRole('button', { name: '编辑 总方案' }))
    const dialog = screen.getByRole('dialog', { name: '编辑编码规则' })
    fireEvent.change(within(dialog).getByLabelText('前缀'), { target: { value: 'NEW' } })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('放弃')
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(writes).toBe(0)
  })

  test('加载失败可重试，不展示默认回退卡片', async () => {
    let fail = true
    server.use(http.get(`${BASE}/system/version-code-rules`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { items: codeRules } })))
    renderCodeRules()
    expect(await screen.findByRole('alert')).toHaveTextContent('编码规则加载失败')
    expect(screen.queryByRole('table', { name: '编码规则列表' })).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('table', { name: '编码规则列表' })).toBeInTheDocument()
  })

  test('草稿仍允许禁用，保存后的状态和示例以服务器返回为准', async () => {
    let disabledId
    server.use(
      http.get(`${BASE}/system/version-code-rules`, () => HttpResponse.json({ data: { items: codeRules } })),
      http.post(`${BASE}/system/version-code-rules/:id/disable`, ({ params }) => { disabledId = params.id; return HttpResponse.json({ data: { item: { ...codeRules[0], status: 'disabled' } } }) }),
      http.patch(`${BASE}/system/version-code-rules/:id/config`, () => HttpResponse.json({ data: { item: { ...codeRules[0], prefix: 'SV', sample: 'SV10001', status: 'active', effectiveAt: '2026-10-21T00:00:00Z' } } })),
    )
    renderCodeRules()
    fireEvent.click(await screen.findByRole('button', { name: '更多操作 总方案' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '禁用' })).toBeEnabled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '禁用' }))
    await waitFor(() => expect(disabledId).toBe('rule-global'))
    fireEvent.click(screen.getByRole('button', { name: '编辑 总方案' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('前缀'), { target: { value: 'SV' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存配置' }))
    const sample = await screen.findByText('SV10001')
    expect(within(sample.closest('tr')).getByText('生效中')).toBeInTheDocument()
  })

})
