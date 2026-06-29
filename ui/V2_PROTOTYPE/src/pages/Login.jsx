import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'
import useAuth from '../hooks/useAuth.js'

const RECENT_USERS_KEY = 'wes_recent_users'
const MAX_RECENT = 5

function loadRecentUsers() {
  try { return JSON.parse(localStorage.getItem(RECENT_USERS_KEY)) || [] } catch { return [] }
}
function saveRecentUsers(list) {
  localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(list))
}

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  const [resetLink, setResetLink] = useState('')
  const [recentUsers, setRecentUsers] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef(null)
  const usernameInputRef = useRef(null)
  const { login, register, loading, error } = useAuth()

  useEffect(() => {
    setRecentUsers(loadRecentUsers())
  }, [])

  useEffect(() => {
    if (!showDropdown) return
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDropdown])

  const addRecentUser = (uname, pwd) => {
    const filtered = recentUsers.filter((u) => u.username !== uname)
    const entry = { username: uname, password: pwd || null, ts: Date.now() }
    const next = [entry, ...filtered].slice(0, MAX_RECENT)
    setRecentUsers(next)
    saveRecentUsers(next)
  }

  const removeRecentUser = (uname) => {
    const next = recentUsers.filter((u) => u.username !== uname)
    setRecentUsers(next)
    saveRecentUsers(next)
  }

  const clearRecentUsers = () => {
    setRecentUsers([])
    saveRecentUsers([])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (mode !== 'login') {
      const result = await register(username.trim(), password, email.trim(), inviteCode.trim())
      if (result.success) {
        setMode('login')
        setPassword('')
        setInviteCode('')
      }
      return
    }
    const result = await login(username.trim(), password, rememberMe)
    if (result.success) {
      addRecentUser(username.trim(), rememberMe ? password : null)
    }
  }

  const handleSelectUser = (entry) => {
    setUsername(entry.username)
    if (entry.password) {
      setPassword(entry.password)
      setRememberMe(true)
    }
    setShowDropdown(false)
    if (usernameInputRef.current) usernameInputRef.current.focus()
  }

  const requestReset = async () => {
    const account = username.trim()
    if (!account) {
      setResetMessage('请先输入用户名')
      return
    }
    setResetLoading(true)
    setResetMessage('')
    setResetLink('')
    try {
      const payload = await apiClient.post('/auth/password-reset/request', { username: account })
      const data = unwrap(payload) || {}
      setResetMessage('重置链接已生成，30 分钟内有效')
      setResetLink(data.resetUrl || '')
    } catch (err) {
      setResetMessage(err?.message || '重置申请失败，请稍后重试')
    } finally {
      setResetLoading(false)
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

        <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, display: mode === 'login' ? 'block' : 'none' }}>登录</h3>
        <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, display: mode === 'register' ? 'block' : 'none' }}>使用邀请码激活账号</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 20 }}>请输入账号信息以继续</p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={handleSubmit}>
          {mode === 'register' && (
            <input className="input" type="email" placeholder="邮箱" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }} />
          )}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <input
              ref={usernameInputRef}
              className="input"
              type="text"
              placeholder="用户名"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onFocus={() => { if (recentUsers.length > 0) setShowDropdown(true) }}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }}
            />
            {showDropdown && recentUsers.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)', zIndex: 10, overflow: 'hidden' }}>
                {recentUsers.map((u) => (
                  <div
                    key={u.username}
                    onClick={() => handleSelectUser(u)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-1)', transition: 'background .15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-soft)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeRecentUser(u.username) }}
                      style={{ border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                      title="移除"
                    >×</button>
                  </div>
                ))}
                {recentUsers.length > 1 && (
                  <div
                    onClick={clearRecentUsers}
                    style={{ borderTop: '1px solid var(--line)', padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', transition: 'background .15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-soft)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >清除全部记录</div>
                )}
              </div>
            )}
          </div>
          <input className="input" type="password" placeholder="密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14, borderColor: 'var(--brand)', boxShadow: 'var(--shadow-focus)' }} />
          {mode === 'register' && (
            <input className="input" type="text" placeholder="邀请码（必填）" autoComplete="off" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }} />
          )}

          {mode === 'login' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--ink-2)' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ width: 14, height: 14, margin: 0 }}
                />
                记住 7 天
              </label>
              <button
                type="button"
                onClick={() => {
                  setResetOpen(true)
                  setResetMessage('')
                  setResetLink('')
                }}
                style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12, color: 'var(--brand)', cursor: 'pointer' }}
              >
                忘记密码?
              </button>
            </div>
          )}

          {error && <div style={{ color: 'var(--err)', fontSize: 12, lineHeight: 1.5 }}>{error}</div>}

          <button type="submit" className="btn btn-pri" disabled={loading} style={{ width: '100%', height: 40, fontSize: 14, display: mode === 'login' ? 'block' : 'none', opacity: loading ? 0.72 : 1 }}>{loading ? '登录中…' : '登录'}</button>
          <button type="submit" className="btn btn-pri" disabled={loading} style={{ width: '100%', height: 40, fontSize: 14, display: mode === 'register' ? 'block' : 'none', opacity: loading ? 0.72 : 1 }}>{loading ? '激活中…' : '激活账号'}</button>
        </form>

        {mode === 'login' && (
          <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5, color: 'var(--ink-2)' }}>
            还没有账号？<a href="#" style={{ color: 'var(--brand)', fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setMode('register') }}>使用邀请码激活 →</a>
          </div>
        )}
        {mode === 'register' && (
          <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5, color: 'var(--ink-2)' }}>
            已有账号？<a href="#" style={{ color: 'var(--brand)', fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setMode('login') }}>返回登录</a>
          </div>
        )}
      </div>

      <div style={{ position: 'fixed', bottom: 16, right: 20, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
        v 1.4.0 · © 2026 WES Team · <span style={{ cursor: 'pointer' }}>简体中文 ▾</span>
      </div>

      {resetOpen && (
        <div role="dialog" aria-modal="true" aria-label="找回密码" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.22)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ width: 360, maxWidth: '100%', background: '#fff', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-3)', padding: 22 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>找回密码</h3>
            <p style={{ margin: '10px 0 14px', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              将为当前用户名生成一次性重置链接。
            </p>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>用户名</div>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }}
            />
            {resetMessage && (
              <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, color: resetLink ? 'var(--ok)' : 'var(--ink-2)' }}>
                {resetMessage}
              </div>
            )}
            {resetLink && (
              <Link to={resetLink} style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--brand)', fontWeight: 600 }}>
                立即重置密码
              </Link>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setResetOpen(false)} style={{ height: 32, fontSize: 12 }}>关闭</button>
              <button type="button" className="btn btn-pri" disabled={resetLoading} onClick={requestReset} style={{ height: 32, fontSize: 12 }}>
                {resetLoading ? '发送中…' : '发送重置链接'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
