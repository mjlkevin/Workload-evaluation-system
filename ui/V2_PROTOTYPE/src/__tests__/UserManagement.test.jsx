import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import UserManagement from '../pages/UserManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('UserManagement', () => {
  test('allows resetting the selected user login password', async () => {
    let requestBody
    let requestedUserId

    server.use(http.patch(`${BASE}/auth/users/:userId/password`, async ({ params, request }) => {
      requestedUserId = params.userId
      requestBody = await request.json()
      return HttpResponse.json({
        success: true,
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
    }))

    render(<MemoryRouter><UserManagement /></MemoryRouter>)

    fireEvent.click(await screen.findByText('arch'))
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(screen.getByText('重置登录密码')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123!' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'NewPass123!' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))

    await waitFor(() => {
      expect(requestedUserId).toBe('u3')
      expect(requestBody).toEqual({ password: 'NewPass123!' })
    })
    await waitFor(() => {
      expect(screen.queryByText('重置登录密码')).not.toBeInTheDocument()
    })
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
