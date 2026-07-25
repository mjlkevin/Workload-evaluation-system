import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import Shell from '../components/Layout/Shell.jsx'
import '../index.css'

const layoutCss = readFileSync(join(process.cwd(), 'layout.css'), 'utf-8')

function renderShell() {
  return render(
    <MemoryRouter>
      <Shell>
        <div>content</div>
        <LocationProbe />
      </Shell>
    </MemoryRouter>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="current-route">{location.pathname}</div>
}

describe('Shell user menu', () => {
  test('logs out through SPA navigation without a document reload', async () => {
    renderShell()

    await screen.findByText('arch')
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    expect(screen.getByTestId('current-route')).toHaveTextContent('/login')
  })

  test('keeps logout beside the current user instead of stretching to a full-width row', async () => {
    renderShell()

    await screen.findByText('arch')
    const logout = screen.getByRole('button', { name: '退出登录' })

    expect(logout).toHaveClass('out')
    expect(layoutCss).toMatch(/\.sidebar \.user \.out\{[^}]*width:auto/)
    expect(layoutCss).toMatch(/\.sidebar \.user \.out\{[^}]*align-self:center/)
  })

  test('hides admin-only navigation for business users', async () => {
    renderShell()

    await screen.findByText('arch')
    const navigation = screen.getByRole('navigation', { name: '主导航' })

    expect(navigation).not.toHaveTextContent('系统管理')
    expect(navigation).not.toHaveTextContent('用户管理')
    expect(navigation).not.toHaveTextContent('API 密钥')
    expect(screen.queryByText('系统')).not.toBeInTheDocument()
  })
})
