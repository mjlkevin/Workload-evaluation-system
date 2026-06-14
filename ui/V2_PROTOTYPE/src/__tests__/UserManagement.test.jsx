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
})
