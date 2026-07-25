import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import UserEditorDrawer from '../components/UserManagement/UserEditorDrawer.jsx'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
import useUsers, { BUSINESS_ROLES, businessRoleLabel } from '../hooks/useUsers.js'
import useRoleCapabilities from '../hooks/useRoleCapabilities.js'
import {
  resetUserPassword,
  updateUserBusinessRole,
  updateUserRole,
  updateUserStatus,
} from '../api/users.js'

const ROLES = [
  { key: 'admin', label: '超级管理员' },
  { key: 'sub_admin', label: '管理员' },
  { key: 'user', label: '普通用户' },
]

function collectUserChanges(original, draft) {
  const changes = {}
  if (draft.businessRole !== original.businessRole) changes.businessRole = draft.businessRole
  if (draft.role !== original.role) changes.role = draft.role
  if (draft.status !== original.status) changes.status = draft.status
  return changes
}

function needsRiskConfirmation(original, draft) {
  return (original.role === 'admin' && draft.role !== 'admin')
    || (original.status === 'active' && draft.status === 'disabled')
}

function systemRoleLabel(role) {
  return ROLES.find((item) => item.key === role)?.label || role
}

function statusLabel(status) {
  return status === 'active' ? '正常' : status === 'disabled' ? '已禁用' : status
}

function requiresTypedRiskPhrase(pendingSave) {
  return Boolean(
    pendingSave
    && pendingSave.original.role === 'admin'
    && pendingSave.draft.role !== 'admin'
  )
}

export function RiskConfirmationDialog({
  open,
  pendingSave,
  riskPhrase,
  onPhraseChange,
  onCancel,
  onConfirm,
}) {
  const requiresTypedPhrase = requiresTypedRiskPhrase(pendingSave)
  const transitions = []
  if (pendingSave && Object.hasOwn(pendingSave.changes, 'role')) {
    transitions.push(
      `${systemRoleLabel(pendingSave.original.role)} → ${systemRoleLabel(pendingSave.draft.role)}`
    )
  }
  if (pendingSave && Object.hasOwn(pendingSave.changes, 'status')) {
    transitions.push(
      `${statusLabel(pendingSave.original.status)} → ${statusLabel(pendingSave.draft.status)}`
    )
  }

  return (
    <Dialog
      open={open}
      title="确认风险变更"
      description={pendingSave?.original.username}
      closeOnBackdrop={false}
      onClose={onCancel}
    >
      <div
        style={{
          background: 'var(--err-soft)',
          border: '1px solid var(--err)',
          borderRadius: 'var(--r-md)',
          padding: '12px 14px',
          color: 'var(--err-ink)',
          fontSize: 13,
        }}
      >
        此变更可能影响用户登录或管理权限，请确认目标与变更内容。
      </div>
      <ul style={{ margin: '12px 0 0', paddingLeft: 20, fontSize: 13 }}>
        {transitions.map((transition) => (
          <li key={transition}>{transition}</li>
        ))}
      </ul>
      {requiresTypedPhrase ? (
        <label style={{ display: 'grid', gap: 6, marginTop: 14, fontSize: 13 }}>
          <span>输入“我确定”</span>
          <input
            className="input"
            type="text"
            value={riskPhrase}
            onChange={(event) => onPhraseChange(event.target.value)}
          />
        </label>
      ) : null}
      <DialogActions>
        <button type="button" className="btn btn-out" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-dan"
          disabled={requiresTypedPhrase && riskPhrase.trim() !== '我确定'}
          onClick={onConfirm}
        >
          确认风险变更
        </button>
      </DialogActions>
    </Dialog>
  )
}

export default function UserManagement() {
  const { users: loadedUsers, reload } = useUsers()
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
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingUserId, setEditingUserId] = useState(null)
  const [editingUserSnapshot, setEditingUserSnapshot] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [pendingRole, setPendingRole] = useState('')
  const [pendingBusinessRole, setPendingBusinessRole] = useState('')
  const [demoteConfirm, setDemoteConfirm] = useState('')
  const [riskPhrase, setRiskPhrase] = useState('')
  const [savingUserId, setSavingUserId] = useState(null)
  const [reloadingEditor, setReloadingEditor] = useState(false)
  const [editorMessage, setEditorMessage] = useState(null)
  const [pendingSave, setPendingSave] = useState(null)
  const [passwordForm, setPasswordForm] = useState({ password: '', confirm: '' })
  const [passwordMessage, setPasswordMessage] = useState(null)
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [pageNotice, setPageNotice] = useState(null)
  const editorOperationRef = useRef(0)
  const passwordOperationRef = useRef(0)
  const currentEditingUserIdRef = useRef(null)
  const saveSequenceRef = useRef(null)

  useEffect(() => {
    setUsers(loadedUsers)
    setSelected(new Set())
    setAnchorId(null)
  }, [loadedUsers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((user) => {
      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      const matchesStatus = statusFilter === 'all' || user.status === statusFilter
      const matchesSearch = !q
        || user.username.toLowerCase().includes(q)
        || (user.email || '').toLowerCase().includes(q)
      return matchesRole && matchesStatus && matchesSearch
    })
  }, [roleFilter, search, statusFilter, users])

  const visibleIds = useMemo(() => filtered.map((u) => u.id), [filtered])
  const visibleSelectableRows = useMemo(
    () => filtered.filter((user) => !user.locked),
    [filtered]
  )
  const loadedEditingUser = users.find((user) => user.id === editingUserId) || null
  const editingUser = loadedEditingUser
    || (editingUserSnapshot?.id === editingUserId ? editingUserSnapshot : null)

  useEffect(() => {
    if (loadedEditingUser) {
      setEditingUserSnapshot(loadedEditingUser)
    }
  }, [loadedEditingUser])

  useEffect(() => {
    const visibleIdSet = new Set(visibleIds)
    setSelected((current) => {
      const next = new Set([...current].filter((id) => visibleIdSet.has(id)))
      return next.size === current.size ? current : next
    })
    setAnchorId((current) => (
      current && !visibleIdSet.has(current) ? null : current
    ))
  }, [visibleIds])

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
        for (let i = s; i <= t; i++) {
          const rangeUser = filtered[i]
          if (!rangeUser.locked) next.add(rangeUser.id)
        }
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
    [anchorId, filtered, visibleIds]
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
        await updateUserBusinessRole(id, targetRole)
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

  const closeUserEditor = () => {
    editorOperationRef.current += 1
    passwordOperationRef.current += 1
    currentEditingUserIdRef.current = null
    setEditingUserId(null)
    setEditingUserSnapshot(null)
    setDialog(null)
    setPendingSave(null)
    setRiskPhrase('')
    setPasswordForm({ password: '', confirm: '' })
    setPasswordMessage(null)
    setPasswordSubmitting(false)
    setEditorMessage(null)
    setReloadingEditor(false)
  }

  const requestEditorClose = ({ dirty }) => {
    if (dirty) {
      setDialog('discard')
      return
    }
    closeUserEditor()
  }

  const cancelPendingSave = () => {
    setDialog(null)
    setPendingSave(null)
    setRiskPhrase('')
  }

  const cancelPasswordDialog = () => {
    passwordOperationRef.current += 1
    setDialog(null)
    setPasswordForm({ password: '', confirm: '' })
    setPasswordMessage(null)
    setPasswordSubmitting(false)
  }

  const openPasswordDialogForUser = (user) => {
    if (!user || currentEditingUserIdRef.current !== user.id) return
    passwordOperationRef.current += 1
    setPasswordForm({ password: '', confirm: '' })
    setPasswordMessage(null)
    setPasswordSubmitting(false)
    setDialog('password')
  }

  const submitPasswordReset = async (event) => {
    event.preventDefault()
    const target = editingUser
    if (!target || currentEditingUserIdRef.current !== target.id) return

    const password = passwordForm.password.trim()
    const confirmation = passwordForm.confirm.trim()
    if (password.length < 8) {
      setPasswordMessage({ kind: 'error', text: '密码至少需要 8 位' })
      return
    }
    if (password !== confirmation) {
      setPasswordMessage({ kind: 'error', text: '两次输入的密码不一致' })
      return
    }

    const operation = {
      token: passwordOperationRef.current + 1,
      userId: target.id,
    }
    passwordOperationRef.current = operation.token
    const isActive = () => (
      passwordOperationRef.current === operation.token
      && currentEditingUserIdRef.current === operation.userId
    )

    setPasswordSubmitting(true)
    setPasswordMessage(null)
    try {
      await resetUserPassword(operation.userId, password)
      if (!isActive()) return
      setDialog(null)
      setPasswordForm({ password: '', confirm: '' })
      setPasswordMessage(null)
      setEditorMessage({
        kind: 'success',
        retryable: false,
        text: `已重置 ${target.username} 的登录密码`,
      })
    } catch (error) {
      if (isActive()) {
        setPasswordMessage({
          kind: 'error',
          text: error?.message || '密码重置失败，请稍后重试',
        })
      }
    } finally {
      if (isActive()) {
        setPasswordSubmitting(false)
      }
    }
  }

  const openUserEditor = (user) => {
    if (saveSequenceRef.current?.userId === user.id) return
    editorOperationRef.current += 1
    passwordOperationRef.current += 1
    currentEditingUserIdRef.current = user.id
    setEditorMessage(null)
    setPageNotice(null)
    setReloadingEditor(false)
    setDialog(null)
    setPendingSave(null)
    setRiskPhrase('')
    setPasswordForm({ password: '', confirm: '' })
    setPasswordMessage(null)
    setPasswordSubmitting(false)
    setEditingUserSnapshot(user)
    setEditingUserId(user.id)
  }

  const beginEditorOperation = (userId) => {
    const token = editorOperationRef.current + 1
    editorOperationRef.current = token
    currentEditingUserIdRef.current = userId
    return { token, userId }
  }

  const isEditorOperationActive = (operation) => (
    editorOperationRef.current === operation.token
    && currentEditingUserIdRef.current === operation.userId
  )

  const persistUserChanges = async (userId, changes) => {
    const appliedFields = []
    const steps = [
      {
        field: 'businessRole',
        label: '业务角色',
        save: (value) => updateUserBusinessRole(userId, value),
      },
      {
        field: 'role',
        label: '系统角色',
        save: (value) => updateUserRole(userId, value),
      },
      {
        field: 'status',
        label: '账户状态',
        save: (value) => updateUserStatus(userId, value),
      },
    ]

    for (const step of steps) {
      if (!Object.hasOwn(changes, step.field)) continue
      try {
        await step.save(changes[step.field])
        appliedFields.push(step.label)
      } catch (error) {
        let reconciliationFailed = false
        try {
          await reload()
        } catch (_) {
          reconciliationFailed = true
        }
        const appliedText = appliedFields.length > 0
          ? `已保存：${appliedFields.join('、')}。`
          : ''
        const staleWarning = reconciliationFailed
          ? '。服务器状态刷新失败，当前显示可能过期'
          : ''
        return {
          ok: false,
          message: {
            kind: 'error',
            retryable: reconciliationFailed,
            text: `${step.label}保存失败；${appliedText}${error?.message || '请稍后重试'}${staleWarning}`,
          },
        }
      }
    }

    try {
      await reload()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: {
          kind: 'error',
          retryable: true,
          text: `变更已提交，但重新读取服务器数据失败。服务器状态刷新失败，当前显示可能过期。${error?.message || '请稍后重试'}`,
        },
      }
    }
  }

  const performSave = async (payload, operation, saveSequence) => {
    setEditorMessage(null)
    try {
      const result = await persistUserChanges(payload.userId, payload.changes)
      if (!isEditorOperationActive(operation)) return
      if (result.ok) {
        setPendingSave(null)
        setPageNotice(`已保存 ${payload.original.username}`)
        closeUserEditor()
      } else {
        setEditorMessage(result.message)
      }
    } catch (error) {
      if (isEditorOperationActive(operation)) {
        setEditorMessage({
          kind: 'error',
          retryable: false,
          text: error?.message || '保存失败，请稍后重试',
        })
      }
    } finally {
      if (saveSequenceRef.current === saveSequence) {
        saveSequenceRef.current = null
        setSavingUserId(null)
      }
    }
  }

  const retryEditorReload = () => {
    const userId = currentEditingUserIdRef.current
    if (!userId) return
    const operation = beginEditorOperation(userId)
    setReloadingEditor(true)
    setEditorMessage({
      kind: 'info',
      retryable: false,
      text: '正在重新读取服务器数据…',
    })

    void reload()
      .then(() => {
        if (!isEditorOperationActive(operation)) return
        setEditorMessage({
          kind: 'success',
          retryable: false,
          text: '服务器数据已重新读取',
        })
      })
      .catch((error) => {
        if (!isEditorOperationActive(operation)) return
        setEditorMessage({
          kind: 'error',
          retryable: true,
          text: `服务器状态刷新失败，当前显示可能过期。${error?.message || '请稍后重试'}`,
        })
      })
      .finally(() => {
        if (isEditorOperationActive(operation)) {
          setReloadingEditor(false)
        }
      })
  }

  const startUserSave = (payload) => {
    if (saveSequenceRef.current) return false
    const saveSequence = { userId: payload.userId }
    saveSequenceRef.current = saveSequence
    setSavingUserId(payload.userId)
    const operation = beginEditorOperation(payload.userId)
    void performSave(payload, operation, saveSequence)
    return true
  }

  const requestUserSave = ({ original, draft }) => {
    if (saveSequenceRef.current) return
    const payload = {
      userId: original.id,
      original,
      draft,
      changes: collectUserChanges(original, draft),
    }
    if (needsRiskConfirmation(original, draft)) {
      setPendingSave(payload)
      setRiskPhrase('')
      setDialog('risk')
      return
    }
    setPendingSave(null)
    setRiskPhrase('')
    startUserSave(payload)
  }

  const confirmRiskSave = () => {
    const payload = pendingSave
    if (!payload || saveSequenceRef.current) return
    if (requiresTypedRiskPhrase(payload) && riskPhrase.trim() !== '我确定') return

    setDialog(null)
    setPendingSave(null)
    setRiskPhrase('')
    startUserSave(payload)
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
  return (
    <PageShell
      crumb="工作台 / 用户管理"
      title="用户管理"
      subtitle="用户、角色与状态管理"
      actions={[]}
    >
      {pageNotice ? (
        <div className="user-editor__message" data-kind="success" role="status">
          {pageNotice}
        </div>
      ) : null}
      <div className="section" style={{ margin: 0 }}>
        <div className="user-management__filters">
          <label>
            <span>系统角色</span>
            <select
              className="input"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="all">全部</option>
              {ROLES.map((role) => (
                <option key={role.key} value={role.key}>{role.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>状态</span>
            <select
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">全部</option>
              <option value="active">正常</option>
              <option value="disabled">已禁用</option>
            </select>
          </label>
          <input
            className="input"
            type="search"
            aria-label="搜索用户"
            placeholder="搜索用户名 / 邮箱"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {selCount > 0 ? (
          <div
            className="user-management__selection"
            role="region"
            aria-label="批量操作"
          >
            <strong>已选 {selCount} 人</strong>
            <button type="button" className="btn btn-ghost" onClick={clearSelection}>
              清除选择
            </button>
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
          </div>
        ) : null}

        {/* Table */}
        <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  aria-label="选择全部可见用户"
                  checked={
                    visibleSelectableRows.length > 0
                    && visibleSelectableRows.every((user) => selected.has(user.id))
                  }
                  disabled={visibleSelectableRows.length === 0}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) {
                      visibleSelectableRows.forEach((user) => next.add(user.id))
                    } else {
                      visibleSelectableRows.forEach((user) => next.delete(user.id))
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
                        aria-label={`选择 ${u.username}`}
                        checked={isSel}
                        onClick={(event) => event.stopPropagation()}
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
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`编辑 ${u.username}`}
                        disabled={savingUserId === u.id}
                        style={{ fontSize: 12, padding: '4px 10px', height: 28 }}
                        onClick={(event) => {
                          event.stopPropagation()
                          openUserEditor(u)
                        }}
                      >
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

      <UserEditorDrawer
        open={Boolean(editingUser)}
        user={editingUser}
        saving={Boolean(savingUserId) || reloadingEditor}
        message={editorMessage}
        onRequestClose={requestEditorClose}
        onRetry={retryEditorReload}
        onSave={requestUserSave}
        onResetPassword={openPasswordDialogForUser}
      />

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

      <Dialog
        open={dialog === 'discard'}
        title="放弃未保存修改"
        description={editingUser?.username}
        closeOnBackdrop={false}
        onClose={() => setDialog(null)}
      >
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13 }}>
          当前修改尚未保存。放弃后，这些修改将无法恢复。
        </p>
        <DialogActions>
          <button type="button" className="btn btn-out" onClick={() => setDialog(null)}>
            继续编辑
          </button>
          <button type="button" className="btn btn-dan" onClick={closeUserEditor}>
            放弃修改
          </button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialog === 'password'}
        title="重置登录密码"
        description={editingUser?.username}
        closeOnBackdrop={false}
        onClose={cancelPasswordDialog}
      >
        <form onSubmit={submitPasswordReset}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span>新密码</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwordForm.password}
                disabled={passwordSubmitting}
                onChange={(event) => setPasswordForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))}
              />
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span>确认密码</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwordForm.confirm}
                disabled={passwordSubmitting}
                onChange={(event) => setPasswordForm((current) => ({
                  ...current,
                  confirm: event.target.value,
                }))}
              />
            </label>
          </div>
          {passwordMessage?.text ? (
            <div
              className="user-editor__message"
              data-kind={passwordMessage.kind}
              role="status"
            >
              {passwordMessage.text}
            </div>
          ) : null}
          <DialogActions>
            <button
              type="button"
              className="btn btn-out"
              disabled={passwordSubmitting}
              onClick={cancelPasswordDialog}
            >
              取消重置
            </button>
            <button type="submit" className="btn btn-dan" disabled={passwordSubmitting}>
              {passwordSubmitting ? '重置中…' : '确认重置'}
            </button>
          </DialogActions>
        </form>
      </Dialog>

      <RiskConfirmationDialog
        open={dialog === 'risk'}
        pendingSave={pendingSave}
        riskPhrase={riskPhrase}
        onPhraseChange={setRiskPhrase}
        onCancel={cancelPendingSave}
        onConfirm={confirmRiskSave}
      />

      {/* 改系统角色 dialog */}
      <Dialog
        open={dialog === 'systemRole'}
        title="修改系统角色"
        description={`已选 ${selCount} 人`}
        onClose={() => setDialog(null)}
      >
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
      </Dialog>

      {/* 改业务角色 dialog */}
      <Dialog
        open={dialog === 'businessRole'}
        title="修改业务角色"
        description={`已选 ${selCount} 人`}
        onClose={() => setDialog(null)}
      >
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
      </Dialog>

      {/* 降权保护 dialog */}
      <Dialog
        open={dialog === 'demote'}
        title="⚠ 降权保护确认"
        description="超级管理员降级为高风险操作"
        closeOnBackdrop={false}
        onClose={() => {
          setDialog(null)
          setDemoteConfirm('')
        }}
      >
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
        <label style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
          <span>输入“我确定”</span>
          <input
            className="input"
            type="text"
            value={demoteConfirm}
            onChange={(event) => setDemoteConfirm(event.target.value)}
            placeholder="我确定"
          />
        </label>
        <DialogActions>
          <button
            type="button"
            className="btn btn-out"
            style={{ height: 30, fontSize: 12, padding: '0 14px' }}
            onClick={() => {
              setDialog(null)
              setDemoteConfirm('')
            }}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-dan"
            style={{ height: 30, fontSize: 12, padding: '0 14px' }}
            disabled={demoteConfirm.trim() !== '我确定'}
            onClick={confirmDemote}
          >
            确认降级
          </button>
        </DialogActions>
      </Dialog>
    </PageShell>
  )
}
