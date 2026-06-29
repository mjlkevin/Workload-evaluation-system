import React, { useState, useMemo, useCallback, useEffect } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import useUsers, { BUSINESS_ROLES, businessRoleLabel } from '../hooks/useUsers.js'
import useRoleCapabilities from '../hooks/useRoleCapabilities.js'
import { apiClient } from '../api/client.js'

const INITIAL_USERS = [
  { id: 'u1', username: 'mjlkevin', role: 'admin', status: 'active', lastLoginAt: '2026-05-09T14:28:00Z', locked: false },
  { id: 'u2', username: 'admin', role: 'sub_admin', status: 'active', lastLoginAt: '2026-05-08T09:15:00Z', locked: true },
  { id: 'u3', username: 'zhangpeng', role: 'user', status: 'active', lastLoginAt: '2026-05-07T18:40:00Z', locked: false },
  { id: 'u4', username: 'wangmin', role: 'user', status: 'disabled', lastLoginAt: null, locked: false },
  { id: 'u5', username: 'lichen', role: 'user', status: 'active', lastLoginAt: '2026-05-06T10:20:00Z', locked: false },
]

const ROLES = [
  { key: 'admin', label: '超级管理员' },
  { key: 'sub_admin', label: '管理员' },
  { key: 'user', label: '普通用户' },
]

export default function UserManagement() {
  const { users: loadedUsers } = useUsers({ fallbackData: INITIAL_USERS })
  const {
    legacyMapping,
    capabilityLabels,
    loading: roleCapsLoading,
    error: roleCapsError,
  } = useRoleCapabilities()
  const [showRoleCaps, setShowRoleCaps] = useState(false)
  const [users, setUsers] = useState(loadedUsers)
  const [selected, setSelected] = useState(new Set())
  const [anchorId, setAnchorId] = useState(null)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(null) // 'systemRole' | 'businessRole' | 'password' | 'demote' | null
  const [pendingRole, setPendingRole] = useState('')
  const [pendingBusinessRole, setPendingBusinessRole] = useState('')
  const [passwordForm, setPasswordForm] = useState({ password: '', confirm: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [demoteConfirm, setDemoteConfirm] = useState('')

  useEffect(() => {
    setUsers(loadedUsers)
    setSelected(new Set())
    setAnchorId(null)
  }, [loadedUsers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      u.username.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    )
  }, [users, search])

  const visibleIds = useMemo(() => filtered.map((u) => u.id), [filtered])

  // ---------- PB-R1 标准行选择 ----------
  const handleRowClick = useCallback(
    (e, row, idx) => {
      if (row.locked) return
      const id = row.id
      if (e.shiftKey && anchorId !== null && visibleIds.includes(anchorId)) {
        const a = visibleIds.indexOf(anchorId)
        const b = idx
        const [s, t] = a <= b ? [a, b] : [b, a]
        const next = new Set()
        for (let i = s; i <= t; i++) next.add(visibleIds[i])
        setSelected(next)
      } else if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        setAnchorId(id)
      } else {
        setSelected(new Set([id]))
        setAnchorId(id)
      }
    },
    [visibleIds, anchorId]
  )

  const toggleOne = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchorId(id)
  }, [])

  const clearSelection = () => {
    setSelected(new Set())
    setAnchorId(null)
  }

  const selCount = selected.size
  const selectedRows = useMemo(
    () => filtered.filter((u) => selected.has(u.id)),
    [filtered, selected]
  )

  // ---------- 批量操作 ----------
  const applyStatus = (status) => {
    setUsers((prev) =>
      prev.map((u) => (selected.has(u.id) ? { ...u, status } : u))
    )
  }

  const openSystemRoleDialog = () => {
    if (selCount === 0) return
    setPendingRole('user')
    setDialog('systemRole')
  }

  const openBusinessRoleDialog = () => {
    if (selCount === 0) return
    setPendingBusinessRole(selectedRows[0]?.businessRole || 'pre_sales')
    setDialog('businessRole')
  }

  const openPasswordDialog = () => {
    if (selectedRows.length !== 1) return
    setPasswordForm({ password: '', confirm: '' })
    setPasswordMessage('')
    setDialog('password')
  }

  const confirmRole = () => {
    const targetRole = pendingRole
    const hasAdmin = selectedRows.some((u) => u.role === 'admin')
    if (hasAdmin && targetRole !== 'admin') {
      setDialog('demote')
      return
    }
    applyRole(targetRole)
  }

  const applyRole = (targetRole) => {
    setUsers((prev) =>
      prev.map((u) => (selected.has(u.id) ? { ...u, role: targetRole } : u))
    )
    setDialog(null)
    setPendingRole('')
    setDemoteConfirm('')
  }

  const applyBusinessRole = async () => {
    const targetRole = pendingBusinessRole
    const ids = Array.from(selected)
    try {
      for (const id of ids) {
        await apiClient.patch(`/auth/users/${id}/business-role`, { businessRole: targetRole })
      }
      setUsers((prev) => prev.map((u) => selected.has(u.id)
        ? { ...u, businessRole: targetRole, businessRoleLabel: businessRoleLabel(targetRole) }
        : u
      ))
      setDialog(null)
      setPendingBusinessRole('')
    } catch (err) {
      alert(err?.message || '修改业务角色失败')
    }
  }

  const applyPasswordReset = async () => {
    const target = selectedRows[0]
    const password = passwordForm.password.trim()
    if (!target) return
    if (password.length < 8) {
      setPasswordMessage('密码至少 8 位')
      return
    }
    if (password !== passwordForm.confirm.trim()) {
      setPasswordMessage('两次输入的密码不一致')
      return
    }

    setPasswordSubmitting(true)
    setPasswordMessage('')
    try {
      await apiClient.patch(`/auth/users/${target.id}/password`, { password })
      setPasswordForm({ password: '', confirm: '' })
      setDialog(null)
    } catch (err) {
      setPasswordMessage(err?.message || '重置密码失败')
    } finally {
      setPasswordSubmitting(false)
    }
  }

  const confirmDemote = () => {
    if (demoteConfirm.trim() !== '我确定') {
      alert('请输入“我确定”以确认降级操作')
      return
    }
    applyRole(pendingRole)
  }

  // ---------- 辅助 ----------
  function roleLabel(r) {
    const map = { admin: '超级管理员', sub_admin: '管理员', user: '普通用户' }
    return map[r] || r
  }

  function fmtRoleChip(r) {
    const isSa = r === 'admin'
    if (isSa)
      return (
        <span className="bdg" style={{ background: 'var(--ink)', color: '#fff', fontSize: 10.5, padding: '1px 7px' }}>
          <span className="dot" style={{ background: 'var(--accent)' }} />
          {roleLabel(r)}
        </span>
      )
    const cls = r === 'sub_admin' ? 'brd' : r === 'user' ? 'draft' : 'ok'
    return (
      <span className={`bdg ${cls}`} style={{ fontSize: 10.5, padding: '1px 7px' }}>
        <span className="dot" />
        {roleLabel(r)}
      </span>
    )
  }

  function fmtStatus(s) {
    return s === 'active' ? (
      <span className="bdg ok" style={{ fontSize: 10.5, padding: '1px 7px' }}>
        <span className="dot" />正常
      </span>
    ) : (
      <span className="bdg draft" style={{ fontSize: 10.5, padding: '1px 7px' }}>
        <span className="dot" />已禁用
      </span>
    )
  }

  const canBulkEnable = selectedRows.length > 0 && selectedRows.some((u) => u.status !== 'active')
  const canBulkDisable = selectedRows.length > 0 && selectedRows.some((u) => u.status !== 'disabled')
  const canChangeRole = selectedRows.length > 0
  const canResetPassword = selectedRows.length === 1

  return (
    <PageShell
      crumb="工作台 / 用户管理"
      title="用户管理"
      subtitle="用户、角色与状态管理"
      actions={[]}
    >
      <div className="section" style={{ margin: 0 }}>
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '10px 18px',
            background: 'var(--bg-soft)',
            borderBottom: '1px solid var(--line)',
            fontSize: 12,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: selCount > 0 ? 'var(--brand-ink)' : 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              fontWeight: 700,
              cursor: selCount > 0 ? 'pointer' : 'default',
            }}
            onClick={selCount > 0 ? clearSelection : undefined}
          >
            已选 {selCount}
          </span>

          <div style={{ display: 'flex', gap: 4, paddingRight: 12, borderRight: '1px solid var(--line)' }}>
            <button type="button"
              className="btn btn-ghost"
              style={{ height: 28, fontSize: 12, padding: '0 10px' }}
              disabled={!canBulkEnable}
              onClick={() => applyStatus('active')}
            >
              批量启用
            </button>
            <button type="button"
              className="btn btn-ghost"
              style={{ height: 28, fontSize: 12, padding: '0 10px', color: 'var(--err)' }}
              disabled={!canBulkDisable}
              onClick={() => applyStatus('disabled')}
            >
              批量禁用
            </button>
            <button type="button"
              className="btn btn-ghost"
              style={{ height: 28, fontSize: 12, padding: '0 10px' }}
              disabled={!canChangeRole}
              onClick={openSystemRoleDialog}
            >
              改系统角色
            </button>
            <button type="button"
              className="btn btn-ghost"
              style={{ height: 28, fontSize: 12, padding: '0 10px' }}
              disabled={!canChangeRole}
              onClick={openBusinessRoleDialog}
            >
              改业务角色
            </button>
            <button type="button"
              className="btn btn-ghost"
              style={{ height: 28, fontSize: 12, padding: '0 10px' }}
              disabled={!canResetPassword}
              onClick={openPasswordDialog}
            >
              重置密码
            </button>
            <button type="button" className="btn btn-pri" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>
              + 邀请成员
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 5,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                fontSize: 11.5,
                color: 'var(--ink-2)',
              }}
            >
              系统角色：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>全部</b>
              <span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span>
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 5,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                fontSize: 11.5,
                color: 'var(--ink-2)',
              }}
            >
              状态：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>全部</b>
              <span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span>
            </span>
            <input
              type="text"
              placeholder="⌕ 搜索用户名 / 邮箱"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: '#fff',
                border: '1px solid var(--line)',
                fontSize: 11.5,
                color: 'var(--ink)',
                width: 220,
                flexShrink: 0,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Table */}
        <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((u) => selected.has(u.id) || u.locked)}
                  onChange={(e) => {
                    const next = new Set(selected)
                    const selectable = filtered.filter((u) => !u.locked)
                    if (e.target.checked) {
                      selectable.forEach((u) => next.add(u.id))
                    } else {
                      selectable.forEach((u) => next.delete(u.id))
                    }
                    setSelected(next)
                  }}
                />
              </th>
              <th>用户</th>
              <th>系统角色</th>
              <th>业务角色</th>
              <th>状态</th>
              <th>最后登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, idx) => {
              const isSel = selected.has(u.id)
              return (
                <tr
                  key={u.id}
                  onClick={(e) => handleRowClick(e, u, idx)}
                  style={{
                    cursor: u.locked ? 'default' : 'pointer',
                    background: isSel ? 'var(--brand-soft)' : undefined,
                    userSelect: 'none',
                  }}
                >
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    {u.locked ? (
                      <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>—</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleOne(u.id)}
                      />
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: 'var(--brand-soft)',
                          color: 'var(--brand-ink)',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {u.username.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{u.username}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                          {u.email || `${u.username}@wes.local`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{fmtRoleChip(u.role)}</td>
                  <td><span className="bdg brd" style={{ fontSize: 10.5, padding: '1px 7px' }}><span className="dot" />{u.businessRoleLabel || businessRoleLabel(u.businessRole)}</span></td>
                  <td>{fmtStatus(u.status)}</td>
                  <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {u.lastLoginAt ? u.lastLoginAt.replace('T', ' ').replace('Z', '') : '—'}
                  </td>
                  <td>
                    {u.locked ? (
                      <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>— 系统账号 —</span>
                    ) : (
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px', height: 28 }}>
                        编辑
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* RP-026: 角色能力矩阵（可折叠） */}
      <div className="section" style={{ marginTop: 12 }}>
        <button
          type="button"
          aria-expanded={showRoleCaps}
          aria-controls="role-capability-panel"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            background: 'var(--bg-soft)',
            border: 0,
            borderBottom: '1px solid var(--line)',
            cursor: 'pointer',
            fontSize: 12,
            textAlign: 'left',
          }}
          onClick={() => setShowRoleCaps((v) => !v)}
        >
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>角色能力矩阵</span>
          {roleCapsLoading && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>加载中…</span>}
          {roleCapsError && <span style={{ color: 'var(--err)', fontSize: 11 }}>加载失败</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 11 }}>{showRoleCaps ? '▾ 收起' : '▸ 展开'}</span>
        </button>
        {showRoleCaps && !roleCapsLoading && !roleCapsError && legacyMapping.length > 0 && (
          <div id="role-capability-panel" style={{ padding: '12px 18px', display: 'grid', gap: 10 }}>
            {legacyMapping.map((item) => (
              <div key={item.legacyRole} style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>
                  {item.label}
                  <span style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 6, fontSize: 11 }}>
                    {item.legacyRole}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(item.v2Roles || []).map((v2Role) => (
                    <span
                      key={v2Role}
                      className="bdg brd"
                      style={{ fontSize: 10.5, padding: '1px 6px' }}
                    >
                      {v2Role}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(capabilityLabels).length > 0 && (
              <details style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--ink-3)', marginBottom: 4 }}>
                  能力位说明（{Object.keys(capabilityLabels).length} 项）
                </summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '2px 12px' }}>
                  {Object.entries(capabilityLabels).map(([key, label]) => (
                    <div key={key} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                      <span style={{ color: 'var(--ink)' }}>{label}</span>
                      <span style={{ color: 'var(--ink-3)', marginLeft: 4 }}>{key}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        {showRoleCaps && roleCapsError && (
          <div id="role-capability-panel" style={{ padding: '12px 18px', fontSize: 12, color: 'var(--err)' }}>
            角色能力矩阵加载失败，请稍后重试
          </div>
        )}
      </div>

      {/* 改系统角色 dialog */}
      {dialog === 'systemRole' && (
        <DialogBackdrop onClose={() => setDialog(null)}>
          <DialogCard title="修改系统角色" subtitle={`已选 ${selCount} 人`}>
            <div style={{ display: 'grid', gap: 8 }}>
              {ROLES.map((r) => (
                <label
                  key={r.key}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '10px 12px',
                    border: `1px solid ${pendingRole === r.key ? 'var(--brand)' : 'var(--line)'}`,
                    borderRadius: 10,
                    background: pendingRole === r.key ? 'var(--brand-soft)' : 'var(--bg-soft)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.key}
                    checked={pendingRole === r.key}
                    onChange={() => setPendingRole(r.key)}
                    style={{ marginTop: 4 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                  </div>
                </label>
              ))}
            </div>
            <DialogActions>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
                取消
              </button>
              <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={confirmRole}>
                确认修改
              </button>
            </DialogActions>
          </DialogCard>
        </DialogBackdrop>
      )}

      {/* 改业务角色 dialog */}
      {dialog === 'businessRole' && (
        <DialogBackdrop onClose={() => setDialog(null)}>
          <DialogCard title="修改业务角色" subtitle={`已选 ${selCount} 人`}>
            <div style={{ display: 'grid', gap: 8 }}>
              {BUSINESS_ROLES.map((r) => (
                <label
                  key={r.key}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '10px 12px',
                    border: `1px solid ${pendingBusinessRole === r.key ? 'var(--brand)' : 'var(--line)'}`,
                    borderRadius: 10,
                    background: pendingBusinessRole === r.key ? 'var(--brand-soft)' : 'var(--bg-soft)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="businessRole"
                    value={r.key}
                    checked={pendingBusinessRole === r.key}
                    onChange={() => setPendingBusinessRole(r.key)}
                    style={{ marginTop: 4 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>用于首页 AI 工作台提示词与工作流分流</div>
                  </div>
                </label>
              ))}
            </div>
            <DialogActions>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
                取消
              </button>
              <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={applyBusinessRole}>
                确认修改
              </button>
            </DialogActions>
          </DialogCard>
        </DialogBackdrop>
      )}

      {/* 重置密码 dialog */}
      {dialog === 'password' && (
        <DialogBackdrop onClose={() => setDialog(null)}>
          <DialogCard title="重置登录密码" subtitle={selectedRows[0]?.username || ''}>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
                新密码
                <input
                  type="password"
                  value={passwordForm.password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, password: e.target.value }))}
                  autoComplete="new-password"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
                确认密码
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm: e.target.value }))}
                  autoComplete="new-password"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </label>
              {passwordMessage && (
                <div
                  role="status"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--r-md)',
                    background: passwordMessage === '密码已重置' ? 'var(--ok-soft)' : 'var(--err-soft)',
                    color: passwordMessage === '密码已重置' ? 'var(--ok)' : 'var(--err)',
                    fontSize: 12,
                  }}
                >
                  {passwordMessage}
                </div>
              )}
            </div>
            <DialogActions>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
                取消
              </button>
              <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} disabled={passwordSubmitting} onClick={applyPasswordReset}>
                {passwordSubmitting ? '重置中…' : '确认重置'}
              </button>
            </DialogActions>
          </DialogCard>
        </DialogBackdrop>
      )}

      {/* 降权保护 dialog */}
      {dialog === 'demote' && (
        <DialogBackdrop onClose={() => setDialog(null)}>
          <DialogCard title="⚠ 降权保护确认" subtitle="超级管理员降级为高风险操作">
            <div
              style={{
                background: 'var(--err-soft)',
                border: '1px solid var(--err)',
                borderRadius: 'var(--r-md)',
                padding: '12px 14px',
                marginBottom: 12,
                fontSize: 13,
                color: 'var(--err)',
              }}
            >
              你正在将超级管理员降级为较低权限角色。该操作不可逆，可能导致系统管理权限丢失。
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-2)' }}>
              请在下方输入「我确定」以继续：
            </p>
            <input
              type="text"
              value={demoteConfirm}
              onChange={(e) => setDemoteConfirm(e.target.value)}
              placeholder="我确定"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <DialogActions>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
                取消
              </button>
              <button type="button" className="btn btn-dan" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={confirmDemote}>
                确认降级
              </button>
            </DialogActions>
          </DialogCard>
        </DialogBackdrop>
      )}
    </PageShell>
  )
}

// ---- inline Dialog primitives ----
function DialogBackdrop({ children, onClose }) {
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.42)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        zIndex: 50,
      }}
    >
      {children}
    </div>
  )
}

function DialogCard({ title, subtitle, children }) {
  return (
    <div
      style={{
        width: 'min(480px, 100%)',
        background: '#fff',
        borderRadius: 'var(--r-lg)',
        boxShadow: '0 24px 64px rgba(15,23,42,0.24)',
        border: '1px solid var(--line)',
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {subtitle && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function DialogActions({ children }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>{children}</div>
}
