import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import WorkspaceTabs from './WorkspaceTabs.jsx'
import { UnsavedChangesProvider } from '../../hooks/useUnsavedChanges.jsx'

const navGroups = [
  {
    title: '工作台',
    items: [
      { to: '/', label: '主页', icon: '●' },
      { to: '/requirements', label: '需求', icon: '✎' },
      { to: '/assessments', label: '实施评估', icon: '▣' },
      { to: '/dev-assessments', label: '开发评估', icon: '◆' },
      { to: '/resource-costs', label: '资源成本', icon: '$' },
      { to: '/wbs', label: 'WBS', icon: '☷' },
      { to: '/reviews', label: '评审', icon: '✓' },
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/system', label: '系统管理', icon: '⚙' },
      { to: '/users', label: '用户管理', icon: '☺' },
      { to: '/api-keys', label: 'API 密钥', icon: '⚿' },
    ],
  },
]

function ToggleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transition: 'transform .2s' }}>
      <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function Shell({ children }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="shell" style={{ gridTemplateColumns: collapsed ? '64px minmax(0,1fr)' : undefined }}>
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="brand">
          <div className="l">W</div>
          <div>WES</div>
          <button type="button"
            className="toggle-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? '展开' : '收起'}
          >
            <ToggleIcon />
          </button>
        </div>
        {navGroups.map((g) => (
          <div className="grp" key={g.title}>
            <h6>{g.title}</h6>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'on' : '')}
                end={item.to === '/'}
                title={collapsed ? item.label : undefined}
              >
                <span className="ic">{item.icon}</span>
                {!collapsed && item.label}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="user">
          <div className="row">
            <div className="av">M</div>
            <div className="account">
              <div className="nm">mjlkevin</div>
              <div className="meta">超级管理员</div>
            </div>
            {!collapsed && <a className="out" href="/login" aria-label="退出登录">退出</a>}
          </div>
        </div>
      </aside>
      <UnsavedChangesProvider>
        <main className="content" style={{ flex: 1, minWidth: 0 }}>
          <WorkspaceTabs />
          {children}
        </main>
      </UnsavedChangesProvider>
    </div>
  )
}
