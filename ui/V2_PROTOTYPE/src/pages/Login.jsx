import React, { useState } from 'react'
import useAuth from '../hooks/useAuth.js'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const { login, register, loading, error } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    const result = mode === 'login'
      ? await login(username.trim(), password)
      : await register(username.trim(), password, email.trim(), inviteCode.trim())

    if (result.success && mode === 'register') {
      setMode('login')
      setPassword('')
      setInviteCode('')
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
          <input className="input" type="text" placeholder="用户名" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }} />
          <input className="input" type="password" placeholder="密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14, borderColor: 'var(--brand)', boxShadow: 'var(--shadow-focus)' }} />
          {mode === 'register' && (
            <input className="input" type="text" placeholder="邀请码（必填）" autoComplete="off" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontSize: 14 }} />
          )}

          {mode === 'login' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--ink-2)' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid var(--line-2)', background: '#fff', display: 'inline-block' }} />
                记住 7 天
              </label>
              <a href="#" style={{ fontSize: 12, color: 'var(--brand)' }}>忘记密码?</a>
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
    </div>
  )
}
