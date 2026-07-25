import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
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
    <MemoryRouter>
      <SystemManagement sectionId="rules" />
    </MemoryRouter>
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
    fireEvent.click(screen.getByRole('button', { name: /生效/ }))
    await waitFor(() => expect(called).toContain('activate:rule-global'))
    expect(window.alert).toHaveBeenLastCalledWith('编码规则已生效')

    fireEvent.click(screen.getByRole('button', { name: '禁用' }))
    await waitFor(() => expect(called).toContain('disable:rule-global'))
    expect(window.alert).toHaveBeenLastCalledWith('编码规则已禁用')
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
    fireEvent.click(screen.getByRole('button', { name: '配置' }))

    const dialog = await screen.findByRole('dialog', { name: '配置编码规则' })
    fireEvent.change(within(dialog).getByLabelText('前缀'), { target: { value: 'GL-' } })
    fireEvent.change(within(dialog).getByLabelText('格式'), { target: { value: '{PREFIX}{YYYY}{NNN}' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(capturedRuleId).toBe('rule-global'))
    expect(capturedBody).toEqual({ prefix: 'GL-', format: '{PREFIX}{YYYY}{NNN}' })
    expect(window.alert).toHaveBeenLastCalledWith('配置已保存')
  })
})
