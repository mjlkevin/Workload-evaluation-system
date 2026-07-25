import { useEffect, useMemo, useRef, useState } from 'react'
import { BUSINESS_ROLES, businessRoleLabel } from '../../hooks/useUsers.js'
import { Drawer } from '../ui/Drawer.jsx'

const SYSTEM_ROLES = [
  { key: 'admin', label: '超级管理员' },
  { key: 'sub_admin', label: '管理员' },
  { key: 'user', label: '普通用户' },
]

const ACCOUNT_STATUSES = [
  { key: 'active', label: '正常' },
  { key: 'disabled', label: '已禁用' },
]

function draftFromUser(user) {
  if (!user) return null
  return {
    role: user.role,
    businessRole: user.businessRole,
    status: user.status,
  }
}

export default function UserEditorDrawer({
  open,
  user,
  saving,
  message,
  onRequestClose,
  onRetry,
  onSave,
  onResetPassword,
}) {
  const [draft, setDraft] = useState(null)
  const systemRoleRef = useRef(null)

  useEffect(() => {
    if (open && user) {
      setDraft(draftFromUser(user))
    }
  }, [open, user?.id])

  const dirty = useMemo(() => Boolean(
    user
    && draft
    && (
      draft.role !== user.role
      || draft.businessRole !== user.businessRole
      || draft.status !== user.status
    )
  ), [draft, user])

  if (!user || !draft) return null

  const requestClose = () => onRequestClose({ dirty })
  const fieldsDisabled = !onSave || saving

  return (
    <Drawer
      open={open}
      title="编辑用户"
      description={user.username}
      initialFocusRef={fieldsDisabled ? undefined : systemRoleRef}
      closeOnBackdrop
      onClose={requestClose}
      footer={(
        <>
          <button type="button" className="btn btn-out" onClick={requestClose}>
            取消
          </button>
          {onSave ? (
            <button
              type="button"
              className="btn btn-pri"
              disabled={!dirty || saving}
              onClick={() => onSave({ original: user, draft })}
            >
              {saving ? '保存中…' : '保存变更'}
            </button>
          ) : null}
        </>
      )}
    >
      <dl className="user-editor__summary">
        <div>
          <dt>邮箱</dt>
          <dd>{user.email || '—'}</dd>
        </div>
        <div>
          <dt>最后登录</dt>
          <dd>{user.lastLoginAt || '—'}</dd>
        </div>
      </dl>

      <div className="user-editor__fields">
        <label>
          <span>系统角色</span>
          <select
            ref={systemRoleRef}
            className="input"
            value={draft.role}
            disabled={fieldsDisabled}
            onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
          >
            {SYSTEM_ROLES.map((role) => (
              <option key={role.key} value={role.key}>{role.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>业务角色</span>
          <select
            className="input"
            value={draft.businessRole}
            disabled={fieldsDisabled}
            onChange={(event) => setDraft((current) => ({ ...current, businessRole: event.target.value }))}
          >
            {BUSINESS_ROLES.map((role) => (
              <option key={role.key} value={role.key}>{businessRoleLabel(role.key)}</option>
            ))}
          </select>
        </label>

        <label>
          <span>账户状态</span>
          <select
            className="input"
            value={draft.status}
            disabled={fieldsDisabled}
            onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
          >
            {ACCOUNT_STATUSES.map((status) => (
              <option key={status.key} value={status.key}>{status.label}</option>
            ))}
          </select>
        </label>
      </div>

      {onResetPassword ? (
        <section className="user-editor__safety">
          <h3>账户安全</h3>
          <button type="button" className="btn btn-out" onClick={() => onResetPassword(user)}>
            重置密码…
          </button>
        </section>
      ) : null}

      {message?.text ? (
        <div className="user-editor__message" data-kind={message.kind} role="status">
          <div>{message.text}</div>
          {message.retryable && onRetry ? (
            <button
              type="button"
              className="btn btn-out"
              disabled={saving}
              onClick={onRetry}
            >
              重新读取服务器数据
            </button>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}
