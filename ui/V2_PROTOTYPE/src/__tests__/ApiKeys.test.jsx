import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import ApiKeys from '../pages/ApiKeys.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

const MOCK_KEYS = [
  { id: 'k1', name: '生产环境主密钥', code: 'sk-wes-prod-7a3f9e2b', status: 'active', scope: 'admin', createdAt: '2026-04-10T08:00:00Z' },
  { id: 'k2', name: '测试环境密钥', code: 'sk-wes-staging-4c8d1f5a', status: 'active', scope: 'write', createdAt: '2026-04-08T10:30:00Z' },
  { id: 'k3', name: '只读监控密钥', code: 'sk-wes-readonly-9e3b6c2d', status: 'revoked', scope: 'read', createdAt: '2026-03-22T14:15:00Z' },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <ApiKeys />
    </MemoryRouter>
  )
}

function mockKeyApis() {
  server.use(
    http.get(`${BASE}/auth/invite-codes`, () => HttpResponse.json({
      code: 0,
      message: 'ok',
      data: MOCK_KEYS,
    })),
    http.patch(`${BASE}/auth/keys/:keyId/revoke`, ({ params }) => HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { id: params.keyId, status: 'revoked' },
    })),
  )
}

describe('ApiKeys · 共享 Dialog 迁移', () => {
  test('新建密钥弹窗使用共享 Dialog：ARIA 语义、关闭按钮、Escape 关闭并归还焦点', async () => {
    mockKeyApis()
    renderPage()

    const opener = screen.getByRole('button', { name: '+ 生成新 Key' })
    fireEvent.click(opener)

    const dialog = await screen.findByRole('dialog', { name: '生成新 API Key' })
    expect(dialog).toHaveClass('wes-dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    // 可见关闭按钮
    const closeBtn = within(dialog).getByRole('button', { name: '关闭生成新 API Key' })
    expect(closeBtn).toBeInTheDocument()

    // Escape 关闭并归还焦点给触发器
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  test('新建密钥弹窗焦点圈闭：Tab 不逃逸到遮罩外', async () => {
    mockKeyApis()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '+ 生成新 Key' }))
    const dialog = await screen.findByRole('dialog', { name: '生成新 API Key' })

    const confirmBtn = within(dialog).getByRole('button', { name: '确认生成' })
    confirmBtn.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })

    // 焦点应留在 dialog 内
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})

describe('ApiKeys · 撤销危险确认', () => {
  test('点击撤销先打开确认弹窗，确认前不发起撤销请求', async () => {
    mockKeyApis()
    let revokeCalls = 0
    server.use(
      http.patch(`${BASE}/auth/keys/:keyId/revoke`, ({ params }) => {
        revokeCalls += 1
        return HttpResponse.json({ code: 0, message: 'ok', data: { id: params.keyId, status: 'revoked' } })
      }),
    )
    renderPage()

    const revokeButtons = await screen.findAllByRole('button', { name: '撤销' })
    fireEvent.click(revokeButtons[0])

    // 确认弹窗出现
    const confirmDialog = await screen.findByRole('dialog', { name: /撤销密钥/ })
    expect(confirmDialog).toHaveClass('wes-dialog')
    expect(revokeCalls).toBe(0)

    // 确认后发起请求
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '确认撤销' }))
    await waitFor(() => expect(revokeCalls).toBe(1))
  })

  test('取消撤销弹窗后密钥状态不变', async () => {
    mockKeyApis()
    renderPage()

    const revokeButtons = await screen.findAllByRole('button', { name: '撤销' })
    fireEvent.click(revokeButtons[0])

    const confirmDialog = await screen.findByRole('dialog', { name: /撤销密钥/ })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // 状态仍为生效中
    expect(screen.getAllByText('生效中').length).toBeGreaterThanOrEqual(2)
  })
})

describe('ApiKeys · 窄屏响应式', () => {
  test('主布局使用可折叠的共享 grid 类而非硬编码内联 grid', async () => {
    mockKeyApis()
    const { container } = renderPage()

    // 页面主内容区应使用 grid-2-eq（在 760px 下折叠为单列）
    const gridEl = container.querySelector('.grid-2-eq')
    expect(gridEl).not.toBeNull()
  })
})
