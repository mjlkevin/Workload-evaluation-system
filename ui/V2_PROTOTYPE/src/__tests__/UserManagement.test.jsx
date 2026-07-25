import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import UserManagement from '../pages/UserManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('UserManagement', () => {
  test('separates page actions, filters, bulk actions, and row editing', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    await screen.findByRole('heading', { name: '用户管理' })
    const editArch = await screen.findByRole('button', { name: '编辑 arch' })

    expect(screen.queryByText(/已选 0/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ 邀请成员' })).not.toBeInTheDocument()

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

  test('gives search a persistent accessible name', async () => {
    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    await screen.findByRole('heading', { name: '用户管理' })

    expect(screen.getByRole('searchbox', { name: '搜索用户' })).toHaveAttribute(
      'placeholder',
      '搜索用户名 / 邮箱'
    )
  })

  test('excludes locked users from shift-range selection and bulk targets', async () => {
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
      }))
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
    expect(within(firstRow).getByText('已禁用')).toBeInTheDocument()
    expect(within(thirdRow).getByText('已禁用')).toBeInTheDocument()
    expect(within(lockedRow).getByText('正常')).toBeInTheDocument()
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

  test('persists changed user fields in business-role then role order', async () => {
    let serverUser = {
      id: 'u3',
      username: 'arch',
      email: 'arch@wes.local',
      role: 'user',
      businessRole: 'pre_sales',
      status: 'active',
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
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(calls).toEqual([
        { endpoint: 'businessRole', body: { businessRole: 'pm' } },
        { endpoint: 'role', body: { role: 'sub_admin' } },
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

  test('stops after a failed patch, reloads users, and keeps the editor open', async () => {
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
    fireEvent.click(within(editor).getByRole('button', { name: '保存变更' }))

    await waitFor(() => {
      expect(within(editor).getByRole('status')).toHaveTextContent(/业务角色保存失败/)
    })
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
    expect(getCount).toBeGreaterThanOrEqual(2)
    expect(laterPatchCount).toBe(0)
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
