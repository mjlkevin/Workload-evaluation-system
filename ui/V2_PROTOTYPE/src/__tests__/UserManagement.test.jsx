import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import UserManagement, * as UserManagementModule from '../pages/UserManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('UserManagement', () => {
  test('separates page actions, filters, bulk actions, and row editing', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    await screen.findByRole('heading', { name: '用户管理' })
    const editArch = await screen.findByRole('button', { name: '编辑 arch' })

    expect(screen.queryByText(/已选 0/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 邀请成员' })).toBeInTheDocument()

    fireEvent.click(editArch)

    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    expect(within(editor).getByText('arch')).toBeInTheDocument()
    expect(screen.queryByText('已选 1 人')).not.toBeInTheDocument()

    fireEvent.click(within(editor).getByRole('button', { name: '关闭编辑用户' }))
    expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 arch' }))

    const selectedSummary = screen.getByText('已选 1 人')
    const selectionBar = screen.getByRole('region', { name: '批量操作' })
    expect(selectionBar).toContainElement(selectedSummary)
    expect(within(selectionBar).getByRole('button', { name: '清除选择' })).toBeInTheDocument()
    for (const actionName of ['批量启用', '批量禁用', '改系统角色', '改业务角色']) {
      expect(within(selectionBar).getByRole('button', { name: actionName })).toBeInTheDocument()
    }
    expect(within(selectionBar).queryByRole('button', { name: /重置密码/ })).not.toBeInTheDocument()
  })

  test('focuses the first editable user field', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))

    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    const systemRole = within(editor).getByLabelText('系统角色')

    await waitFor(() => {
      expect(systemRole).toHaveFocus()
    })
    expect(systemRole).toBeEnabled()
    expect(within(editor).getByRole('button', { name: '保存变更' })).toBeDisabled()
  })

  test('protects dirty editor changes and restores focus after discard', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    const editArch = await screen.findByRole('button', { name: '编辑 arch' })
    editArch.focus()
    fireEvent.click(editArch)
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })

    fireEvent.click(within(editor).getByRole('button', { name: '关闭编辑用户' }))

    let discardDialog = screen.getByRole('dialog', { name: '放弃未保存修改' })
    expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument()
    expect(editor).toHaveAttribute('aria-hidden', 'true')
    expect(editor).toHaveAttribute('inert')
    fireEvent.click(discardDialog.parentElement)
    expect(screen.getByRole('dialog', { name: '放弃未保存修改' })).toBeInTheDocument()

    fireEvent.click(within(discardDialog).getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('dialog', { name: '放弃未保存修改' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()

    fireEvent.click(within(editor).getByRole('button', { name: '关闭编辑用户' }))
    discardDialog = screen.getByRole('dialog', { name: '放弃未保存修改' })
    fireEvent.click(within(discardDialog).getByRole('button', { name: '放弃修改' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument()
    })
    expect(editArch).toHaveFocus()
  })

  test('protects dirty editor changes when Escape requests close', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })

    fireEvent.keyDown(editor, { key: 'Escape' })

    const discardDialog = screen.getByRole('dialog', { name: '放弃未保存修改' })
    expect(editor).toBeInTheDocument()
    fireEvent.keyDown(discardDialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '放弃未保存修改' })).not.toBeInTheDocument()
    expect(editor).toBeInTheDocument()
    expect(within(editor).getByLabelText('业务角色')).toHaveValue('pm')
  })

  test('opens password reset for the editing user and cancels without closing the drawer', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '重置密码…' }))

    const passwordDialog = screen.getByRole('dialog', { name: '重置登录密码' })
    expect(within(passwordDialog).getByText('arch')).toBeInTheDocument()
    fireEvent.click(within(passwordDialog).getByRole('button', { name: '取消重置' }))

    expect(screen.queryByRole('dialog', { name: '重置登录密码' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
    expect(within(editor).getByLabelText('业务角色')).toHaveValue('pm')
  })

  test('resets the current editing user password with inline validation and contextual success', async () => {
    const passwordCalls = []
    server.use(
      http.patch(`${BASE}/auth/users/:userId/password`, async ({ params, request }) => {
        passwordCalls.push({
          userId: params.userId,
          body: await request.json(),
        })
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            user: {
              id: params.userId,
              username: 'arch',
              role: 'user',
              businessRole: 'pre_sales',
              status: 'active',
            },
          },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 pm' }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.click(within(editor).getByRole('button', { name: '重置密码…' }))
    const passwordDialog = screen.getByRole('dialog', { name: '重置登录密码' })
    const password = within(passwordDialog).getByLabelText('新密码')
    const confirmation = within(passwordDialog).getByLabelText('确认密码')
    const submit = within(passwordDialog).getByRole('button', { name: '确认重置' })

    fireEvent.change(password, { target: { value: '1234567' } })
    fireEvent.change(confirmation, { target: { value: '1234567' } })
    fireEvent.click(submit)
    expect(within(passwordDialog).getByRole('status')).toHaveTextContent('密码至少需要 8 位')
    expect(passwordCalls).toEqual([])

    fireEvent.change(password, { target: { value: 'new-pass-88' } })
    fireEvent.change(confirmation, { target: { value: 'different' } })
    fireEvent.click(submit)
    expect(within(passwordDialog).getByRole('status')).toHaveTextContent('两次输入的密码不一致')
    expect(passwordCalls).toEqual([])

    fireEvent.change(confirmation, { target: { value: 'new-pass-88' } })
    fireEvent.click(submit)

    await waitFor(() => {
      expect(passwordCalls).toEqual([
        { userId: 'u3', body: { password: 'new-pass-88' } },
      ])
      expect(screen.queryByRole('dialog', { name: '重置登录密码' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
    expect(within(editor).getByRole('status')).toHaveTextContent('已重置 arch 的登录密码')
  })

  test('reset failure stays inline and preserves the password form for retry', async () => {
    server.use(
      http.patch(`${BASE}/auth/users/:userId/password`, () => HttpResponse.json(
        { code: 40021, message: '密码策略拒绝' },
        { status: 400 }
      ))
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.click(within(editor).getByRole('button', { name: '重置密码…' }))
    const passwordDialog = screen.getByRole('dialog', { name: '重置登录密码' })
    fireEvent.change(within(passwordDialog).getByLabelText('新密码'), {
      target: { value: 'valid-pass-88' },
    })
    fireEvent.change(within(passwordDialog).getByLabelText('确认密码'), {
      target: { value: 'valid-pass-88' },
    })
    fireEvent.click(within(passwordDialog).getByRole('button', { name: '确认重置' }))

    await waitFor(() => {
      expect(within(passwordDialog).getByRole('status')).toHaveTextContent('密码策略拒绝')
      expect(within(passwordDialog).getByRole('button', { name: '确认重置' })).toBeEnabled()
    })
    expect(within(passwordDialog).getByLabelText('新密码')).toHaveValue('valid-pass-88')
    expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument()
    expect(editor).toHaveAttribute('aria-hidden', 'true')
    expect(editor).toHaveAttribute('inert')
    expect(window.alert).not.toHaveBeenCalled()
  })

  test('keeps password reset open and owned while the request is pending', async () => {
    let releasePasswordRequest
    server.use(
      http.patch(`${BASE}/auth/users/:userId/password`, async () => {
        await new Promise((resolve) => {
          releasePasswordRequest = resolve
        })
        return HttpResponse.json(
          { code: 50031, message: '密码服务暂不可用' },
          { status: 500 }
        )
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.click(within(editor).getByRole('button', { name: '重置密码…' }))
    const passwordDialog = screen.getByRole('dialog', { name: '重置登录密码' })
    fireEvent.change(within(passwordDialog).getByLabelText('新密码'), {
      target: { value: 'valid-pass-88' },
    })
    fireEvent.change(within(passwordDialog).getByLabelText('确认密码'), {
      target: { value: 'valid-pass-88' },
    })
    fireEvent.click(within(passwordDialog).getByRole('button', { name: '确认重置' }))

    await waitFor(() => {
      expect(releasePasswordRequest).toEqual(expect.any(Function))
      expect(within(passwordDialog).getByRole('button', { name: '关闭重置登录密码' }))
        .toBeDisabled()
    })
    const closeButton = within(passwordDialog).getByRole('button', { name: '关闭重置登录密码' })
    fireEvent.keyDown(passwordDialog, { key: 'Escape' })
    fireEvent.click(closeButton)
    fireEvent.click(passwordDialog.parentElement)
    expect(screen.getByRole('dialog', { name: '重置登录密码' })).toBeInTheDocument()

    releasePasswordRequest()

    await waitFor(() => {
      expect(within(passwordDialog).getByRole('status')).toHaveTextContent('密码服务暂不可用')
      expect(closeButton).toBeEnabled()
    })
    fireEvent.click(closeButton)
    expect(screen.queryByRole('dialog', { name: '重置登录密码' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
  })

  test('confirms disabling an active user before the serialized status save', async () => {
    const statusCalls = []
    server.use(
      http.patch(`${BASE}/auth/users/:userId/status`, async ({ params, request }) => {
        const body = await request.json()
        statusCalls.push({ userId: params.userId, body })
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            user: {
              id: params.userId,
              username: 'arch',
              role: 'user',
              businessRole: 'pre_sales',
              status: body.status,
            },
          },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('账户状态'), {
      target: { value: 'disabled' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    const riskDialog = screen.getByRole('dialog', { name: '确认风险变更' })
    expect(within(riskDialog).getByText('arch')).toBeInTheDocument()
    expect(within(riskDialog).getByText('正常 → 已禁用')).toBeInTheDocument()
    expect(within(riskDialog).queryByLabelText('输入“我确定”')).not.toBeInTheDocument()
    expect(statusCalls).toEqual([])

    fireEvent.click(within(riskDialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '确认风险变更' })).not.toBeInTheDocument()
    expect(within(editor).getByLabelText('账户状态')).toHaveValue('disabled')
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    const reopenedRiskDialog = screen.getByRole('dialog', { name: '确认风险变更' })
    fireEvent.click(within(reopenedRiskDialog).getByRole('button', { name: '确认风险变更' }))

    await waitFor(() => {
      expect(statusCalls).toEqual([
        { userId: 'u3', body: { status: 'disabled' } },
      ])
    })
  })

  test('risk confirmation requires the exact phrase for admin demotion', () => {
    const RiskConfirmationDialog = UserManagementModule.RiskConfirmationDialog
    expect(RiskConfirmationDialog).toEqual(expect.any(Function))
    const onConfirm = vi.fn()
    const pendingSave = {
      userId: 'admin-user',
      original: {
        id: 'admin-user',
        username: 'root-admin',
        role: 'admin',
        status: 'active',
      },
      draft: {
        role: 'user',
        status: 'active',
      },
      changes: { role: 'user' },
    }
    let riskPhrase = ''
    const { rerender } = render(
      <RiskConfirmationDialog
        open
        pendingSave={pendingSave}
        riskPhrase={riskPhrase}
        onPhraseChange={(value) => {
          riskPhrase = value
        }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    )

    let riskDialog = screen.getByRole('dialog', { name: '确认风险变更' })
    const phrase = within(riskDialog).getByLabelText('输入“我确定”')
    expect(within(riskDialog).getByText('超级管理员 → 普通用户')).toBeInTheDocument()
    expect(within(riskDialog).getByRole('button', { name: '确认风险变更' })).toBeDisabled()

    fireEvent.change(phrase, { target: { value: ' 我确定 ' } })
    rerender(
      <RiskConfirmationDialog
        open
        pendingSave={pendingSave}
        riskPhrase={riskPhrase}
        onPhraseChange={(value) => {
          riskPhrase = value
        }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    )
    riskDialog = screen.getByRole('dialog', { name: '确认风险变更' })
    fireEvent.click(within(riskDialog).getByRole('button', { name: '确认风险变更' }))
    expect(within(riskDialog).getByRole('button', { name: '确认风险变更' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(within(riskDialog).getByLabelText('输入“我确定”'), {
      target: { value: '我确认' },
    })
    rerender(
      <RiskConfirmationDialog
        open
        pendingSave={pendingSave}
        riskPhrase={riskPhrase}
        onPhraseChange={(value) => {
          riskPhrase = value
        }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    )
    riskDialog = screen.getByRole('dialog', { name: '确认风险变更' })
    expect(within(riskDialog).getByRole('button', { name: '确认风险变更' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(within(riskDialog).getByLabelText('输入“我确定”'), {
      target: { value: '我确定' },
    })
    rerender(
      <RiskConfirmationDialog
        open
        pendingSave={pendingSave}
        riskPhrase={riskPhrase}
        onPhraseChange={(value) => {
          riskPhrase = value
        }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    )
    riskDialog = screen.getByRole('dialog', { name: '确认风险变更' })
    expect(within(riskDialog).getByRole('button', { name: '确认风险变更' })).toBeEnabled()
    fireEvent.click(within(riskDialog).getByRole('button', { name: '确认风险变更' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('gives search a persistent accessible name', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    await screen.findByRole('heading', { name: '用户管理' })

    expect(screen.getByRole('searchbox', { name: '搜索用户' })).toHaveAttribute(
      'placeholder',
      '搜索用户名 / 邮箱'
    )
  })

  test('excludes locked users from shift-range selection and bulk targets', async () => {
    const statusCalls = []
    server.use(
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({
        success: true,
        data: {
          users: [
            { id: 'u-alpha', username: 'alpha', email: 'alpha@wes.local', role: 'user', status: 'active', locked: false },
            { id: 'u-system', username: 'system-lock', email: 'system@wes.local', role: 'user', status: 'active', locked: true },
            { id: 'u-omega', username: 'omega', email: 'omega@wes.local', role: 'user', status: 'active', locked: false },
          ],
        },
      })),
      http.patch(`${BASE}/auth/users/:userId/status`, async ({ params, request }) => {
        statusCalls.push({
          userId: params.userId,
          body: await request.json(),
        })
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: { id: params.userId } },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    const firstRow = (await screen.findByText('alpha')).closest('tr')
    const lockedRow = screen.getByText('system-lock').closest('tr')
    const thirdRow = screen.getByText('omega').closest('tr')

    fireEvent.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })

    expect(screen.getByRole('region', { name: '批量操作' })).toHaveTextContent('已选 2 人')
    expect(lockedRow).not.toHaveStyle({ background: 'var(--brand-soft)' })

    fireEvent.click(screen.getByRole('button', { name: '批量禁用' }))
    const statusDialog = screen.getByRole('dialog', { name: '批量禁用' })
    expect(within(statusDialog).getByText('alpha')).toBeInTheDocument()
    expect(within(statusDialog).getByText('omega')).toBeInTheDocument()
    fireEvent.click(within(statusDialog).getByRole('button', { name: '确认禁用' }))

    await screen.findByText('批量禁用：成功 2 人')
    expect(statusCalls).toEqual([
      { userId: 'u-alpha', body: { status: 'disabled' } },
      { userId: 'u-omega', body: { status: 'disabled' } },
    ])
    expect(within(lockedRow).getByText('正常')).toBeInTheDocument()
  })

  test('persists bulk role changes sequentially and reports partial failures by username', async () => {
    const users = [
      { id: 'u1', username: 'admin', role: 'admin', businessRole: 'admin', status: 'active' },
      { id: 'u2', username: 'pm', role: 'sub_admin', businessRole: 'pm', status: 'active' },
      { id: 'u3', username: 'arch', role: 'user', businessRole: 'pre_sales', status: 'active' },
    ]
    const patched = []
    let getCount = 0
    server.use(
      http.get(`${BASE}/auth/users`, () => {
        getCount += 1
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { users },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/role`, async ({ params, request }) => {
        patched.push({
          userId: params.userId,
          body: await request.json(),
        })
        if (params.userId === 'u3') {
          return HttpResponse.json(
            { code: 50001, message: '模拟失败' },
            { status: 500 }
          )
        }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: { id: params.userId } },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 pm' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 arch' }))
    fireEvent.click(screen.getByRole('button', { name: '改系统角色' }))
    const roleDialog = screen.getByRole('dialog', { name: '修改系统角色' })
    fireEvent.click(within(roleDialog).getByRole('radio', { name: '普通用户' }))
    fireEvent.click(within(roleDialog).getByRole('button', { name: '确认修改' }))

    await screen.findByText('修改系统角色：成功 1 人，失败 1 人：arch')
    expect(patched).toEqual([
      { userId: 'u2', body: { role: 'user' } },
      { userId: 'u3', body: { role: 'user' } },
    ])
    expect(getCount).toBe(2)
    expect(screen.queryByRole('dialog', { name: '修改系统角色' })).not.toBeInTheDocument()
    const selectionBar = screen.getByRole('region', { name: '批量操作' })
    expect(selectionBar).toHaveTextContent('未选择')
    for (const actionName of ['批量启用', '批量禁用', '改系统角色', '改业务角色']) {
      expect(within(selectionBar).getByRole('button', { name: actionName })).toBeDisabled()
    }
  })

  test('uses a stable bulk target snapshot and locks overlapping controls while submitting', async () => {
    const calls = []
    let releaseFirstPatch
    server.use(
      http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ params, request }) => {
        calls.push({
          userId: params.userId,
          body: await request.json(),
        })
        if (params.userId === 'u2') {
          await new Promise((resolve) => {
            releaseFirstPatch = resolve
          })
        }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: { id: params.userId } },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    const pmSelection = await screen.findByRole('checkbox', { name: '选择 pm' })
    const archSelection = screen.getByRole('checkbox', { name: '选择 arch' })
    fireEvent.click(pmSelection)
    fireEvent.click(archSelection)
    fireEvent.click(screen.getByRole('button', { name: '改业务角色' }))
    const businessRoleDialog = screen.getByRole('dialog', { name: '修改业务角色' })
    fireEvent.click(within(businessRoleDialog).getByRole('radio', { name: /^销售员/ }))
    fireEvent.click(within(businessRoleDialog).getByRole('button', { name: '确认修改' }))

    await waitFor(() => {
      expect(calls).toEqual([
        { userId: 'u2', body: { businessRole: 'sales' } },
      ])
      expect(releaseFirstPatch).toEqual(expect.any(Function))
    })
    expect(within(businessRoleDialog).getByRole('button', { name: '关闭修改业务角色' }))
      .toBeDisabled()
    expect(within(businessRoleDialog).getByRole('button', { name: '取消' })).toBeDisabled()
    expect(within(businessRoleDialog).getByRole('button', { name: '修改中…' })).toBeDisabled()
    expect(pmSelection).toBeDisabled()
    expect(archSelection).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ 邀请成员' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑 arch' })).toBeDisabled()

    fireEvent.click(archSelection)
    releaseFirstPatch()

    await screen.findByText('修改业务角色：成功 2 人')
    expect(calls).toEqual([
      { userId: 'u2', body: { businessRole: 'sales' } },
      { userId: 'u3', body: { businessRole: 'sales' } },
    ])
  })

  test('warns when bulk reconciliation fails without erasing the last valid users', async () => {
    const users = [
      { id: 'u3', username: 'arch', role: 'user', businessRole: 'pre_sales', status: 'active' },
    ]
    let getCount = 0
    server.use(
      http.get(`${BASE}/auth/users`, () => {
        getCount += 1
        if (getCount === 2) {
          return HttpResponse.json(
            { code: 50002, message: '刷新失败' },
            { status: 500 }
          )
        }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { users },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 arch' }))
    fireEvent.click(screen.getByRole('button', { name: '改系统角色' }))
    const roleDialog = screen.getByRole('dialog', { name: '修改系统角色' })
    fireEvent.click(within(roleDialog).getByRole('radio', { name: '管理员' }))
    fireEvent.click(within(roleDialog).getByRole('button', { name: '确认修改' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('修改系统角色：成功 1 人')
    expect(notice).toHaveTextContent('服务器状态刷新失败，当前显示可能过期：刷新失败')
    expect(screen.getByText('arch')).toBeInTheDocument()
    expect(getCount).toBe(2)
  })

  test('summarizes the first three bulk targets and the remaining count', async () => {
    server.use(
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: {
          users: [
            { id: 'u-a', username: 'alpha', role: 'user', status: 'active' },
            { id: 'u-b', username: 'bravo', role: 'user', status: 'active' },
            { id: 'u-c', username: 'charlie', role: 'user', status: 'active' },
            { id: 'u-d', username: 'delta', role: 'user', status: 'active' },
          ],
        },
      }))
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择全部可见用户' }))
    fireEvent.click(screen.getByRole('button', { name: '批量禁用' }))
    const statusDialog = screen.getByRole('dialog', { name: '批量禁用' })

    expect(within(statusDialog).getByText('已选 4 人')).toBeInTheDocument()
    for (const username of ['alpha', 'bravo', 'charlie']) {
      expect(within(statusDialog).getByText(username)).toBeInTheDocument()
    }
    expect(within(statusDialog).queryByText('delta')).not.toBeInTheDocument()
    expect(within(statusDialog).getByText('还有 1 人')).toBeInTheDocument()
  })

  test('generates and displays an invite code with copy feedback', async () => {
    server.use(
      http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: {
          code: {
            code: 'WES-ABCD',
            status: 'active',
            createdAt: '2026-07-26T01:00:00.000Z',
          },
        },
      }))
    )
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '+ 邀请成员' }))
    const inviteDialog = await screen.findByRole('dialog', { name: '成员邀请码' })
    expect(inviteDialog).toHaveTextContent('WES-ABCD')
    expect(within(inviteDialog).getByText('当前状态：有效')).toBeInTheDocument()
    expect(within(inviteDialog).getByText(/创建时间/)).toBeInTheDocument()
    expect(within(inviteDialog).queryByText(/过期/)).not.toBeInTheDocument()
    fireEvent.click(within(inviteDialog).getByRole('button', { name: '复制邀请码' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('WES-ABCD'))
    expect(within(inviteDialog).getByRole('status')).toHaveTextContent('已复制')
  })

  test('keeps delayed copy feedback owned by the current invite record', async () => {
    const generatedCodes = ['WES-COPY-A', 'WES-COPY-B']
    let releaseCopy
    server.use(
      http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: {
          code: {
            code: generatedCodes.shift(),
            status: 'active',
            createdAt: '2026-07-26T01:00:00.000Z',
          },
        },
      }))
    )
    const writeText = vi.fn(() => new Promise((resolve) => {
      releaseCopy = resolve
    }))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '+ 邀请成员' }))
    let inviteDialog = await screen.findByRole('dialog', { name: '成员邀请码' })
    expect(inviteDialog).toHaveTextContent('WES-COPY-A')
    fireEvent.click(within(inviteDialog).getByRole('button', { name: '复制邀请码' }))

    await waitFor(() => {
      expect(releaseCopy).toEqual(expect.any(Function))
      expect(within(inviteDialog).getByRole('button', { name: '复制中…' })).toBeDisabled()
    })
    const closeButton = within(inviteDialog).getByRole('button', { name: '关闭成员邀请码' })
    const actionCloseButton = within(inviteDialog).getByRole('button', { name: '关闭' })
    expect(closeButton).toBeDisabled()
    expect(actionCloseButton).toBeDisabled()
    fireEvent.click(closeButton)
    fireEvent.click(actionCloseButton)
    fireEvent.keyDown(inviteDialog, { key: 'Escape' })
    fireEvent.click(inviteDialog.parentElement)
    expect(screen.getByRole('dialog', { name: '成员邀请码' })).toHaveTextContent('WES-COPY-A')

    releaseCopy()

    await waitFor(() => {
      const copyStatus = within(inviteDialog).getByRole('status')
      expect(copyStatus).toHaveTextContent('已复制 WES-COPY-A')
      expect(copyStatus).toHaveAttribute('data-kind', 'success')
      expect(closeButton).toBeEnabled()
    })
    expect(writeText).toHaveBeenCalledWith('WES-COPY-A')
    fireEvent.click(closeButton)
    fireEvent.click(screen.getByRole('button', { name: '+ 邀请成员' }))

    inviteDialog = await screen.findByRole('dialog', { name: '成员邀请码' })
    expect(inviteDialog).toHaveTextContent('WES-COPY-B')
    expect(within(inviteDialog).queryByRole('status')).not.toBeInTheDocument()
  })

  test.each([
    ['missing code', { status: 'active', createdAt: '2026-07-26T01:00:00.000Z' }],
    ['invalid status', { code: 'WES-BAD-STATUS', status: 'expired', createdAt: '2026-07-26T01:00:00.000Z' }],
    ['invalid createdAt', { code: 'WES-BAD-DATE', status: 'active', createdAt: 'not-a-date' }],
  ])('rejects malformed invite response: %s', async (_, record) => {
    server.use(
      http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: { code: record },
      }))
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '+ 邀请成员' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('邀请码响应不完整，请重试')
    expect(screen.queryByRole('dialog', { name: '成员邀请码' })).not.toBeInTheDocument()
  })

  test('locks invite, editing, selection, and bulk entry points while generating a code', async () => {
    let releaseInvite
    let inviteCalls = 0
    server.use(
      http.post(`${BASE}/auth/invite-codes/generate`, async () => {
        inviteCalls += 1
        await new Promise((resolve) => {
          releaseInvite = resolve
        })
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            code: {
              code: 'WES-LOCK',
              status: 'active',
              createdAt: '2026-07-26T01:00:00.000Z',
            },
          },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    const archSelection = await screen.findByRole('checkbox', { name: '选择 arch' })
    fireEvent.click(archSelection)
    fireEvent.click(screen.getByRole('button', { name: '+ 邀请成员' }))

    await waitFor(() => {
      expect(releaseInvite).toEqual(expect.any(Function))
      expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled()
    })
    expect(archSelection).toBeDisabled()
    expect(screen.getByRole('button', { name: '改系统角色' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑 arch' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '生成中…' }))
    expect(inviteCalls).toBe(1)

    releaseInvite()
    expect(await screen.findByRole('dialog', { name: '成员邀请码' }))
      .toHaveTextContent('WES-LOCK')
  })

  test('reports clipboard and invite generation failures without browser alerts', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '+ 邀请成员' }))
    let inviteDialog = await screen.findByRole('dialog', { name: '成员邀请码' })
    fireEvent.click(within(inviteDialog).getByRole('button', { name: '复制邀请码' }))
    expect(await within(inviteDialog).findByRole('status'))
      .toHaveTextContent('复制失败，请手动复制')
    fireEvent.click(within(inviteDialog).getByRole('button', { name: '关闭' }))

    server.use(
      http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json(
        { code: 50003, message: '邀请码服务失败' },
        { status: 500 }
      ))
    )
    fireEvent.click(screen.getByRole('button', { name: '+ 邀请成员' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('邀请码服务失败')
    expect(screen.queryByRole('dialog', { name: '成员邀请码' })).not.toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })

  test('disables select-all when only locked users are visible', async () => {
    server.use(
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({
        success: true,
        data: {
          users: [
            { id: 'u-system', username: 'system-lock', email: 'system@wes.local', role: 'user', status: 'active', locked: true },
          ],
        },
      }))
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    await screen.findByText('system-lock')
    const selectAll = screen.getByRole('checkbox', { name: '选择全部可见用户' })

    expect(selectAll).not.toBeChecked()
    expect(selectAll).toBeDisabled()
  })

  test('combines role, status, and text filters and clears hidden selections', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    await screen.findByRole('heading', { name: '用户管理' })
    const archSelection = await screen.findByRole('checkbox', { name: '选择 arch' })
    fireEvent.click(archSelection)
    expect(screen.getByText('已选 1 人')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('系统角色'), { target: { value: 'sub_admin' } })

    expect(screen.queryByRole('checkbox', { name: '选择 arch' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 pm' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('已选 1 人')).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'active' } })
    fireEvent.change(screen.getByPlaceholderText('搜索用户名 / 邮箱'), {
      target: { value: 'pm@wes.local' },
    })
    expect(screen.getByRole('checkbox', { name: '选择 pm' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 arch' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('搜索用户名 / 邮箱'), {
      target: { value: 'nobody@wes.local' },
    })
    expect(screen.queryByRole('checkbox', { name: '选择 pm' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'disabled' } })
    fireEvent.change(screen.getByPlaceholderText('搜索用户名 / 邮箱'), {
      target: { value: '' },
    })
    expect(screen.queryByRole('checkbox', { name: '选择 pm' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('系统角色'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } })
    fireEvent.change(screen.getByPlaceholderText('搜索用户名 / 邮箱'), {
      target: { value: 'arch@wes.local' },
    })

    expect(screen.getByRole('checkbox', { name: '选择 arch' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 pm' })).not.toBeInTheDocument()
  })

  test('persists changed user fields in business-role then role then status order', async () => {
    let serverUser = {
      id: 'u3',
      username: 'arch',
      email: 'arch@wes.local',
      role: 'user',
      businessRole: 'pre_sales',
      status: 'disabled',
      locked: false,
    }
    let getCount = 0
    let releaseReload
    const calls = []

    server.use(
      http.get(`${BASE}/auth/users`, async () => {
        getCount += 1
        if (getCount > 1) {
          await new Promise((resolve) => {
            releaseReload = resolve
          })
        }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { users: [serverUser] },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ params, request }) => {
        const body = await request.json()
        calls.push({ endpoint: 'businessRole', body })
        serverUser = { ...serverUser, id: params.userId, businessRole: body.businessRole }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: serverUser },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/role`, async ({ params, request }) => {
        const body = await request.json()
        calls.push({ endpoint: 'role', body })
        serverUser = { ...serverUser, id: params.userId, role: body.role }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: serverUser },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/status`, async ({ params, request }) => {
        const body = await request.json()
        calls.push({ endpoint: 'status', body })
        serverUser = { ...serverUser, id: params.userId, status: body.status }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: serverUser },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('系统角色'), {
      target: { value: 'sub_admin' },
    })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })
    fireEvent.change(within(editor).getByLabelText('账户状态'), {
      target: { value: 'active' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(calls).toEqual([
        { endpoint: 'businessRole', body: { businessRole: 'pm' } },
        { endpoint: 'role', body: { role: 'sub_admin' } },
        { endpoint: 'status', body: { status: 'active' } },
      ])
    })
    await waitFor(() => {
      expect(releaseReload).toEqual(expect.any(Function))
    })
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()

    releaseReload()

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('status')).toHaveTextContent('已保存 arch')
  })

  test('does not patch unchanged user fields', async () => {
    const serverUser = {
      id: 'u3',
      username: 'arch',
      email: 'arch@wes.local',
      role: 'user',
      businessRole: 'pre_sales',
      status: 'active',
      locked: false,
    }
    const calls = []

    server.use(
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: { users: [serverUser] },
      })),
      http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ request }) => {
        calls.push({ endpoint: 'businessRole', body: await request.json() })
        return HttpResponse.json({ code: 0, message: 'ok', data: { user: serverUser } })
      }),
      http.patch(`${BASE}/auth/users/:userId/role`, async ({ request }) => {
        const body = await request.json()
        calls.push({ endpoint: 'role', body })
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: { ...serverUser, role: body.role } },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/status`, async ({ request }) => {
        calls.push({ endpoint: 'status', body: await request.json() })
        return HttpResponse.json({ code: 0, message: 'ok', data: { user: serverUser } })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('系统角色'), {
      target: { value: 'sub_admin' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('已保存 arch')
    })
    expect(calls).toEqual([
      { endpoint: 'role', body: { role: 'sub_admin' } },
    ])
  })

  test('locks dismissal and user switching while a save is pending', async () => {
    let releasePatch
    let patchCompleted = false
    let patchCount = 0
    let getCount = 0
    const users = [
      {
        id: 'u2',
        username: 'pm',
        email: 'pm@wes.local',
        role: 'sub_admin',
        businessRole: 'pm',
        status: 'active',
        locked: false,
      },
      {
        id: 'u3',
        username: 'arch',
        email: 'arch@wes.local',
        role: 'user',
        businessRole: 'pre_sales',
        status: 'active',
        locked: false,
      },
    ]

    server.use(
      http.get(`${BASE}/auth/users`, () => {
        getCount += 1
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { users },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ params, request }) => {
        patchCount += 1
        const body = await request.json()
        await new Promise((resolve) => {
          releasePatch = resolve
        })
        patchCompleted = true
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            user: {
              ...users.find((user) => user.id === params.userId),
              businessRole: body.businessRole,
            },
          },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 pm' }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    let editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(releasePatch).toEqual(expect.any(Function))
    })
    expect(screen.getByRole('button', { name: '+ 邀请成员' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '改系统角色' })).toBeDisabled()
    expect(within(editor).getByRole('button', { name: '关闭编辑用户' })).toBeDisabled()
    expect(within(editor).getByRole('button', { name: '取消' })).toBeDisabled()
    expect(within(editor).getByLabelText('系统角色')).toBeDisabled()
    expect(within(editor).getByLabelText('业务角色')).toBeDisabled()
    expect(within(editor).getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(within(editor).getByRole('button', { name: '重置密码…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑 arch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑 pm' })).toBeDisabled()

    fireEvent.keyDown(editor, { key: 'Escape' })
    fireEvent.click(editor.parentElement)

    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '放弃未保存修改' })).not.toBeInTheDocument()
    expect(patchCount).toBe(1)

    releasePatch()

    await waitFor(() => {
      expect(patchCompleted).toBe(true)
      expect(getCount).toBeGreaterThanOrEqual(2)
      expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('已保存 arch')
    })
    expect(screen.getByRole('button', { name: '编辑 arch' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '编辑 pm' })).toBeEnabled()
    expect(patchCount).toBe(1)
  })

  test('stops after a failed patch, reports failed reconciliation, and retries the reload', async () => {
    let getCount = 0
    let laterPatchCount = 0
    const serverUser = {
      id: 'u3',
      username: 'arch',
      email: 'arch@wes.local',
      role: 'user',
      businessRole: 'pre_sales',
      status: 'active',
      locked: false,
    }

    server.use(
      http.get(`${BASE}/auth/users`, () => {
        getCount += 1
        if (getCount === 2) {
          return HttpResponse.json(
            { code: 50002, message: '刷新失败' },
            { status: 500 }
          )
        }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { users: [serverUser] },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/business-role`, () => HttpResponse.json(
        { code: 50001, message: '保存失败' },
        { status: 500 }
      )),
      http.patch(`${BASE}/auth/users/:userId/role`, () => {
        laterPatchCount += 1
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: serverUser },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })
    fireEvent.change(within(editor).getByLabelText('系统角色'), {
      target: { value: 'sub_admin' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(within(editor).getByRole('status')).toHaveTextContent(/业务角色保存失败/)
      expect(within(editor).getByRole('status')).toHaveTextContent(
        /服务器状态刷新失败，当前显示可能过期/
      )
    })
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑 arch' })).toBeInTheDocument()
    expect(getCount).toBeGreaterThanOrEqual(2)
    expect(laterPatchCount).toBe(0)

    fireEvent.click(within(editor).getByRole('button', { name: '重新读取服务器数据' }))

    await waitFor(() => {
      expect(getCount).toBeGreaterThanOrEqual(3)
      expect(within(editor).getByRole('status')).toHaveTextContent('服务器数据已重新读取')
    })
    expect(within(editor).queryByRole('button', { name: '重新读取服务器数据' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
  })

  test('reports applied fields and stops before status after a partial save failure', async () => {
    let serverUser = {
      id: 'u3',
      username: 'arch',
      email: 'arch@wes.local',
      role: 'user',
      businessRole: 'pre_sales',
      status: 'disabled',
      locked: false,
    }
    let statusPatchCount = 0
    const calls = []

    server.use(
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({
        code: 0,
        message: 'ok',
        data: { users: [serverUser] },
      })),
      http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ params, request }) => {
        const body = await request.json()
        calls.push({ endpoint: 'businessRole', body })
        serverUser = { ...serverUser, id: params.userId, businessRole: body.businessRole }
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: serverUser },
        })
      }),
      http.patch(`${BASE}/auth/users/:userId/role`, async ({ request }) => {
        calls.push({ endpoint: 'role', body: await request.json() })
        return HttpResponse.json(
          { code: 50001, message: '保存失败' },
          { status: 500 }
        )
      }),
      http.patch(`${BASE}/auth/users/:userId/status`, async ({ request }) => {
        statusPatchCount += 1
        calls.push({ endpoint: 'status', body: await request.json() })
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: serverUser },
        })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
    const editor = screen.getByRole('dialog', { name: '编辑用户' })
    fireEvent.change(within(editor).getByLabelText('业务角色'), {
      target: { value: 'pm' },
    })
    fireEvent.change(within(editor).getByLabelText('系统角色'), {
      target: { value: 'sub_admin' },
    })
    fireEvent.change(within(editor).getByLabelText('账户状态'), {
      target: { value: 'active' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(within(editor).getByRole('status')).toHaveTextContent(/系统角色保存失败/)
      expect(within(editor).getByRole('status')).toHaveTextContent(/已保存：业务角色/)
    })
    expect(calls).toEqual([
      { endpoint: 'businessRole', body: { businessRole: 'pm' } },
      { endpoint: 'role', body: { role: 'sub_admin' } },
    ])
    expect(statusPatchCount).toBe(0)
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
  })

  test('displays role capabilities section and expands on click', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    // Wait for the role capabilities section to appear
    await screen.findByText('角色能力矩阵')

    // Click to expand
    fireEvent.click(screen.getByText('角色能力矩阵'))

    // Should show legacy role labels after expansion
    await waitFor(() => {
      // Use getAllByText since these may appear in both user table and role caps section
      expect(screen.getAllByText('超级管理员').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('管理员').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('普通用户').length).toBeGreaterThanOrEqual(1)
    })

    // Should show capability labels section
    await waitFor(() => {
      expect(screen.getByText(/能力位说明/)).toBeInTheDocument()
    })
  })

  test('does NOT trigger rules/models/DSL/templates requests (no side effects)', async () => {
    const sideEffectPaths = []

    // Override handler to track specific paths
    server.use(
      http.get(`${BASE}/system/*`, ({ request }) => {
        const url = new URL(request.url)
        const path = url.pathname.replace(BASE, '')
        sideEffectPaths.push(path)

        // Return appropriate mock responses
        if (path === '/system/role-capabilities') {
          return HttpResponse.json({
            success: true,
            data: { roles: [], legacyMapping: [], capabilityLabels: {} },
          })
        }
        // For other system paths, still return valid responses but track them
        return HttpResponse.json({ success: true, data: {} })
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    // Wait for page to render (use role to find the heading)
    await screen.findByRole('heading', { name: '用户管理' })

    // Give some time for any async requests to fire
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check that only role-capabilities was requested, not other system configs
    const unwantedPaths = [
      '/system/version-code-rules',
      '/system/requirement-settings',
      '/system/implementation-dependency-rules',
      '/system/knowledge-base-config',
    ]

    for (const path of unwantedPaths) {
      expect(sideEffectPaths).not.toContain(path)
    }

    // role-capabilities should be the only system endpoint called
    expect(sideEffectPaths).toContain('/system/role-capabilities')
  })

  test('gracefully handles API failure for role capabilities', async () => {
    // Override to simulate API failure for role-capabilities
    // Also ensure users endpoint is mocked
    server.use(
      http.get(`${BASE}/auth/users`, () => {
        return HttpResponse.json({
          success: true,
          data: {
            users: [
              { id: 'u1', username: 'mjlkevin', role: 'admin', status: 'active', lastLoginAt: '2026-05-09T14:28:00Z', locked: false },
              { id: 'u3', username: 'arch', role: 'user', status: 'active', lastLoginAt: null, locked: false },
            ],
          },
        })
      }),
      http.get(`${BASE}/system/role-capabilities`, () => {
        return HttpResponse.json(
          { success: false, message: '权限不足' },
          { status: 403 }
        )
      })
    )

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    // Page should still render
    await screen.findByRole('heading', { name: '用户管理' })

    // Click to expand role capabilities section
    fireEvent.click(screen.getByText('角色能力矩阵'))

    // Should show error message instead of crashing
    await waitFor(() => {
      expect(screen.getByText(/角色能力矩阵加载失败/)).toBeInTheDocument()
    })

    // User table should still be functional
    expect(screen.getAllByText('mjlkevin').length).toBeGreaterThanOrEqual(1)
  })
})
