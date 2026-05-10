import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function ApiKeys() {
  const inviteCodes = [
    { code: 'WES-INV-7A3F', status: 'AVAILABLE', createdAt: '2026-04-10T08:00:00Z' },
    { code: 'WES-INV-9E2B', status: 'USED', createdAt: '2026-04-08T10:30:00Z' },
  ]

  const catalog = {
    AUTH: [{ method: 'POST', path: '/api/auth/login', desc: '用户登录获取 JWT' }, { method: 'POST', path: '/api/auth/refresh', desc: '刷新 Token' }],
    PLANS: [{ method: 'GET', path: '/api/plans', desc: '评估方案列表' }, { method: 'POST', path: '/api/plans', desc: '创建评估方案' }],
    ASSESSMENTS: [{ method: 'GET', path: '/api/assessments/:id', desc: '实施评估详情' }, { method: 'PATCH', path: '/api/assessments/:id', desc: '更新评估' }],
  }

  const methodCls = {
    get: { bg: 'var(--ok-soft)', co: 'var(--ok-ink)' },
    post: { bg: 'var(--brand-soft)', co: 'var(--brand-ink)' },
    patch: { bg: 'var(--accent-soft)', co: 'var(--accent-ink)' },
    put: { bg: 'var(--warn-soft)', co: 'var(--warn-ink)' },
    delete: { bg: 'var(--err-soft)', co: 'var(--err)' },
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
          {/* Invite codes */}
          <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>推荐码</span>
              <div className="right" style={{ marginLeft: 'auto' }}>
                <button className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>+ 生成推荐码</button>
              </div>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                <thead><tr><th>Code</th><th>状态</th><th>创建时间</th><th style={{ width: 60 }}>复制</th></tr></thead>
                <tbody>
                  {inviteCodes.map((c, i) => (
                    <tr key={i}>
                      <td className="mono">{c.code}</td>
                      <td>
                        <span className={`bdg ${c.status === 'USED' ? 'draft' : 'ok'}`} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                          <span className="dot" />{c.status === 'USED' ? '已使用' : '可用'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.createdAt ? c.createdAt.replace('T', ' ').replace('Z', '') : '—'}</td>
                      <td><button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px', height: 26 }}>复制</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Contract */}
          <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>接入与契约</div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { chip: 'Base URL', chipCls: { bg: 'var(--ok-soft)', co: 'var(--ok-ink)' }, txt: <>生产环境：<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>https://api.wes.local/v1</code><br />测试环境：<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>https://staging-api.wes.local/v1</code></> },
                { chip: '鉴权', chipCls: { bg: 'var(--brand-soft)', co: 'var(--brand-ink)' }, txt: <>所有请求须在 Header 中携带 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>Authorization: Bearer &lt;JWT&gt;</code>。<br />JWT 通过 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>POST /api/auth/login</code> 获取，有效期 24h，支持刷新。</>, actions: true },
                { chip: '响应', chipCls: { bg: 'var(--accent-soft)', co: 'var(--accent-ink)' }, txt: <>统一 JSON 信封：<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>{"{ \"success\": bool, \"data\": any, \"error\": { \"code\", \"message\" } }"}</code><br />HTTP 200 仅表示通信成功，业务错误以 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>error</code> 字段呈现。</> },
                { chip: '上传', chipCls: { bg: 'var(--info-soft)', co: 'var(--info)' }, txt: <>文件上传使用 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, color: 'var(--ink)' }}>multipart/form-data</code>，单文件上限 20MB。<br />支持类型：.xlsx / .docx / .pdf / .md</>, actions: true },
              ].map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '.04em', background: b.chipCls.bg, color: b.chipCls.co }}>{b.chip}</span>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                    {b.txt}
                    {b.actions && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 28 }}>📜 查看 OpenAPI</button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 28 }}>⎘ 复制 cURL</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* API Catalog */}
        <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginTop: 16 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>接口目录</span>
            <div className="right" style={{ marginLeft: 'auto' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, background: '#fff', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-3)', width: 220, flexShrink: 0 }}>⌕ 搜索接口 / 路径</span>
            </div>
          </div>
          <div style={{ padding: 0 }}>
            <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              <thead><tr><th>分组</th><th>说明</th><th>路径</th></tr></thead>
              <tbody>
                {Object.entries(catalog).map(([grp, list]) => (
                  <tr key={grp}>
                    <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>{grp}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{list[0].desc}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.95 }}>
                        {list.map((ep, i) => {
                          const m = ep.method.toLowerCase()
                          const cls = methodCls[m] || methodCls.get
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', background: cls.bg, color: cls.co }}>{ep.method}</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>{ep.path}</span>
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
    </PageShell>
  )
}
