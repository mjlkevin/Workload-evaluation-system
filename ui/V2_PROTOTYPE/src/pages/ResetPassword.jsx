import React, { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiClient } from '../api/client.js'

export default function ResetPassword() {
  const location = useLocation()
  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!token) {
      setMessage('重置链接无效或已过期')
      return
    }
    if (password.length < 8) {
      setMessage('密码至少需要 8 位')
      return
    }
    if (password !== confirm) {
      setMessage('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      await apiClient.post('/auth/password-reset/confirm', { token, password })
      setSuccess(true)
      setPassword('')
      setConfirm('')
      setMessage('密码已重置，请返回登录')
    } catch (err) {
      setMessage(err?.message || '密码重置失败，请重新申请链接')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'linear-gradient(135deg,var(--bg) 0%,var(--brand-soft) 100%)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: 380, maxWidth: '100%', background: '#fff', borderRadius: 'var(--shell-radius)', boxShadow: 'var(--shadow-3)', padding: '30px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,var(--brand),var(--accent))', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>W</div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>WorkEvolutionSys</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>WES · 工作量演化系统</div>
          </div>
        </div>

        <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>重置密码</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 20 }}>请输入新密码完成账号恢复</p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={submit}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
            新密码
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
            确认新密码
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }}
            />
          </label>

          {message && <div style={{ color: success ? 'var(--ok)' : 'var(--err)', fontSize: 12, lineHeight: 1.5 }}>{message}</div>}

          <button type="submit" className="btn btn-pri" disabled={submitting || success} style={{ width: '100%', height: 40, fontSize: 14, opacity: submitting ? 0.72 : 1 }}>
            {submitting ? '重置中…' : '确认重置密码'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5 }}>
          <Link to="/login" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回登录</Link>
        </div>
      </div>
    </div>
  )
}
