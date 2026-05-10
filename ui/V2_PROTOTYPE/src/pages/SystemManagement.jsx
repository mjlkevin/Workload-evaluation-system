import React, { useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function SystemManagement() {
  const [tab, setTab] = useState('rules')

  const tabs = [
    { id: 'rules', label: '编码规则', count: 6 },
    { id: 'model', label: '模型配置' },
    { id: 'rate', label: 'RateCard' },
    { id: 'dsl', label: 'DSL 规则集' },
    { id: 'tpl', label: '模板' },
  ]

  const rules = [
    { module: '总方案', code: 'GL', prefix: 'GL-', format: 'GL-NNNNN', example: 'GL-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
    { module: '需求', code: 'RQ', prefix: 'RQ-', format: 'RQ-NNNNN', example: 'RQ-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
    { module: '实施评估', code: 'IA', prefix: 'IA-', format: 'IA-NNNNN', example: 'IA-04003', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
    { module: '开发评估', code: 'DV', prefix: 'DV-', format: 'DV-NNNNN', example: 'DV-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
    { module: '资源成本', code: 'RS', prefix: 'RS-', format: 'RS-NNNNN', example: 'RS-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
    { module: '评审', code: 'RV', prefix: 'RV-', format: 'RV-NNNNN', example: 'RV-04001', status: 'draft', activatedAt: null },
  ]

  return (
    <PageShell
      crumb="工作台 / 系统管理"
      title="系统管理"
      subtitle="编码规则 / 模型配置 / RateCard / DSL"
      actions={[
        <button key="prompt" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>✎ 提示词</button>,
      ]}
    >
      <div className="tabs" style={{ marginBottom: 0 }}>
        {tabs.map(t => (
          <span key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} style={{ cursor: 'pointer' }}>
            {t.label}{t.count ? <span className="ct">{t.count}</span> : null}
          </span>
        ))}
      </div>

      <div style={{ padding: '18px 24px' }}>
        {tab === 'rules' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>编码规则</span>
              <div className="right">
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>配置</button>
                <button className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>⌁ 生效</button>
                <button className="btn btn-dan" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>禁用</button>
              </div>
            </div>
            <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              <thead>
                <tr><th>模块</th><th>编码</th><th>前缀</th><th>格式</th><th>示例</th><th>状态</th><th>生效时间</th></tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={i}>
                    <td>{r.module}</td>
                    <td className="mono">{r.code}</td>
                    <td className="mono">{r.prefix}</td>
                    <td className="mono">{r.format}</td>
                    <td className="mono">{r.example}</td>
                    <td>
                      <span className={`bdg ${r.status === 'active' ? 'ci' : 'draft'}`} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                        <span className="dot" />{r.status === 'active' ? '生效中' : '已禁用'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.activatedAt ? r.activatedAt.replace('T', ' ').replace('Z', '') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'model' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>保存草稿</button>
              <button className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>⌁ 生效配置</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  KIMI 评估
                  <span style={{ width: 36, height: 20, borderRadius: 10, background: 'var(--ok)', position: 'relative', cursor: 'pointer' }}>
                    <span style={{ position: 'absolute', top: 2, left: 18, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }} />
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                  {[{ l: '模型', v: 'kimi-k2.5' }, { l: 'Prompt Profile', v: 'default-v1' }, { l: 'Temperature', v: '0.2' }, { l: '最大 Tokens', v: '8192' }].map(f => (
                    <div key={f.l} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{f.l}</label>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{f.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--brand-soft)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '12px 14px', marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink-2)' }}>
                  <span>评估模型用于实施评估与开发评估的自动打标与摘要生成。</span>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px', height: 30 }}>测试连通性</button>
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  文件解析
                  <span style={{ width: 36, height: 20, borderRadius: 10, background: 'var(--ok)', position: 'relative', cursor: 'pointer' }}>
                    <span style={{ position: 'absolute', top: 2, left: 18, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }} />
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                  {[{ l: '模型', v: 'kimi-k2.5' }, { l: 'Prompt Profile', v: 'default-v1' }, { l: 'Temperature', v: '0.1' }, { l: '最大 Tokens', v: '4096' }].map(f => (
                    <div key={f.l} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{f.l}</label>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{f.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--brand-soft)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '12px 14px', marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink-2)' }}>
                  <span>文件解析模型用于 Excel/Word/PDF 的结构化提取与内容解析。</span>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px', height: 30 }}>测试连通性</button>
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>API Key 管理</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', background: 'var(--bg-soft)', padding: '6px 10px', borderRadius: 6, letterSpacing: '.04em' }}>sk-****-****</span>
                <input className="input" style={{ flex: 1, minWidth: 200, maxWidth: 360 }} placeholder="输入新 API Key" />
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>测试连接</button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>改用环境变量</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'rate' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>RateCard · 当前生效</span><div className="right"><button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>编辑</button></div></div>
            <div className="bd">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[{ role: '实施顾问', price: '¥3,200 CNY' }, { role: '架构师', price: '¥4,000 CNY' }, { role: '项目经理', price: '¥4,000 CNY' }, { role: '测试工程师', price: '¥2,800 CNY' }, { role: '开发工程师', price: '¥3,500 CNY' }].map(r => (
                  <div key={r.role} style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{r.role}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{r.price}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'dsl' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>DSL 规则集</span><div className="right"><button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>编辑 JSON</button></div></div>
            <div className="bd">
              <textarea className="input" style={{ minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, width: '100%' }} readOnly defaultValue={`{\n  \"placeholder\": \"DSL JSON 规则集占位\"\n}`} />
            </div>
          </div>
        )}

        {tab === 'tpl' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>模板管理</span></div>
            <div className="bd">
              <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                模板配置即将上线 · 当前占位
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
