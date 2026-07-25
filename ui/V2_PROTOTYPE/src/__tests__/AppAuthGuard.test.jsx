import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import App from '../App.jsx'

function makeJwt(payload) {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `test.${encodedPayload}.signature`
}

describe('App auth guard', () => {
  test('redirects protected routes to login when the stored JWT is expired', async () => {
    localStorage.setItem('wes_token', makeJwt({ exp: 1 }))

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI 工作台' })).not.toBeInTheDocument()
  })

  test('redirects business users away from admin routes', async () => {
    render(
      <MemoryRouter initialEntries={['/users']}>
        <App />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'AI 工作台' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '用户管理' })).not.toBeInTheDocument()
  })
})
