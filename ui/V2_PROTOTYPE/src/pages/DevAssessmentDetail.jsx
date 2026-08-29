import React, { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import useDevAssessmentDetail from '../hooks/useDevAssessmentDetail.js'

const AI_MENU = [
  { key: 'sku', label: '按 SKU 推断子项' },
  { key: 'history', label: '按历史项目补充' },
]

export default function DevAssessmentDetail() {
  const { id } = useParams()
  const detail = useDevAssessmentDetail({ id })
  const { items = [], groups = [], actions, actionLoading } = detail

  const [currentUser, setCurrentUser] = useState('admin')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const aiRef = useRef(null)

  // 点击外部关闭 AI 菜单
  useEffect(() => {
    function onDocClick(e) {
      if (aiRef.current && !aiRef.current.contains(e.target)) setAiOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  // RBAC 判定
  const canSave = currentUser === 'admin' || currentUser === 'dev'
  const canMerge = currentUser === 'admin'
  const canAi = currentUser === 'admin' || currentUser === 'dev'

  const disabledTip = (label) => `无权限 · 当前角色：${currentUser}`

  function renderBar(n) {
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            style={{
              width: 14,
              height: 10,
              borderRadius: 3,
              background: i < n ? 'linear-gradient(180deg,var(--brand),var(--brand-2))' : 'var(--line-2)',
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <PageShell
      crumb="工作台 / 开发评估 / 开发评估详情"
      title="开发评估详情"
      actions={[
        // 角色切换（开发测试）
        <select
          key="role"
          value={currentUser}
          onChange={(e) => setCurrentUser(e.target.value)}
          style={{
            height: 32,
            fontSize: 12,
            padding: '0 8px',
            borderRadius: 6,
            border: '1px solid var(--line)',
            background: '#fff',
            fontFamily: 'inherit',
            color: 'var(--ink)',
          }}
        >
          <option value="admin">admin</option>
          <option value="dev">dev</option>
          <option value="viewer">viewer</option>
        </select>,

        // AI 生成 紫族下拉
        <div key="ai-wrap" ref={aiRef} style={{ position: 'relative' }}>
          <button type="button"
            className="btn"
            onClick={() => setAiOpen((v) => !v)}
            disabled={!canAi}
            title={!canAi ? disabledTip('AI 生成') : undefined}
            style={{
              height: 32,
              fontSize: 12,
              padding: '0 12px',
              background: canAi
                ? 'linear-gradient(135deg, oklch(.55 .22 295), oklch(.62 .20 320))'
                : 'var(--bg-soft)',
              color: canAi ? '#fff' : 'var(--ink-3)',
              border: 'none',
              borderRadius: 6,
              cursor: canAi ? 'pointer' : 'not-allowed',
              boxShadow: canAi ? '0 2px 8px oklch(.55 .22 320 / .35)' : 'none',
              fontFamily: 'inherit',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>✦</span> AI 生成 <span>▾</span>
          </button>
          {aiOpen && canAi && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                background: '#fff',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shadow-2)',
                minWidth: 180,
                zIndex: 20,
                overflow: 'hidden',
              }}
            >
              {AI_MENU.map((m) => (
                <button type="button"
                  key={m.key}
                  disabled={actionLoading.aiSkuSuggest || actionLoading.aiHistorySuggest}
                  onClick={async () => {
                    setAiOpen(false)
                    const r = m.key === 'sku'
                      ? await actions.aiSkuSuggest?.()
                      : await actions.aiHistorySuggest?.()
                    if (r) setAiResult({ type: m.key, label: m.label, data: r })
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    color: 'var(--ink)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-soft)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>,

        <button type="button"
          key="export"
          className="btn btn-ghost"
          style={{ height: 32, fontSize: 12, padding: '0 12px' }}
        >
          ↓ 导出 CSV
        </button>,
        <button type="button"
          key="merge"
          className="btn btn-ghost"
          disabled={!canMerge}
          title={!canMerge ? disabledTip('合并') : undefined}
          style={{ height: 32, fontSize: 12, padding: '0 12px', opacity: canMerge ? 1 : 0.5, cursor: canMerge ? 'pointer' : 'not-allowed' }}
          onClick={() => canMerge && actions.merge()}
        >
          ⌥ 合并到实施评估
        </button>,
        <button type="button"
          key="save"
          className="btn btn-pri"
          disabled={!canSave}
          title={!canSave ? disabledTip('保存') : undefined}
          style={{ height: 32, fontSize: 12, padding: '0 12px', opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
          onClick={() => canSave && actions.save()}
        >
          ⤒ 保存
        </button>,
      ]}
    >
      <div
        style={{
          display: 'grid',
          className: 'grid-3-eq',
          gap: 12,
          padding: '12px 18px',
          background: 'var(--bg-soft)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            总方案版本
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{detail.code || detail.version || '—'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            关联实施评估
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{detail.assessmentCode || '—'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            评估人
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{detail.evaluator || '—'}</div>
        </div>
      </div>

      <div className="section" style={{ margin: '16px 18px 18px' }}>
        <div className="hd">
          <span>开发子项明细</span>
          <span className="bdg ci">
            <span className="dot" />{items.length} 项 / {groups.length} 组
          </span>
        </div>
        <div className="bd" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="sys-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>分组</th>
                  <th>子项</th>
                  <th style={{ width: 150 }}>基础人天</th>
                  <th style={{ width: 90 }}>难度</th>
                  <th style={{ width: 170 }}>系数后</th>
                  <th style={{ width: 96 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g}>
                    <tr style={{ background: '#fbfbff', fontWeight: 800, color: 'var(--ink)' }}>
                      <td colSpan={6}>
                        {g}{' '}
                        <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                          · {items.filter((x) => x.group === g).length} 项
                        </span>
                      </td>
                    </tr>
                    {items.filter((x) => x.group === g).map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{g}</span>
                        </td>
                        <td>{it.name}</td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <button type="button"
                              style={{
                                width: 22,
                                height: 22,
                                border: '1px solid var(--line)',
                                background: '#fff',
                                borderRadius: 6,
                                color: 'var(--ink)',
                                cursor: 'pointer',
                              }}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              defaultValue={it.base}
                              style={{
                                width: 38,
                                textAlign: 'center',
                                border: '1px solid var(--line)',
                                borderRadius: 6,
                                padding: '4px 0',
                                font: '600 12px/1 var(--font-mono)',
                                color: 'var(--ink)',
                              }}
                            />
                            <button type="button"
                              style={{
                                width: 22,
                                height: 22,
                                border: '1px solid var(--line)',
                                background: '#fff',
                                borderRadius: 6,
                                color: 'var(--ink)',
                                cursor: 'pointer',
                              }}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td>{renderBar(it.diff)}</td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                            {it.base} × {it.factor} = {(it.base * it.factor).toFixed(2)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`bdg ${
                              it.status === '已完成' ? 'ok' : it.status === '进行中' ? 'ci' : 'rev'
                            }`}
                          >
                            <span className="dot" />
                            {it.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div
          style={{
            padding: '10px 18px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--ink-3)',
            fontSize: 11.5,
            background: 'var(--bg-soft)',
          }}
        >
          <span>vcs-bar · 主次分层浅条</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>基线：dev-2026.04.18</span>
        </div>
      </div>
      {/* AI Result Modal */}
      {aiResult && (
        <div onClick={e => e.target === e.currentTarget && setAiResult(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.42)',display:'grid',placeItems:'center',padding:20,zIndex:50}}>
          <div style={{width:'min(720px, 100%)',background:'#fff',borderRadius:'var(--r-lg)',boxShadow:'0 24px 64px rgba(15,23,42,0.24)',border:'1px solid var(--line)',padding:18,maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <strong style={{fontSize:14}}>✦ AI 结果 · {aiResult.label}</strong>
              <button type="button" className="btn btn-ghost" style={{height:28,fontSize:12,padding:'0 10px'}} onClick={() => setAiResult(null)}>✕ 关闭</button>
            </div>
            <div style={{overflowY:'auto',flex:1}}>
              {aiResult.type === 'sku' ? (
                <pre style={{margin:0,fontSize:11,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'var(--font-mono)'}}>{JSON.stringify(aiResult.data, null, 2)}</pre>
              ) : (
                <table className="table" style={{width:'100%'}}>
                  <thead><tr><th>行业</th><th>规模</th><th>预估人天</th><th>模块</th></tr></thead>
                  <tbody>
                    {(Array.isArray(aiResult.data) ? aiResult.data : []).map((p, i) => (
                      <tr key={i}><td>{p.industry || '—'}</td><td>{p.scale || '—'}</td><td>{p.estimatedDays ?? '—'}</td><td>{(p.modules || []).join(', ') || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
