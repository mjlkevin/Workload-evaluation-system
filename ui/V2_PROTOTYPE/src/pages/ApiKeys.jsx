import React, { useState, useMemo } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

const INITIAL_KEYS = [
  { id: 'k1', name: '生产环境主密钥', key: 'sk-wes-prod-7a3f9e2b', status: 'active', scope: 'admin', createdAt: '2026-04-10T08:00:00Z' },
  { id: 'k2', name: '测试环境密钥', key: 'sk-wes-staging-4c8d1f5a', status: 'active', scope: 'write', createdAt: '2026-04-08T10:30:00Z' },
  { id: 'k3', name: '只读监控密钥', key: 'sk-wes-readonly-9e3b6c2d', status: 'revoked', scope: 'read', createdAt: '2026-03-22T14:15:00Z' },
]

const SCOPES = [
  { key: 'read', label: '只读' },
  { key: 'write', label: '读写' },
  { key: 'admin', label: '管理' },
]

const methodCls = {
  get: { bg: 'var(--ok-soft)', co: 'var(--ok-ink)' },
  post: { bg: 'var(--brand-soft)', co: 'var(--brand-ink)' },
  patch: { bg: 'var(--accent-soft)', co: 'var(--accent-ink)' },
  put: { bg: 'var(--warn-soft)', co: 'var(--warn-ink)' },
  delete: { bg: 'var(--err-soft)', co: 'var(--err)' },
}

export default function ApiKeys() {
  const [apiKeys, setApiKeys] = useState(INITIAL_KEYS)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState(null)
  const [dialog, setDialog] = useState(null) // 'new' | null
  const [newName, setNewName] = useState('')
  const [newScope, setNewScope] = useState('read')

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return apiKeys
    return apiKeys.filter((k) => k.name.toLowerCase().includes(q) || k.key.toLowerCase().includes(q))
  }, [apiKeys, search])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1800)
  }

  const copyKey = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制')
    } catch {
      showToast('复制失败')
    }
  }

  const toggleStatus = (id) => {
    setApiKeys((prev) =>
      prev.map((k) =>
        k.id === id ? { ...k, status: k.status === 'active' ? 'revoked' : 'active' } : k
      )
    )
  }

  const createKey = () => {
    const name = newName.trim()
    if (!name) {
      alert('请输入密钥名称')
      return
    }
    const prefix = 'sk-wes-' + Math.random().toString(36).slice(2, 10)
    setApiKeys((prev) => [
      ...prev,
      {
        id: 'k' + Date.now(),
        name,
        key: prefix,
        status: 'active',
        scope: newScope,
        createdAt: new Date().toISOString(),
      },
    ])
    setNewName('')
    setNewScope('read')
    setDialog(null)
    showToast('新密钥已生成')
  }

  const catalog = {
    AUTH: [
      { method: 'POST', path: '/api/auth/login', desc: '用户登录获取 JWT' },
      { method: 'POST', path: '/api/auth/refresh', desc: '刷新 Token' },
    ],
    PLANS: [
      { method: 'GET', path: '/api/plans', desc: '评估方案列表' },
      { method: 'POST', path: '/api/plans', desc: '创建评估方案' },
    ],
    ASSESSMENTS: [
      { method: 'GET', path: '/api/assessments/:id', desc: '实施评估详情' },
      { method: 'PATCH', path: '/api/assessments/:id', desc: '更新评估' },
    ],
  }

  return (
    <PageShell
      crumb="工作台 / API 密钥与接入"
      title="API 密钥与接入"
      subtitle="后端 Workload API · JWT (Authorization: Bearer)"
      actions={[]}
    >
      <div style={{ padding: '18px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16 }}>
          {/* API Keys */}
          <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--line)',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>API Keys</span>
              <div className="right" style={{ marginLeft: 'auto' }}>
                <button
                  className="btn btn-pri"
                  style={{ fontSize: 12, padding: '6px 12px', height: 32 }}
                  onClick={() => setDialog('new')}
                >
                  + 生成新 Key
                </button>
              </div>
            </div>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
              <input
                type="text"
                placeholder="⌕ 搜索密钥名称 / Key"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 7,
                  background: '#fff',
                  border: '1px solid var(--line)',
                  fontSize: 12,
                  color: 'var(--ink)',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ padding: '16px 18px' }}>
              <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>Key</th>
                    <th>状态</th>
                    <th>权限</th>
                    <th style={{ width: 90 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredKeys.map((k) => (
                    <tr key={k.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{k.name}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {k.key}
                      </td>
                      <td>
                        <span
                          className={`bdg ${k.status === 'active' ? 'ok' : 'draft'}`}
                          style={{ fontSize: 10.5, padding: '1px 6px' }}
                        >
                          <span className="dot" />
                          {k.status === 'active' ? '生效中' : '已撤销'}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        {k.scope}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: '4px 8px', height: 26 }}
                            onClick={() => copyKey(k.key)}
                          >
                            复制
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{
                              fontSize: 11,
                              padding: '4px 8px',
                              height: 26,
                              color: k.status === 'active' ? 'var(--err)' : 'var(--ink-3)',
                            }}
                            onClick={() => toggleStatus(k.id)}
                          >
                            {k.status === 'active' ? '撤销' : '恢复'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Contract */}
          <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>
              接入与契约
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                {
                  chip: 'Base URL',
                  chipCls: { bg: 'var(--ok-soft)', co: 'var(--ok-ink)' },
                  txt: (
                    <>
                      生产环境：
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        https://api.wes.local/v1
                      </code>
                      <br />
                      测试环境：
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        https://staging-api.wes.local/v1
                      </code>
                    </>
                  ),
                },
                {
                  chip: '鉴权',
                  chipCls: { bg: 'var(--brand-soft)', co: 'var(--brand-ink)' },
                  txt: (
                    <>
                      所有请求须在 Header 中携带{' '}
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        Authorization: Bearer &lt;JWT&gt;
                      </code>
                      。
                      <br />
                      JWT 通过{' '}
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        POST /api/auth/login
                      </code>{' '}
                      获取，有效期 24h，支持刷新。
                    </>
                  ),
                  actions: true,
                },
                {
                  chip: '响应',
                  chipCls: { bg: 'var(--accent-soft)', co: 'var(--accent-ink)' },
                  txt: (
                    <>
                      统一 JSON 信封：
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        {'{ "success": bool, "data": any, "error": { "code", "message" } }'}
                      </code>
                      <br />
                      HTTP 200 仅表示通信成功，业务错误以{' '}
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        error
                      </code>{' '}
                      字段呈现。
                    </>
                  ),
                },
                {
                  chip: '上传',
                  chipCls: { bg: 'var(--info-soft)', co: 'var(--info)' },
                  txt: (
                    <>
                      文件上传使用{' '}
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          background: 'var(--bg-soft)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          color: 'var(--ink)',
                        }}
                      >
                        multipart/form-data
                      </code>
                      ，单文件上限 20MB。
                      <br />
                      支持类型：.xlsx / .docx / .pdf / .md
                    </>
                  ),
                  actions: true,
                },
              ].map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      padding: '3px 10px',
                      borderRadius: 5,
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: '.04em',
                      background: b.chipCls.bg,
                      color: b.chipCls.co,
                    }}
                  >
                    {b.chip}
                  </span>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                    {b.txt}
                    {b.actions && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 28 }}>
                          📜 查看 OpenAPI
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 28 }}>
                          ⎘ 复制 cURL
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* API Catalog */}
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            marginTop: 16,
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--line)',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>接口目录</span>
          </div>
          <div style={{ padding: 0 }}>
            <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              <thead>
                <tr>
                  <th>分组</th>
                  <th>说明</th>
                  <th>路径</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(catalog).map(([grp, list]) => (
                  <tr key={grp}>
                    <td
                      style={{
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {grp}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{list[0].desc}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.95 }}>
                        {list.map((ep, i) => {
                          const m = ep.method.toLowerCase()
                          const cls = methodCls[m] || methodCls.get
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: 4,
                                  whiteSpace: 'nowrap',
                                  background: cls.bg,
                                  color: cls.co,
                                }}
                              >
                                {ep.method}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>
                                {ep.path}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--ink)',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 12,
            fontWeight: 600,
            zIndex: 60,
            boxShadow: 'var(--shadow-2)',
          }}
        >
          {toast}
        </div>
      )}

      {/* New Key dialog */}
      {dialog === 'new' && (
        <DialogBackdrop onClose={() => setDialog(null)}>
          <DialogCard title="生成新 API Key">
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>
                密钥名称
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如：生产环境主密钥"
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
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>
                权限范围
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {SCOPES.map((s) => (
                  <label
                    key={s.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: `1px solid ${newScope === s.key ? 'var(--brand)' : 'var(--line)'}`,
                      background: newScope === s.key ? 'var(--brand-soft)' : '#fff',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="radio"
                      name="scope"
                      value={s.key}
                      checked={newScope === s.key}
                      onChange={() => setNewScope(s.key)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <DialogActions>
              <button className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
                取消
              </button>
              <button className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={createKey}>
                确认生成
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

function DialogCard({ title, children }) {
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
      </div>
      {children}
    </div>
  )
}

function DialogActions({ children }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>{children}</div>
}
