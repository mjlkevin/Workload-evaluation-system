import React, { useEffect, useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import useSystemManagement from '../hooks/useSystemManagement.js'

const PROMPT_TABS = [
  { key: 'assessment', label: '评估提示词' },
  { key: 'parse', label: '文件解析提示词' },
  { key: 'generate', label: '生成提示词' },
]

export default function SystemManagement() {
  const {
    rules, models, apiKey, setApiKey, ratecard,
    dslRules, templates, prompts, setPrompts,
    actionLoading,
    actions,
  } = useSystemManagement()

  const [tab, setTab] = useState('rules')
  const [dialog, setDialog] = useState(null) // 'prompt' | null
  const [promptTab, setPromptTab] = useState('assessment')
  const [promptResult, setPromptResult] = useState(null)
  const [selectedRuleCode, setSelectedRuleCode] = useState('')

  const tabs = [
    { id: 'rules', label: '编码规则', count: rules.length },
    { id: 'model', label: '模型配置' },
    { id: 'rate', label: 'RateCard' },
    { id: 'dsl', label: 'DSL 规则集' },
    { id: 'tpl', label: '模板' },
  ]
  const selectedRule = rules.find((rule) => rule.code === selectedRuleCode) || rules[0]

  useEffect(() => {
    if (!selectedRuleCode && rules[0]?.code) setSelectedRuleCode(rules[0].code)
  }, [rules, selectedRuleCode])

  return (
    <PageShell
      crumb="工作台 / 系统管理"
      title="系统管理"
      subtitle="编码规则 / 模型配置 / RateCard / DSL"
      actions={[
        <button type="button"
          key="prompt"
          className="btn btn-ghost"
          style={{ height: 32, fontSize: 12, padding: '0 12px' }}
          onClick={() => setDialog('prompt')}
        >
          ✎ 提示词
        </button>,
      ]}
    >
      <div className="system-tabs" role="tablist" aria-label="系统管理配置分类">
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={active}
              className={active ? 'system-tab on' : 'system-tab'}
              onClick={() => setTab(t.id)}
            >
              <span>{t.label}</span>
              {t.count ? <span className="ct">{t.count}</span> : null}
            </button>
          )
        })}
      </div>

      <div style={{ padding: '18px 24px' }}>
        {tab === 'rules' && (
          <div className="section system-card" style={{ margin: 0 }}>
            <div className="hd">
              <span>版本号编码规则</span>
              <span className="bdg ci" style={{ fontSize: 10, padding: '1px 6px' }}><span className="dot" />当前生效 v3</span>
              <div className="right">
                <button type="button" className="btn btn-out" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.configureRule(selectedRule?.code || '')}>
                  配置
                </button>
                <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.activateRule(selectedRule?.code || '')}>
                  ⌁ 生效
                </button>
                <button type="button" className="btn btn-dan" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.disableRule(selectedRule?.code || '')}>
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
                {rules.map((r, i) => {
                  const selected = selectedRule?.code === r.code
                  return (
                  <tr
                    key={i}
                    className={selected ? 'row-selected' : ''}
                    onClick={() => setSelectedRuleCode(r.code)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedRuleCode(r.code) }}
                    aria-selected={selected}
                    style={{ cursor: 'pointer' }}
                  >
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
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'model' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.saveModelDraft()} disabled={actionLoading.saveModelDraft}>
                {actionLoading.saveModelDraft ? '...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.activateModel()} disabled={actionLoading.activateModel}>
                {actionLoading.activateModel ? '...' : '⌁ 生效配置'}
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
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px', height: 30 }} onClick={() => actions.testApiKey()}>
                      {actionLoading.testApiKey ? '...' : '测试连通性'}
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
                  {apiKey ? 'sk-****-****' : '（未配置）'}
                </span>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                  placeholder="输入新 API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.testApiKey(apiKey)}>
                  测试连接
                </button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => setApiKey('')}>
                  清除
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
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  编辑
                </button>
              </div>
            </div>
            <div className="bd">
              <div className="grid-3-eq">
                {ratecard.map((r) => (
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
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.saveDslDraft()}>
                  保存草稿
                </button>
                <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.activateDsl()}>
                  ⌁ 生效
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
                        <input type="checkbox" checked={r.enabled} onChange={() => actions.toggleDsl(r.id)} />
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
                    <button type="button"
                      className="btn btn-pri"
                      style={{ height: 30, fontSize: 12, padding: '0 12px', marginTop: 4 }}
                      onClick={() => actions.useTemplate(t.name)}
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
            {promptResult && (
              <div style={{marginBottom:12,padding:12,background:'var(--bg-soft)',border:'1px solid var(--line)',borderRadius:'var(--r-md)',maxHeight:200,overflowY:'auto'}}>
                <pre style={{margin:0,fontSize:11,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'var(--font-mono)'}}>{JSON.stringify(promptResult, null, 2)}</pre>
              </div>
            )}
            <DialogActions>
              <button type="button" className="btn btn-ghost" style={{ height: 30, fontSize: 12, padding: '0 14px' }} disabled={actionLoading.testPrompt} onClick={async () => {
                const r = await actions.testPrompt(prompts[promptTab])
                if (r) setPromptResult(r)
              }}>
                {actionLoading.testPrompt ? '测试中...' : '测试'}
              </button>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => { setDialog(null); setPromptResult(null) }}>
                取消
              </button>
              <button type="button"
                className="btn btn-pri"
                style={{ height: 30, fontSize: 12, padding: '0 14px' }}
                disabled={actionLoading.savePrompts}
                onClick={async () => {
                  await actions.savePrompts()
                  setDialog(null)
                  setPromptResult(null)
                }}
              >
                {actionLoading.savePrompts ? '保存中...' : '保存'}
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
