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

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Password123!' } })
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

    fireEvent.focus(screen.getByLabelText('用户名'))

    expect(await screen.findByText('legacy-user')).toBeInTheDocument()
    expect(localStorage.getItem('wes_recent_users')).toBeNull()
    expect(JSON.parse(localStorage.getItem('wes_username_history'))).toEqual(['legacy-user'])
    expect(localStorage.getItem('wes_username_history')).not.toContain('LegacyPassword123!')
  })

  test('focuses the password field after selecting a recent username', async () => {
    localStorage.setItem('wes_username_history', JSON.stringify(['recent-user']))

    renderAuthRoutes()

    fireEvent.focus(screen.getByLabelText('用户名'))
    fireEvent.click(await screen.findByText('recent-user'))

    await waitFor(() => {
      expect(screen.getByLabelText('密码')).toHaveFocus()
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

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Password123!' } })
    fireEvent.click(screen.getByLabelText('记住 7 天'))
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(requestBody).toEqual({ username: 'demo', password: 'Password123!', rememberMe: true })
      expect(localStorage.getItem('wes_token')).toBe('remembered-token')
      expect(sessionStorage.getItem('wes_token')).toBeNull()
    })
  })

  test('gives every credential field a persistent visible label', async () => {
    renderAuthRoutes()

    fireEvent.click(screen.getByRole('link', { name: /使用邀请码激活/ }))

    // 激活模式下四个字段的名称不能只靠 placeholder:输入后会消失,读屏也念不到
    for (const name of ['邮箱', '用户名', '密码', '邀请码']) {
      const field = screen.getByLabelText(name)
      expect(field).toBeInTheDocument()
      expect(field.labels?.length).toBeGreaterThan(0)
    }
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

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'demo' } })
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

  test('translates an expired reset link into readable text on the reset page', async () => {
    // 后端外层 message 一律是「参数错误」,可区分信息在 details[].reason 里。
    // 只读 message 会让拿着旧链接的人以为是自己密码填错了。
    server.use(
      http.post(`${BASE}/auth/password-reset/confirm`, () =>
        HttpResponse.json(
          { code: 40001, message: '参数错误', details: [{ field: 'token', reason: 'invalid_or_expired' }] },
          { status: 400 }
        )
      )
    )

    renderAuthRoutes(['/reset-password?token=expired-token'])
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123!' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'NewPass123!' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重置密码' }))

    const notice = await screen.findByText(/重置链接已失效或已过期/)
    expect(notice).toBeInTheDocument()
    expect(screen.queryByText('参数错误')).not.toBeInTheDocument()
  })

  test('lets the shared .input focus contract style credential fields', async () => {
    renderAuthRoutes()
    fireEvent.click(screen.getByRole('link', { name: /使用邀请码激活/ }))

    // 行内 border 的优先级高于 .input:focus{border-color:var(--brand)},
    // 一旦写在 style 上,聚焦蓝边框就永远不会出现。
    for (const id of ['login-email', 'login-username', 'login-password', 'login-invite']) {
      const field = document.getElementById(id)
      expect(field).toBeTruthy()
      expect(field.className).toContain('input')
      expect(field.style.border).toBe('')
      expect(field.style.borderColor).toBe('')
    }

    // 重置密码页是同一批认证表单,行内 border 同样会短路聚焦契约
    renderAuthRoutes(['/reset-password?token=t1'])
    for (const name of ['新密码', '确认新密码']) {
      const field = screen.getByLabelText(name)
      expect(field.className).toContain('input')
      expect(field.getAttribute('style')).toBeNull()
    }
  })
})
