import { render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import WorkspaceTabs from '../components/Layout/WorkspaceTabs.jsx'
import { DEFAULT_SYSTEM_MANAGEMENT_ROUTE } from '../config/systemManagementSections.js'

const STORAGE_KEY = 'wes-v2-workspace-tabs-v1'

// 布局路由在子路由重定向期间保持挂载，所以 WorkspaceTabs 会先看到 /system、
// 再看到 /system/code-rules，两个都记进页签。父页签是个永远停不住的僵尸：
// 点它 = 立刻被 <Navigate replace> 弹回子页签，条上却常年多占一格。
function Layout() {
  return (
    <>
      <WorkspaceTabs />
      <Outlet />
    </>
  )
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/system" element={<Navigate to={DEFAULT_SYSTEM_MANAGEMENT_ROUTE} replace />} />
          <Route path={DEFAULT_SYSTEM_MANAGEMENT_ROUTE} element={<div data-testid="page" />} />
          <Route path="/" element={<div data-testid="home" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('WorkspaceTabs 页签去重', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('经过只做跳转的父路由时，页签条只留重定向目标一格', async () => {
    renderAt('/system')

    const tabs = await screen.findAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toHaveTextContent('编码规则')
    expect(screen.queryByRole('tab', { name: /系统管理/ })).not.toBeInTheDocument()
  })

  test('上一次会话留下的父路由页签不会带着僵尸回来', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { path: '/system', title: '系统管理' },
      { path: DEFAULT_SYSTEM_MANAGEMENT_ROUTE, title: '编码规则' },
    ]))

    renderAt(DEFAULT_SYSTEM_MANAGEMENT_ROUTE)

    const tabs = await screen.findAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toHaveTextContent('编码规则')
  })
})
