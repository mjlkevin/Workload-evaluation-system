import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'
import useAuth from '../hooks/useAuth.js'
import { APP_VERSION } from '../config/app.js'
import { resolvePostLoginRedirect } from '../utils/authRedirect.js'

const USERNAME_HISTORY_KEY = 'wes_username_history'
const LEGACY_RECENT_USERS_KEY = 'wes_recent_users'
const MAX_HISTORY = 8

function getUsernameHistory() {
  let history = []
  try {
    const raw = localStorage.getItem(USERNAME_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    history = Array.isArray(parsed) ? parsed.filter((name) => typeof name === 'string' && name) : []
  } catch {
    history = []
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_RECENT_USERS_KEY)
    if (!legacyRaw) return history

    const legacyUsers = JSON.parse(legacyRaw)
    const legacyNames = Array.isArray(legacyUsers)
      ? legacyUsers
        .map((entry) => (typeof entry === 'string' ? entry : entry?.username))
        .filter((name) => typeof name === 'string' && name)
      : []
    const migratedHistory = [...new Set([...history, ...legacyNames])].slice(0, MAX_HISTORY)
    localStorage.setItem(USERNAME_HISTORY_KEY, JSON.stringify(migratedHistory))
    localStorage.removeItem(LEGACY_RECENT_USERS_KEY)
    return migratedHistory
  } catch {
    try {
      localStorage.removeItem(LEGACY_RECENT_USERS_KEY)
    } catch {
      // Ignore unavailable storage; login remains usable without history.
    }
    return history
  }
}

function saveUsernameHistory(name) {
  if (!name) return
  const list = getUsernameHistory().filter((u) => u !== name)
  list.unshift(name)
  localStorage.setItem(USERNAME_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)))
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
  const [showUsernameDropdown, setShowUsernameDropdown] = useState(false)
  const [usernameHistory, setUsernameHistory] = useState(getUsernameHistory)
  const usernameInputRef = useRef(null)
  const passwordInputRef = useRef(null)
  const dropdownRef = useRef(null)
  const location = useLocation()
  const { login, register, loading, error, clearError } = useAuth()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        usernameInputRef.current && !usernameInputRef.current.contains(e.target)
      ) {
        setShowUsernameDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleUsernameFocus = useCallback(() => {
    const history = getUsernameHistory()
    setUsernameHistory(history)
    if (history.length > 0) setShowUsernameDropdown(true)
  }, [])

  const handleSelectUsername = useCallback((name) => {
    setUsername(name)
    setShowUsernameDropdown(false)
    passwordInputRef.current?.focus()
  }, [])

  const handleRemoveUsername = useCallback((e, name) => {
    e.stopPropagation()
    const updated = getUsernameHistory().filter((u) => u !== name)
    localStorage.setItem(USERNAME_HISTORY_KEY, JSON.stringify(updated))
    setUsernameHistory(updated)
    if (updated.length === 0) setShowUsernameDropdown(false)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmedUsername = username.trim()
    if (mode !== 'login') {
      const result = await register(trimmedUsername, password, email.trim(), inviteCode.trim())
      if (result.success) {
        setMode('login')
        setPassword('')
        setInviteCode('')
      }
      return
    }

    const result = await login(trimmedUsername, password, rememberMe, resolvePostLoginRedirect(location))
    if (result.success) {
      saveUsernameHistory(trimmedUsername)
      setUsernameHistory(getUsernameHistory())
    }
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
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', padding: 24, background: 'linear-gradient(135deg,var(--bg) 0%,var(--brand-soft) 100%)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: 380, maxWidth: '100%', background: '#fff', borderRadius: 'var(--shell-radius)', boxShadow: 'var(--shadow-3)', padding: '30px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,var(--brand),var(--accent))', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>D</div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Datum</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>工作量评估系统</div>
          </div>
        </div>

        <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, display: mode === 'login' ? 'block' : 'none' }}>登录</h3>
        <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, display: mode === 'register' ? 'block' : 'none' }}>使用邀请码激活账号</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 20 }}>{mode === 'login' ? '请输入账号信息以继续' : '以下信息均为必填'}</p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={handleSubmit} onKeyDown={(e) => { if (e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); e.target.select?.() } }}>
          {mode === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="login-email" style={{ fontSize: 12, color: 'var(--ink-2)' }}>邮箱</label>
              <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); clearError() }} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="login-username" style={{ fontSize: 12, color: 'var(--ink-2)' }}>用户名</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-username"
                ref={usernameInputRef}
                className="input"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => { setUsername(e.target.value); clearError() }}
                onFocus={handleUsernameFocus}
              />
            {showUsernameDropdown && usernameHistory.length > 0 && (
              <div
                ref={dropdownRef}
                style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  marginTop: 4, background: '#fff', border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                  maxHeight: 220, overflowY: 'auto', padding: '4px 0'
                }}
              >
                <div style={{ padding: '4px 12px 6px', fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: 0.3 }}>
                  最近使用
                </div>
                {usernameHistory.map((name) => (
                  <div
                    key={name}
                    onClick={() => handleSelectUsername(name)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink-1)',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--brand-soft)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {name}
                    </span>
                    <span
                      onClick={(e) => handleRemoveUsername(e, name)}
                      title="移除此记录"
                      style={{ fontSize: 16, color: 'var(--ink-3)', lineHeight: 1, padding: '2px 4px', borderRadius: 4, cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--err)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)' }}
                    >×</span>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="login-password" style={{ fontSize: 12, color: 'var(--ink-2)' }}>密码</label>
            <input ref={passwordInputRef} id="login-password" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => { setPassword(e.target.value); clearError() }} />
          </div>
          {mode === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="login-invite" style={{ fontSize: 12, color: 'var(--ink-2)' }}>邀请码</label>
              <input id="login-invite" className="input" type="text" autoComplete="off" value={inviteCode} onChange={(e) => { setInviteCode(e.target.value); clearError() }} />
            </div>
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
                忘记密码？
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
        v {APP_VERSION} · © 2026 Datum
      </div>

      {resetOpen && (
        <div role="dialog" aria-modal="true" aria-label="找回密码" style={{ position: 'fixed', inset: 0, background: 'color-mix(in oklch, var(--ink) 22%, transparent)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', padding: 20 }}>
          <div style={{ width: 360, maxWidth: '100%', background: '#fff', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-3)', padding: 22 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>找回密码</h3>
            <p style={{ margin: '10px 0 14px', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              将为当前用户名生成一次性重置链接。
            </p>
            <label htmlFor="reset-username" style={{ display: 'block', fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>用户名</label>
            <input
              id="reset-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
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
              <button type="button" className="btn btn-out" onClick={() => setResetOpen(false)} style={{ height: 32, fontSize: 12 }}>关闭</button>
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
