import React, { useState, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import WorkspaceTabs from './WorkspaceTabs.jsx'
import { UnsavedChangesProvider } from '../../hooks/useUnsavedChanges.jsx'
import { BackgroundRunProvider, useBackgroundRuns } from '../../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../../hooks/useSessionRuntimeStore.js'
import useCurrentUser from '../../hooks/useCurrentUser.js'
import { clearToken, isAuthenticated } from '../../api/auth.js'
import { SYSTEM_MANAGEMENT_SECTIONS } from '../../config/systemManagementSections.js'
import { isAdminUser } from '../../utils/adminAccess.js'

const navGroups = [
  {
    title: '工作台',
    items: [
      { to: '/', label: 'AI 工作台', icon: '●' },
      { to: '/projects', label: '项目', icon: '▤' },
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
      {
        label: '系统管理',
        icon: '⚙',
        children: SYSTEM_MANAGEMENT_SECTIONS.map((section) => ({
          to: section.route,
          label: section.label,
          icon: section.icon,
        })),
      },
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

function ChevronIcon({ expanded }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="sidebar-nav-chevron"
      style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
      aria-hidden="true"
    >
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

/** 后台任务指示器 + aria-live 通知区（常驻 Shell 层，跨页面存活）。 */
function ShellBackgroundRuns() {
  const { activeCount, notifications, dismissNotification } = useBackgroundRuns()
  return (
    <div className="shell-background-runs">
      <div className="shell-background-runs-indicator">后台任务 {activeCount}</div>
      <div className="shell-background-runs-notifications" role="region" aria-label="后台任务通知" aria-live="polite">
        {notifications.map((item) => (
          <div key={item.id} className={`background-run-notification background-run-notification--${item.kind}`}>
            <span className="background-run-notification-text">{item.text}</span>
            <button
              type="button"
              className="background-run-notification-dismiss"
              aria-label={`关闭通知：${item.text}`}
              onClick={() => dismissNotification(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Shell({ children, currentUser = null }) {
  const [collapsed, setCollapsed] = useState(false)
  const [expandedParents, setExpandedParents] = useState(() => new Set(['系统管理']))
  const navigate = useNavigate()
  const { user: loadedUser } = useCurrentUser({ enabled: !currentUser && isAuthenticated() })
  const user = currentUser || loadedUser
  const username = user?.username || user?.name || 'mjlkevin'
  const userInitial = String(username).slice(0, 1).toUpperCase() || 'U'
  const roleText = user?.businessRoleLabel || (user?.role === 'admin' ? '超级管理员' : '未设置业务角色')
  const visibleNavGroups = navGroups.filter((group) => group.title !== '系统' || isAdminUser(user))

  const toggleParent = useCallback((label) => {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const handleLogout = () => {
    // G3/G4：登出清敏感运行缓存（cursor/草稿/活跃会话键），绝不触发 cancel
    sessionRuntimeStore.clearSensitiveRuntimeCache()
    clearToken()
    navigate('/login', { replace: true })
  }

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
        <nav aria-label="主导航">
          {visibleNavGroups.map((g) => (
            <div className="grp" key={g.title}>
              <h6>{g.title}</h6>
              {g.items.map((item) => {
                if (item.children) {
                  const isExpanded = expandedParents.has(item.label)
                  return (
                    <div className="sidebar-nav-parent" key={item.label}>
                      <button
                        type="button"
                        className={`sidebar-nav-parent-label${isExpanded ? ' sidebar-nav-parent-label--expanded' : ''}`}
                        title={collapsed ? item.label : undefined}
                        aria-expanded={isExpanded}
                        aria-controls={`nav-children-${item.label}`}
                        onClick={() => !collapsed && toggleParent(item.label)}
                      >
                        <span className="ic">{item.icon}</span>
                        {!collapsed && <span className="sidebar-nav-parent-text">{item.label}</span>}
                        {!collapsed && <ChevronIcon expanded={isExpanded} />}
                      </button>
                      {!collapsed && (
                        <div
                          id={`nav-children-${item.label}`}
                          className={`sidebar-nav-children${isExpanded ? ' sidebar-nav-children--open' : ' sidebar-nav-children--closed'}`}
                          role="group"
                          aria-label={item.label}
                        >
                          <div className="sidebar-nav-children-inner">
                            {item.children.map((child) => (
                              <NavLink
                                key={child.to}
                                to={child.to}
                                className={({ isActive }) => (isActive ? 'on' : '')}
                                tabIndex={isExpanded ? 0 : -1}
                              >
                                <span className="ic">{child.icon}</span>
                                {child.label}
                              </NavLink>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
                return (
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
                )
              })}
            </div>
          ))}
        </nav>
        <div className="user">
          <div className="row">
            <div className="av">{userInitial}</div>
            <div className="account">
              <div className="nm" title={username}>{username}</div>
              <div className="meta" title={roleText}>{roleText}</div>
            </div>
            {!collapsed && <button type="button" className="out" aria-label="退出登录" onClick={handleLogout}>退出</button>}
          </div>
        </div>
      </aside>
      <BackgroundRunProvider>
        <UnsavedChangesProvider>
          <main className="content" style={{ flex: 1, minWidth: 0 }}>
            <WorkspaceTabs />
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
              {children}
            </div>
          </main>
        </UnsavedChangesProvider>
        <ShellBackgroundRuns />
      </BackgroundRunProvider>
    </div>
  )
}
