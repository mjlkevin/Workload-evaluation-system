import React, { useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

const INITIAL_RULES = [
  { id: 'R1', type: 'blocking', message: '需求条目必须关联至少一个业务模块', enabled: true },
  { id: 'R2', type: 'blocking', message: '评估人天不得低于基准值的 80%', enabled: true },
  { id: 'R3', type: 'warning', message: '多组织推广估算应提供相似度依据', enabled: true },
  { id: 'R4', type: 'warning', message: '资源成本与实施评估差额超过 10% 需说明', enabled: false },
  { id: 'R5', type: 'blocking', message: '评审通过前必须完成全部 checklist', enabled: true },
]

const INITIAL_TEMPLATES = [
  { id: 'T1', name: '实施评估标准版', desc: '适用于中大型离散制造项目，含 120+ SKU 条目。', tags: ['制造', '标准实施'] },
  { id: 'T2', name: '快速交付轻量版', desc: '适用于 200 人以下组织，快速上线场景。', tags: ['轻量', '快速交付'] },
  { id: 'T3', name: '定制开发扩展版', desc: '含接口开发、报表定制、第三方集成评估。', tags: ['定制', '扩展'] },
]

const PROMPT_TABS = [
  { key: 'assessment', label: '评估提示词' },
  { key: 'parse', label: '文件解析提示词' },
  { key: 'generate', label: '生成提示词' },
]

const INITIAL_PROMPTS = {
  assessment: '你是一位资深 ERP 实施评估专家。请根据客户提供的需求访谈纪要，提取关键业务模块、评估复杂度并输出 SKU 主表。',
  parse: '你是一位文档解析专家。请从上传的 Excel/Word/PDF 中提取结构化需求条目，识别业务模块、约束条件与关键干系人。',
  generate: '你是一位技术方案生成专家。请基于已确认的 SKU 主表与资源成本，生成五段叙事方案与 SOW 草案。',
}

export default function SystemManagement() {
  const [tab, setTab] = useState('rules')
  const [dialog, setDialog] = useState(null) // 'prompt' | null
  const [promptTab, setPromptTab] = useState('assessment')
  const [prompts, setPrompts] = useState(INITIAL_PROMPTS)
  const [dslRules, setDslRules] = useState(INITIAL_RULES)
  const [templates] = useState(INITIAL_TEMPLATES)

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

  const models = [
    { name: 'KIMI 评估', status: 'online', endpoint: 'https://api.moonshot.cn/v1/chat/completions', profile: 'default-v1', temp: '0.2', tokens: '8192', desc: '用于实施评估与开发评估的自动打标与摘要生成。' },
    { name: '文件解析', status: 'online', endpoint: 'https://api.moonshot.cn/v1/files', profile: 'default-v1', temp: '0.1', tokens: '4096', desc: '用于 Excel/Word/PDF 的结构化提取与内容解析。' },
    { name: '生成模型', status: 'offline', endpoint: 'https://api.moonshot.cn/v1/generate', profile: 'generate-v1', temp: '0.3', tokens: '8192', desc: '用于方案生成、五段叙事与 SOW 草案自动撰写。' },
  ]

  const toggleDsl = (id) => {
    setDslRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
  }

  return (
    <PageShell
      crumb="工作台 / 系统管理"
      title="系统管理"
      subtitle="编码规则 / 模型配置 / RateCard / DSL"
      actions={[
        <button
          key="prompt"
          className="btn btn-ghost"
          style={{ height: 32, fontSize: 12, padding: '0 12px' }}
          onClick={() => setDialog('prompt')}
        >
          ✎ 提示词
        </button>,
      ]}
    >
      <div className="tabs" style={{ marginBottom: 0 }}>
        {tabs.map((t) => (
          <span
            key={t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
            style={{ cursor: 'pointer' }}
          >
            {t.label}
            {t.count ? <span className="ct">{t.count}</span> : null}
          </span>
        ))}
      </div>

      <div style={{ padding: '18px 24px' }}>
        {tab === 'rules' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>编码规则</span>
              <div className="right">
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  配置
                </button>
                <button className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  ⌁ 生效
                </button>
                <button className="btn btn-dan" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  禁用
                </button>
              </div>
            </div>
            <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              <thead>
                <tr>
                  <th>模块</th>
                  <th>编码</th>
                  <th>前缀</th>
                  <th>格式</th>
                  <th>示例</th>
                  <th>状态</th>
                  <th>生效时间</th>
                </tr>
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
                        <span className="dot" />
                        {r.status === 'active' ? '生效中' : '已禁用'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {r.activatedAt ? r.activatedAt.replace('T', ' ').replace('Z', '') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'model' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                保存草稿
              </button>
              <button className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                ⌁ 生效配置
              </button>
            </div>
            <div className="grid-3-eq" style={{ gap: 16 }}>
              {models.map((m) => (
                <div
                  key={m.name}
                  style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16 }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {m.name}
                    <span
                      className="bdg"
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        background: m.status === 'online' ? 'var(--ok-soft)' : 'var(--err-soft)',
                        color: m.status === 'online' ? 'var(--ok)' : 'var(--err)',
                      }}
                    >
                      <span className="dot" style={{ background: m.status === 'online' ? 'var(--ok)' : 'var(--err)' }} />
                      {m.status === 'online' ? '连通 ✓' : '离线 ✗'}
                    </span>
                  </div>
                  <div className="grid-2-eq" style={{ marginTop: 10 }}>
                    {[
                      { l: '模型', v: 'kimi-k2.5' },
                      { l: 'Prompt Profile', v: m.profile },
                      { l: 'Temperature', v: m.temp },
                      { l: '最大 Tokens', v: m.tokens },
                    ].map((f) => (
                      <div key={f.l} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label
                          style={{
                            fontSize: 11,
                            color: 'var(--ink-3)',
                            fontFamily: 'var(--font-mono)',
                            textTransform: 'uppercase',
                            letterSpacing: '.06em',
                            fontWeight: 700,
                          }}
                        >
                          {f.l}
                        </label>
                        <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{f.v}</div>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      background: 'var(--brand-soft)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      padding: '12px 14px',
                      marginTop: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 12,
                      color: 'var(--ink-2)',
                    }}
                  >
                    <span>{m.desc}</span>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px', height: 30 }}>
                      测试连通性
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16, marginTop: 16 }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>API Key 管理</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    color: 'var(--ink)',
                    background: 'var(--bg-soft)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    letterSpacing: '.04em',
                  }}
                >
                  sk-****-****
                </span>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                  placeholder="输入新 API Key"
                />
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  测试连接
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  改用环境变量
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'rate' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>RateCard · 当前生效</span>
              <div className="right">
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  编辑
                </button>
              </div>
            </div>
            <div className="bd">
              <div className="grid-3-eq">
                {[
                  { role: '实施顾问', price: '¥3,200 CNY' },
                  { role: '架构师', price: '¥4,000 CNY' },
                  { role: '项目经理', price: '¥4,000 CNY' },
                  { role: '测试工程师', price: '¥2,800 CNY' },
                  { role: '开发工程师', price: '¥3,500 CNY' },
                ].map((r) => (
                  <div
                    key={r.role}
                    style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}
                  >
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
            <div className="hd">
              <span>DSL 规则集</span>
              <div className="right">
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  编辑 JSON
                </button>
              </div>
            </div>
            <div className="bd" style={{ padding: 0 }}>
              <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>启用</th>
                    <th>规则 ID</th>
                    <th>类型</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {dslRules.map((r) => (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={r.enabled} onChange={() => toggleDsl(r.id)} />
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{r.id}</td>
                      <td>
                        <span
                          className="bdg"
                          style={{
                            fontSize: 10.5,
                            padding: '1px 6px',
                            background: r.type === 'blocking' ? 'var(--err-soft)' : 'var(--warn-soft)',
                            color: r.type === 'blocking' ? 'var(--err)' : 'var(--warn-ink)',
                          }}
                        >
                          {r.type === 'blocking' ? '阻断' : '警告'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'tpl' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>模板管理</span>
            </div>
            <div className="bd">
              <div className="grid-3-eq">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      background: 'var(--bg-soft)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-lg)',
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6, flex: 1 }}>{t.desc}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bdg"
                          style={{ fontSize: 10, padding: '1px 6px', background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      className="btn btn-pri"
                      style={{ height: 30, fontSize: 12, padding: '0 12px', marginTop: 4 }}
                      onClick={() => alert(`Phase A · mock 占位 · 已使用模板「${t.name}」`)}
                    >
                      使用
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 提示词 dialog */}
      {dialog === 'prompt' && (
        <DialogBackdrop onClose={() => setDialog(null)}>
          <DialogCard title="✎ 提示词管理" wide>
            <div className="tabs" style={{ marginBottom: 12 }}>
              {PROMPT_TABS.map((t) => (
                <span
                  key={t.key}
                  className={promptTab === t.key ? 'on' : ''}
                  onClick={() => setPromptTab(t.key)}
                  style={{ cursor: 'pointer' }}
                >
                  {t.label}
                </span>
              ))}
            </div>
            <textarea
              value={prompts[promptTab]}
              onChange={(e) =>
                setPrompts((prev) => ({ ...prev, [promptTab]: e.target.value }))
              }
              style={{
                width: '100%',
                minHeight: 200,
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.6,
                outline: 'none',
                resize: 'vertical',
              }}
            />
            <DialogActions>
              <button className="btn btn-ghost" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => alert('Phase A · mock 占位 · [测试提示词]')}>
                测试
              </button>
              <button className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
                取消
              </button>
              <button
                className="btn btn-pri"
                style={{ height: 30, fontSize: 12, padding: '0 14px' }}
                onClick={() => {
                  alert('Phase A · mock 占位 · [保存提示词]')
                  setDialog(null)
                }}
              >
                保存
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

function DialogCard({ title, wide, children }) {
  return (
    <div
      style={{
        width: wide ? 'min(720px, 100%)' : 'min(480px, 100%)',
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
