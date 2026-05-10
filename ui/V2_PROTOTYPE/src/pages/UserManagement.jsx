import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function UserManagement() {
  const users = [
    { id: 'u1', username: 'mjlkevin', role: 'admin', status: 'active', lastLoginAt: '2026-05-09T14:28:00Z' },
    { id: 'u2', username: 'admin', role: 'sub_admin', status: 'active', lastLoginAt: '2026-05-08T09:15:00Z' },
    { id: 'u3', username: 'zhangpeng', role: 'user', status: 'active', lastLoginAt: '2026-05-07T18:40:00Z' },
    { id: 'u4', username: 'wangmin', role: 'user', status: 'disabled', lastLoginAt: null },
  ]

  function roleLabel(r) {
    const map = { admin: '超级管理员', sub_admin: '管理员', user: '普通用户' }
    return map[r] || r
  }

  function fmtRoleChip(r) {
    const isSa = r === 'admin'
    if (isSa) return <span className="bdg" style={{ background: 'var(--ink)', color: '#fff', fontSize: 10.5, padding: '1px 7px' }}><span className="dot" style={{ background: 'var(--accent)' }} />{roleLabel(r)}</span>
    const cls = r === 'sub_admin' ? 'brd' : r === 'user' ? 'draft' : 'ok'
    return <span className={`bdg ${cls}`} style={{ fontSize: 10.5, padding: '1px 7px' }}><span className="dot" />{roleLabel(r)}</span>
  }

  function fmtStatus(s) {
    return s === 'active'
      ? <span className="bdg ok" style={{ fontSize: 10.5, padding: '1px 7px' }}><span className="dot" />正常</span>
      : <span className="bdg draft" style={{ fontSize: 10.5, padding: '1px 7px' }}><span className="dot" />已禁用</span>
  }

  return (
    <PageShell
      crumb="工作台 / 用户管理"
      title="用户管理"
      subtitle="用户、角色与状态管理"
      actions={[]}
    >
      <div className="section" style={{ margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>已选 0</span>
          <div style={{ display: 'flex', gap: 4, paddingRight: 12, borderRight: '1px solid var(--line)' }}>
            <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} disabled>批量启用</button>
            <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px', color: 'var(--err)' }} disabled>批量禁用</button>
            <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} disabled>改角色</button>
            <button className="btn btn-pri" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>+ 邀请成员</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-2)' }}>角色：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>全部</b><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span></span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-2)' }}>状态：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>全部</b><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span></span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, background: '#fff', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-3)', width: 220, flexShrink: 0 }}>⌕ 搜索用户名 / 邮箱</span>
        </div>
        <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
          <thead>
            <tr><th style={{ width: 34, textAlign: 'center' }}>☐</th><th>用户</th><th>角色</th><th>状态</th><th>最后登录</th><th>操作</th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSa = u.role === 'admin'
              return (
                <tr key={u.id}>
                  <td style={{ textAlign: 'center' }}>{isSa ? <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>—</span> : <span style={{ cursor: 'pointer' }}>☐</span>}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand-ink)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{u.username.charAt(0).toUpperCase()}</div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{u.username}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{u.username}@wes.local</div>
                      </div>
                    </div>
                  </td>
                  <td>{fmtRoleChip(u.role)}</td>
                  <td>{fmtStatus(u.status)}</td>
                  <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{u.lastLoginAt ? u.lastLoginAt.replace('T', ' ').replace('Z', '') : '—'}</td>
                  <td>
                    {isSa
                      ? <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>— 系统账号 —</span>
                      : <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px', height: 28 }}>编辑</button>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
