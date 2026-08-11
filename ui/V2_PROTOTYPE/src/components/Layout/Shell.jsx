import React, { useState, useCallback, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import WorkspaceTabs from './WorkspaceTabs.jsx'
import { UnsavedChangesProvider } from '../../hooks/useUnsavedChanges.jsx'
import { BackgroundRunProvider, useBackgroundRuns } from '../../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../../hooks/useSessionRuntimeStore.js'
import { primeStoredActiveSessionId } from '../../hooks/useAiSessions.js'
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

/** RP-058：completed 通知 5s 自动消失（failed/cancelled 保留手动关闭，避免错误被错过）。 */
const COMPLETED_AUTO_DISMISS_MS = 5000

const RUN_STATUS_LABEL = {
  running: '进行中',
  queued: '排队中',
  waiting: '等待中',
  cancelling: '取消中',
}

/** 单条后台任务通知：completed 类挂自动消失定时器，可跳转的文本渲染为按钮。 */
function BackgroundRunNotification({ item, onDismiss, onOpen }) {
  useEffect(() => {
    if (item.kind !== 'completed') return undefined
    const timer = setTimeout(() => onDismiss(item.id), COMPLETED_AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [item.id, item.kind, onDismiss])

  const canOpen = item.kind === 'completed' && Boolean(item.sessionId)
  return (
    <div className={`background-run-notification background-run-notification--${item.kind}`}>
      {canOpen ? (
        <button
          type="button"
          className="background-run-notification-text"
          aria-label={`查看会话：${item.text}`}
          title="点击查看对应会话"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
          onClick={() => onOpen(item)}
        >
          {item.text}
        </button>
      ) : (
        <span className="background-run-notification-text">{item.text}</span>
      )}
      <button
        type="button"
        className="background-run-notification-dismiss"
        aria-label={`关闭通知：${item.text}`}
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </div>
  )
}

/** 后台任务指示器 + 清单气泡 + aria-live 通知区（常驻 Shell 层，跨页面存活）。 */
function ShellBackgroundRuns() {
  const { runs, activeCount, notifications, dismissNotification } = useBackgroundRuns()
  const [listOpen, setListOpen] = useState(false)
  const containerRef = useRef(null)
  const navigate = useNavigate()

  // RP-058：气泡失焦消失——点击控件外任意处或按 Esc 关闭
  useEffect(() => {
    if (!listOpen) return undefined
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setListOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setListOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [listOpen])

  // RP-058：点击已完成通知 → 预置活跃会话 + 清未读（已完成未读徽标即消）+ 跳转会话
  const handleOpenSession = useCallback((item) => {
    if (!item.sessionId) return
    primeStoredActiveSessionId(item.sessionId)
    sessionRuntimeStore.markSessionUnread(item.sessionId, false)
    dismissNotification(item.id)
    navigate('/')
  }, [dismissNotification, navigate])

  return (
    <div className="shell-background-runs" ref={containerRef}>
      <button
        type="button"
        className="shell-background-runs-indicator"
        aria-expanded={listOpen}
        aria-label={`后台任务 ${activeCount}`}
        style={{ cursor: 'pointer', fontFamily: 'inherit' }}
        onClick={() => setListOpen((open) => !open)}
      >
        后台任务 {activeCount}
      </button>
      {listOpen ? (
        <div
          role="dialog"
          aria-label="后台任务清单"
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 8,
            minWidth: 260,
            maxWidth: 340,
            background: 'var(--surface-elevated)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-2)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
            后台任务（{activeCount}）
          </div>
          {runs.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {runs.map((run) => (
                <li key={run.runId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
                  <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.title || run.runId}</span>
                  <span className="tag brd">{RUN_STATUS_LABEL[run.status] || run.status || '进行中'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '6px 0' }}>暂无进行中的后台任务</div>
          )}
        </div>
      ) : null}
      <div className="shell-background-runs-notifications" role="region" aria-label="后台任务通知" aria-live="polite">
        {notifications.map((item) => (
          <BackgroundRunNotification key={item.id} item={item} onDismiss={dismissNotification} onOpen={handleOpenSession} />
        ))}
      </div>
    </div>
  )
}

export default function Shell({ children, currentUser = null }) {
  const [collapsed, setCollapsed] = useState(false)
  const [expandedParents, setExpandedParents] = useState(() => new Set([]))
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
