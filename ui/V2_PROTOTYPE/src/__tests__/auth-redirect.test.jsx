import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import Login from '../pages/Login.jsx'
import { apiClient } from '../api/client.js'
import {
  buildLoginUrl,
  goToLogin,
  isSafeInternalRedirect,
  navigateAfterLogin,
  resolvePostLoginRedirect,
} from '../utils/authRedirect.js'
import { server } from './mocks/server.js'

// 只接缝掉两个落地动作，解析与安全校验仍走真实实现。
vi.mock('../utils/authRedirect.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, navigateAfterLogin: vi.fn(), goToLogin: vi.fn() }
})

const BASE = '/api/v1'

function loginOk() {
  server.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({
    code: 0,
    message: 'ok',
    data: {
      token: 'short-token',
      user: { id: 'u1', username: 'demo', role: 'user', status: 'active' },
      rememberMe: false,
      expiresIn: '8h',
    },
  })))
}

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function submit() {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'demo' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Password123!' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
}

describe('authRedirect 回跳目标解析', () => {
  test('读取 ProtectedLayout 写入的 location.state.from，并保留 query 与 hash', () => {
    const target = resolvePostLoginRedirect({
      state: { from: { pathname: '/requirements', search: '?tab=open', hash: '#r1' } },
      search: '',
    })
    expect(target).toBe('/requirements?tab=open#r1')
  })

  test('无回跳目标时落回首页', () => {
    expect(resolvePostLoginRedirect({ state: null, search: '' })).toBe('/')
  })

  test('只接受同源相对路径，拒绝开放重定向', () => {
    expect(isSafeInternalRedirect('https://evil.example/x')).toBe(false)
    expect(isSafeInternalRedirect('//evil.example/x')).toBe(false)
    expect(isSafeInternalRedirect('/\\evil.example')).toBe(false)
    expect(isSafeInternalRedirect('requirements')).toBe(false)
    expect(isSafeInternalRedirect('/requirements')).toBe(true)
  })

  test('回跳目标指向认证页自身时忽略，避免登录后死循环', () => {
    expect(resolvePostLoginRedirect({ state: { from: { pathname: '/login' } }, search: '' })).toBe('/')
    expect(resolvePostLoginRedirect({ state: { from: { pathname: '/reset-password' } }, search: '' })).toBe('/')
  })

  test('支持 401 拦截器写入的 ?from= 兜底通道，且优先级低于 state', () => {
    expect(resolvePostLoginRedirect({ state: null, search: '?from=%2Fusers' })).toBe('/users')
    const both = resolvePostLoginRedirect({
      state: { from: { pathname: '/requirements' } },
      search: '?from=%2Fusers',
    })
    expect(both).toBe('/requirements')
  })

  test('?from= 指向外站时不采信', () => {
    expect(resolvePostLoginRedirect({ state: null, search: '?from=https%3A%2F%2Fevil.example' })).toBe('/')
  })
})

describe('buildLoginUrl 401 兜底通道', () => {
  test('把当前地址（含 query 与 hash）编码后交给登录页', () => {
    expect(buildLoginUrl('/users?tab=on#line')).toBe('/login?from=%2Fusers%3Ftab%3Don%23line')
  })

  test('拿不到原始地址时只去登录页', () => {
    expect(buildLoginUrl('')).toBe('/login')
    expect(buildLoginUrl('//evil.example')).toBe('/login')
  })
})

describe('登录成功后回跳原页面', () => {
  beforeEach(() => {
    navigateAfterLogin.mockClear()
  })

  test('带 from 状态时落到该页面，而不是首页', async () => {
    loginOk()
    renderLogin({ pathname: '/login', state: { from: { pathname: '/requirements', search: '', hash: '' } } })
    await submit()

    await waitFor(() => expect(navigateAfterLogin).toHaveBeenCalledWith('/requirements'))
  })

  test('直接访问登录页时仍落首页', async () => {
    loginOk()
    renderLogin()
    await submit()

    await waitFor(() => expect(navigateAfterLogin).toHaveBeenCalledWith('/'))
  })
})

describe('401 拦截器交出当前页', () => {
  beforeEach(() => {
    goToLogin.mockClear()
  })

  test('会话过期跳登录页时带上 ?from=，不丢掉用户原本要的页面', async () => {
    server.use(http.get(`${BASE}/projects`, () => HttpResponse.json({ code: 401 }, { status: 401 })))

    await expect(apiClient.get('/projects')).rejects.toThrow('登录已过期')
    expect(goToLogin).toHaveBeenCalledWith('/')
  })

  test('登录页自身发的请求不再交接出地址，避免自跳', async () => {
    server.use(http.get(`${BASE}/auth/profile`, () => HttpResponse.json({ code: 401 }, { status: 401 })))

    await expect(apiClient.get('/auth/profile', null, { suppressUnauthorizedRedirect: true })).rejects.toThrow('登录已过期')
    expect(goToLogin).not.toHaveBeenCalled()
  })
})
