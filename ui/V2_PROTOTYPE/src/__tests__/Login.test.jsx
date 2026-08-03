import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import Login from '../pages/Login.jsx'
import ResetPassword from '../pages/ResetPassword.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAuthRoutes(initialEntries = ['/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Login', () => {
  test('stores a normal login token in sessionStorage', async () => {
    let requestBody
    server.use(http.post(`${BASE}/auth/login`, async ({ request }) => {
      requestBody = await request.json()
      return HttpResponse.json({
        code: 0,
        message: 'ok',
        data: {
          token: 'short-token',
          user: { id: 'u1', username: 'demo', role: 'user', status: 'active' },
          rememberMe: false,
          expiresIn: '8h',
        },
      })
    }))

    renderAuthRoutes()

    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'Password123!' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(requestBody).toEqual({ username: 'demo', password: 'Password123!', rememberMe: false })
      expect(sessionStorage.getItem('wes_token')).toBe('short-token')
      expect(localStorage.getItem('wes_token')).toBeNull()
      expect(JSON.parse(localStorage.getItem('wes_username_history'))).toEqual(['demo'])
      expect(localStorage.getItem('wes_username_history')).not.toContain('Password123!')
    })
  })

  test('migrates legacy recent usernames without retaining stored passwords', async () => {
    localStorage.setItem('wes_recent_users', JSON.stringify([
      { username: 'legacy-user', password: 'LegacyPassword123!', ts: 1 },
    ]))

    renderAuthRoutes()

    fireEvent.focus(screen.getByPlaceholderText('用户名'))

    expect(await screen.findByText('legacy-user')).toBeInTheDocument()
    expect(localStorage.getItem('wes_recent_users')).toBeNull()
    expect(JSON.parse(localStorage.getItem('wes_username_history'))).toEqual(['legacy-user'])
    expect(localStorage.getItem('wes_username_history')).not.toContain('LegacyPassword123!')
  })

  test('focuses the password field after selecting a recent username', async () => {
    localStorage.setItem('wes_username_history', JSON.stringify(['recent-user']))

    renderAuthRoutes()

    fireEvent.focus(screen.getByPlaceholderText('用户名'))
    fireEvent.click(await screen.findByText('recent-user'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('密码')).toHaveFocus()
    })
  })

  test('sends rememberMe and stores remembered token in localStorage', async () => {
    let requestBody
    server.use(http.post(`${BASE}/auth/login`, async ({ request }) => {
      requestBody = await request.json()
      return HttpResponse.json({
        code: 0,
        message: 'ok',
        data: {
          token: 'remembered-token',
          user: { id: 'u1', username: 'demo', role: 'user', status: 'active' },
          rememberMe: true,
          expiresIn: '7d',
        },
      })
    }))

    renderAuthRoutes()

    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'Password123!' } })
    fireEvent.click(screen.getByLabelText('记住 7 天'))
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(requestBody).toEqual({ username: 'demo', password: 'Password123!', rememberMe: true })
      expect(localStorage.getItem('wes_token')).toBe('remembered-token')
      expect(sessionStorage.getItem('wes_token')).toBeNull()
    })
  })

  test('requests and confirms password reset from the login page', async () => {
    let requestBody
    let confirmBody
    server.use(
      http.post(`${BASE}/auth/password-reset/request`, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            accepted: true,
            resetToken: 'reset-token-123',
            resetUrl: '/reset-password?token=reset-token-123',
            expiresInMinutes: 30,
          },
        })
      }),
      http.post(`${BASE}/auth/password-reset/confirm`, async ({ request }) => {
        confirmBody = await request.json()
        return HttpResponse.json({ code: 0, message: 'ok', data: { success: true } })
      })
    )

    renderAuthRoutes()

    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'demo' } })
    fireEvent.click(screen.getByRole('button', { name: '忘记密码?' }))
    fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }))

    expect(await screen.findByText(/重置链接已生成/)).toBeInTheDocument()
    expect(requestBody).toEqual({ username: 'demo' })

    fireEvent.click(screen.getByRole('link', { name: '立即重置密码' }))
    fireEvent.change(await screen.findByLabelText('新密码'), { target: { value: 'NewPass123!' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'NewPass123!' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重置密码' }))

    await waitFor(() => {
      expect(confirmBody).toEqual({ token: 'reset-token-123', password: 'NewPass123!' })
    })
    expect(await screen.findByText('密码已重置，请返回登录')).toBeInTheDocument()
  })
})
