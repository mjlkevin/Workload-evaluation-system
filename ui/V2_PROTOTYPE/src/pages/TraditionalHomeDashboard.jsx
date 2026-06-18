import React, { useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import useHomeDashboard from '../hooks/useHomeDashboard.js'
import { apiClient } from '../api/client.js'

const PROJECT_ACTIONS = [
  { key: 'history', label: '🕘 历史', mode: 'always' },
  { key: 'open', label: '打开项目', mode: 'select-any' },
  { key: 'delete', label: '🗑 删除', mode: 'select-any', danger: true },
]

export default function TraditionalHomeDashboard({ embedded = false }) {
  const [selected, setSelected] = useState(new Set())
  const [anchorId, setAnchorId] = useState(null)
  const [dialog, setDialog] = useState(null) // 'new' | 'guide' | 'er' | null
  const [batchLoading, setBatchLoading] = useState(false)
  const [planSearch, setPlanSearch] = useState('')
  const [creatingPlan, setCreatingPlan] = useState(false)
  const [newPlan, setNewPlan] = useState({
    projectName: '',
    customerName: '',
    industry: '',
    userCount: '',
    template: '',
  })

  const { kpi, plans, feed, refetch, remove, create } = useHomeDashboard()
  const filteredPlans = plans.filter((plan) => {
    const q = planSearch.trim().toLowerCase()
    if (!q) return true
    return [
      plan.projectName,
      plan.globalVersion,
      plan.status,
      plan.owner,
      plan.raw?.updatedByUsername,
      plan.raw?.customerName,
      plan.raw?.industry,
    ].some((value) => String(value || '').toLowerCase().includes(q))
  })

  const handleProjectAction = async (key) => {
    const ids = Array.from(selected)
    if (!ids.length && key !== 'history') return
    setBatchLoading(true)
    try {
      for (const id of ids) {
        switch (key) {
          case 'open':
            setDialog('er')
            break
          case 'delete': {
            const plan = plans.find((p) => p.id === id)
            if (plan) await remove(plan.id)
            break
          }
          default: break
        }
      }
      if (key !== 'open') alert(`项目操作 ${key} 完成 · ${ids.length} 条`)
      setSelected(new Set())
      setAnchorId(null)
      refetch()
    } catch (err) {
      alert(err?.message || '批量操作失败')
    } finally {
      setBatchLoading(false)
    }
  }

  // PB-R1 标准行选择
  const handleRowClick = (e, row, idx) => {
    const id = row.id
    const ids = filteredPlans.map((p) => p.id)
    if (e.shiftKey && anchorId !== null && ids.includes(anchorId)) {
      const a = ids.indexOf(anchorId), b = idx
      const [s, t] = a <= b ? [a, b] : [b, a]
      const next = new Set()
      for (let i = s; i <= t; i++) next.add(ids[i])
      setSelected(next)
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id); else next.add(id)
      setSelected(next)
      setAnchorId(id)
    } else {
      setSelected(new Set([id]))
      setAnchorId(id)
    }
  }

  const selectedRows = plans.filter((p) => selected.has(p.id))
  const isProjectActionEnabled = (mode) => {
    if (mode === 'always') return true
    if (selectedRows.length === 0) return false
    if (mode === 'select-any') return true
    return false
  }

  const handleCreatePlan = async () => {
    setCreatingPlan(true)
    try {
      await create(newPlan)
      setNewPlan({ projectName: '', customerName: '', industry: '', userCount: '', template: '' })
      setSelected(new Set())
      setAnchorId(null)
      setDialog('guide')
    } catch (err) {
      alert(err?.message || '创建失败')
    } finally {
      setCreatingPlan(false)
    }
  }

  const pageActions = [
    <button type="button" key="new" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => setDialog('new')}>+ 新建</button>,
  ]

  const content = (
    <>
      <div className="home-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* KPI */}
          <div className="home-kpi">
            {kpi.map((k, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 6, background: k.icBg || 'var(--brand-soft)', color: k.icCo || 'var(--brand-ink)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{k.ic}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{k.lb}</span>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', marginLeft: 'auto' }} />
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1.05, marginBottom: 4 }}>{k.num}</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>{k.lb}</div>
                <div style={{ height: 4, borderRadius: 999, background: 'var(--bg-soft)', marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: k.bar, borderRadius: 999, background: `linear-gradient(90deg,${k.icCo || 'var(--brand)'},var(--accent))` }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-2)' }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Plan list with VCS 9-toolbar (§6.3.1) */}
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>项目评估方案列表</span>
              <span className="bdg ci" style={{ fontSize: 10.5, padding: '1px 6px' }}><span className="dot" />草稿 {plans.filter((p) => p.status === '草稿').length}</span>
              <span className="bdg co" style={{ fontSize: 10.5, padding: '1px 6px' }}><span className="dot" />进行中 {plans.filter((p) => p.status === '进行中').length}</span>
              <div className="right"><span style={{ fontSize: 11 }}>共 {plans.length} 条 · 已选 {selected.size}</span></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)', fontSize: 12, flexWrap: 'wrap' }}>
              <span
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: selected.size > 0 ? 'var(--brand-ink)' : 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, padding: '0 4px', cursor: selected.size > 0 ? 'pointer' : 'default' }}
                onClick={selected.size > 0 ? () => { setSelected(new Set()); setAnchorId(null) } : undefined}
              >已选 {selected.size}</span>
              <div style={{ display: 'flex', gap: 2, paddingRight: 10, borderRight: '1px solid var(--line)' }}>
                {PROJECT_ACTIONS.map((b) => {
                  const enabled = isProjectActionEnabled(b.mode)
                  return (
                    <button type="button"
                      key={b.key}
                      onClick={() => enabled && !batchLoading && handleProjectAction(b.key)}
                      disabled={!enabled}
                      style={{
                        padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        color: b.danger ? 'var(--err)' : 'var(--ink-2)',
                        background: 'transparent', border: 'none', cursor: enabled ? 'pointer' : 'not-allowed',
                        opacity: enabled && !batchLoading ? 1 : 0.45, fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >{b.label}</button>
                  )
                })}
              </div>
              <button type="button"
                onClick={() => setDialog('er')}
                style={{ padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >🔗 ER</button>
              <button type="button"
                onClick={() => refetch()}
                className="btn btn-out"
                style={{ height: 28, fontSize: 12, padding: '0 10px' }}
              >⟳ 刷新</button>
              <button type="button"
                onClick={() => setDialog('new')}
                className="btn btn-pri"
                style={{ marginLeft: 4, height: 28, fontSize: 12, padding: '0 12px' }}
              >＋ 新建</button>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-2)' }}>状态：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>全部</b><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-2)' }}>行业：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>制造业</b><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span></span>
                <input
                  type="text"
                  placeholder="⌕ 搜索项目 / 客户 / 负责人"
                  value={planSearch}
                  onChange={(e) => {
                    setPlanSearch(e.target.value)
                    setSelected(new Set())
                    setAnchorId(null)
                  }}
                  style={{ padding: '5px 10px', borderRadius: 5, background: '#fff', border: '1px solid var(--line)', fontSize: 12, color: 'var(--ink)', minWidth: 220, fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
            </div>
            <table className="table" style={{ borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
              <thead>
                <tr>
                  <th style={{ width: 38 }}>#</th>
                  <th>项目名称</th>
                  <th>项目编号</th>
                  <th>状态</th>
                  <th>客户</th>
                  <th className="num">人天</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlans.map((p, i) => {
                  const isSel = selected.has(p.id)
                  return (
                    <tr
                      key={p.id}
                      onClick={(e) => handleRowClick(e, p, i)}
                      onDoubleClick={() => setDialog('er')}
                      style={{
                        cursor: 'pointer',
                        background: isSel ? 'var(--brand-soft)' : undefined,
                        userSelect: 'none',
                      }}
                    >
                      <td>{i + 1}</td>
                      <td>
                        <b>{p.projectName}</b>
                        <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>{p.globalVersion}</div>
                      </td>
                      <td className="mono" style={{ fontFamily: 'var(--font-mono)' }}>{p.globalVersion.replace('GL-', 'v')}</td>
                      <td>
                        <span className={`bdg ${p.status === '进行中' ? 'co' : p.status === '待评审' ? 'rev' : 'ci'}`} style={{ fontSize: 10.5 }}>
                          <span className="dot" />{p.status}
                        </span>
                      </td>
                      <td>
                        {p.customerName || p.raw?.customerName || '—'}
                      </td>
                      <td className="num">{p.mandays}</td>
                      <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.updatedAt || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredPlans.length === 0 && (
            <div style={{ padding: '18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, borderTop: '1px solid var(--line)' }}>
              未找到匹配的项目评估
            </div>
          )}
        </div>

        {/* Side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>快速操作</div>
            {[
              { t: '新建项目评估', dlg: 'new' },
              { t: '导入需求访谈纪要', dlg: null },
              { t: '发起评审', dlg: null },
              { t: '查看 ER 关联图', dlg: 'er' },
            ].map((q) => (
              <a key={q.t} href="#" onClick={(e) => { e.preventDefault(); q.dlg && setDialog(q.dlg) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', color: 'var(--ink)', textDecoration: 'none', fontSize: 12.5, borderBottom: '1px solid var(--line)' }}>
                {q.t}<span style={{ color: 'var(--ink-3)', fontSize: 11 }}>→</span>
              </a>
            ))}
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>最近动态</div>
            {feed.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: f.accent ? 'var(--accent-soft)' : 'var(--brand-soft)', color: f.accent ? 'var(--accent-ink)' : 'var(--brand-ink)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{f.name[0]}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                  <b style={{ color: 'var(--ink)' }}>{f.name}</b> {f.action}
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{f.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3 Dialogs · §6.3 D1/D2/D3 */}
      {dialog === 'new' && (
        <DialogShell title="新建项目评估" onClose={() => setDialog(null)} onConfirm={handleCreatePlan} confirmLabel={creatingPlan ? '创建中…' : '下一步：创建'} confirmDisabled={creatingPlan}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)' }}>请填写项目评估基础信息</p>
          <Field label="项目名称" placeholder="如：利民集团数字化二期" value={newPlan.projectName} onChange={(value) => setNewPlan((p) => ({ ...p, projectName: value }))} />
          <Field label="客户名称" placeholder="如：利民集团" value={newPlan.customerName} onChange={(value) => setNewPlan((p) => ({ ...p, customerName: value }))} />
          <Field label="客户行业" placeholder="制造-离散 / 流程 / 零售..." value={newPlan.industry} onChange={(value) => setNewPlan((p) => ({ ...p, industry: value }))} />
          <Field label="规模（用户数）" placeholder="100" value={newPlan.userCount} onChange={(value) => setNewPlan((p) => ({ ...p, userCount: value }))} />
          <Field label="模板" placeholder="实施评估标准版" value={newPlan.template} onChange={(value) => setNewPlan((p) => ({ ...p, template: value }))} />
        </DialogShell>
      )}
      {dialog === 'guide' && (
        <DialogShell title="✓ 创建成功" onClose={() => setDialog(null)} onConfirm={() => setDialog(null)} confirmLabel="知道了">
          <div style={{ background: 'var(--ok-soft)', border: '1px solid var(--ok)', borderRadius: 'var(--r-md)', padding: '12px 14px', marginBottom: 12, fontSize: 13, color: 'var(--ok-ink)' }}>
            ✓ 新方案已创建
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>下一步建议：</p>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.8 }}>
            <li>录入 / 导入需求访谈纪要</li>
            <li>选择实施评估模板生成 SKU 主表</li>
            <li>检出方案进入实施评估编辑态</li>
            <li>校验 DSL 规则、提交评审</li>
          </ol>
        </DialogShell>
      )}
      {dialog === 'er' && (
        <DialogShell title="🔗 ER 关联关系图" onClose={() => setDialog(null)} onConfirm={() => setDialog(null)} confirmLabel="关闭" wide>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--ink-3)' }}>方案 / 需求 / 实施评估 / 资源成本 / 开发评估 五者关系</p>
          <svg viewBox="0 0 600 400" width="100%" height="320" style={{ border: '1px dashed var(--line)', borderRadius: 'var(--r-md)', background: 'var(--bg-soft)' }}>
            {[
              { x: 300, y: 60, label: '总方案', color: 'var(--brand)' },
              { x: 130, y: 180, label: '需求', color: 'var(--accent)' },
              { x: 470, y: 180, label: '实施评估', color: 'var(--brand)' },
              { x: 130, y: 320, label: '资源成本', color: 'var(--teal)' },
              { x: 470, y: 320, label: '开发评估', color: 'var(--ok)' },
            ].map((n, i) => (
              <g key={i}>
                <rect x={n.x - 50} y={n.y - 18} width={100} height={36} rx={8} fill={n.color} />
                <text x={n.x} y={n.y + 4} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700">{n.label}</text>
              </g>
            ))}
            {[
              [300, 78, 130, 162], [300, 78, 470, 162],
              [470, 198, 470, 302], [130, 198, 130, 302],
              [180, 180, 420, 180],
            ].map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line-2)" strokeWidth="1.5" />
            ))}
          </svg>
        </DialogShell>
      )}
    </>
  )

  if (embedded) return content

  return (
    <PageShell
      crumb="工作台 / 主页"
      title="主页"
      actions={pageActions}
    >
      {content}
    </PageShell>
  )
}

// ---- 内联 Dialog shell（避免新增公共依赖） ----
function DialogShell({ title, children, onClose, onConfirm, confirmLabel = '确认', confirmDisabled = false, wide = false }) {
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)',
        display: 'grid', placeItems: 'center', padding: 20, zIndex: 50,
      }}
    >
      <div style={{
        width: wide ? 'min(720px, 100%)' : 'min(480px, 100%)',
        background: '#fff', borderRadius: 'var(--r-lg)',
        boxShadow: '0 24px 64px rgba(15,23,42,0.24)', border: '1px solid var(--line)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontSize: 14, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{title}</span>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 18, color: 'var(--ink-3)', padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg-soft)' }}>
          <button type="button" onClick={onClose} className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }}>取消</button>
          <button type="button" onClick={onConfirm} disabled={confirmDisabled} className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px', opacity: confirmDisabled ? 0.7 : 1 }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, placeholder, value, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          width: '100%', padding: '8px 10px', border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
        }}
      />
    </div>
  )
}
