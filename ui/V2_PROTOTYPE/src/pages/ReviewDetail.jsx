import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'

const SEALS = [
  { id: 'S1', name: 'WES 公章 · 标准', scope: '通用' },
  { id: 'S2', name: '实施总监印 · 王丽', scope: '实施' },
  { id: 'S3', name: '交付经理印 · 张鹏', scope: '交付' },
]

export default function ReviewDetail() {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [sealTarget, setSealTarget] = useState(null) // deliverable id 或 null
  const [pickedSeal, setPickedSeal] = useState(SEALS[0].id)
  const [deliverables, setDeliverables] = useState([
    { id: 'D1', name: '实施 SOW', type: 'PDF', status: 'pending', generatedAt: '', sealName: '' },
    { id: 'D2', name: '详细实施方案', type: 'DOCX', status: 'pending', generatedAt: '', sealName: '' },
    { id: 'D3', name: '实施计划', type: 'MD', status: 'pending', generatedAt: '', sealName: '' },
    { id: 'D4', name: '对外报价单', type: 'XLSX', status: 'pending', generatedAt: '', sealName: '' },
  ])

  const checklist = [
    { type: '必检', name: '接口覆盖完整', status: '通过' },
    { type: '必检', name: '权限校验齐备', status: '通过' },
    { type: '必检', name: '关键异常处理', status: '通过' },
    { type: '建议', name: '命名统一性', status: '待审' },
    { type: '建议', name: '日志粒度', status: '待审' },
  ]

  const comments = [
    { name: '王丽', time: '2026-04-18 09:20', text: '方案覆盖度较好，但审批流异常分支需要再补充。' },
    { name: '陈晨', time: '2026-04-18 10:05', text: '收到，今天补齐后重新提交。' },
  ]

  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ')
  const genOne = (id) => setDeliverables((d) => d.map((x) => x.id === id ? { ...x, status: 'generated', generatedAt: now() } : x))
  const genAll = () => setDeliverables((d) => d.map((x) => x.status === 'pending' ? { ...x, status: 'generated', generatedAt: now() } : x))
  const sealConfirm = () => {
    if (!sealTarget) return
    const seal = SEALS.find((s) => s.id === pickedSeal) || SEALS[0]
    setDeliverables((d) => d.map((x) => x.id === sealTarget ? { ...x, status: 'sealed', sealName: seal.name } : x))
    setSealTarget(null)
  }
  const rejectConfirm = () => {
    if (!rejectReason.trim()) { alert('请输入驳回原因'); return }
    alert('已驳回 · ' + rejectReason)
    setRejectReason(''); setRejectOpen(false)
  }
  const pendingCount = deliverables.filter((d) => d.status === 'pending').length

  const typeMap = {
    PDF: { bg: 'var(--info-soft)', co: 'var(--info)' },
    DOCX: { bg: 'var(--brand-soft)', co: 'var(--brand)' },
    MD: { bg: 'var(--teal-soft)', co: 'var(--teal)' },
    XLSX: { bg: 'var(--accent-soft)', co: 'var(--accent)' },
  }

  return (
    <PageShell
      crumb="工作台 / 评审 / 评审详情"
      title="评审"
      subtitle="评审中 · 还剩 2 天"
      actions={[
        <Link key="jump" to="/assessments/ASM-018" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}>↗ 跳转方案 v07</Link>,
        <button key="reject" className="btn btn-dan" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => setRejectOpen(true)}>✕ 驳回</button>,
        <button key="pass" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} disabled>✓ 通过</button>,
      ]}
    >
      <div className="grid-4-eq" style={{ padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>关联方案</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>AE-2026-0418 · 付款/库存/报表</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>发起人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>陈晨 · 产品经理</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>评审人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>王丽 · 后端架构师</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>截止时间</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}><span style={{ color: 'var(--accent-ink)', fontWeight: 800 }}>还剩 2 天</span> · 2026-04-20</div>
        </div>
      </div>

      <div className="grid-1fr-280" style={{ padding: '16px 18px 18px' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>Checklist</span><span className="bdg ci"><span className="dot" />5 项</span></div>
            <div className="bd" style={{ padding: 0 }}>
              {checklist.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 92px 1fr 92px', gap: 10, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--line)' }}>
                  <span>{it.status === '通过' ? '☑' : '☐'}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{it.type}</span>
                  <span>{it.name}</span>
                  <span style={{ color: it.status === '通过' ? 'var(--ok)' : 'var(--ink-3)', fontWeight: 700 }}>{it.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>评审评论</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>2 条评论</span></div>
            <div className="bd">
              {comments.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg,var(--brand-soft),var(--brand))', color: 'var(--brand-ink)', fontWeight: 800, fontSize: 12 }}>{c.name[0]}</div>
                  <div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{c.name}</strong>
                      <span style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{c.time}</span>
                    </div>
                    <div style={{ marginTop: 4, color: 'var(--ink-2)', lineHeight: 1.7 }}>{c.text}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 14 }}>
                <textarea placeholder="请输入新增评论..." style={{ width: '100%', minHeight: 92, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', font: '500 13px/1.6 var(--font-sans)', resize: 'vertical', background: '#fff' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>发表评论</button>
                </div>
              </div>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>PM 交付物</span>
              <span className="bdg ci"><span className="dot" />4 项</span>
              <button
                className="btn btn-pri"
                style={{ height: 28, padding: '0 10px', fontSize: 12, marginLeft: 'auto', opacity: pendingCount === 0 ? 0.5 : 1 }}
                disabled={pendingCount === 0}
                onClick={genAll}
              >{pendingCount === 0 ? '✦ 已全部生成' : '✦ 一键全部生成'}</button>
            </div>
            <div className="bd" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr><th>文件</th><th>类型</th><th className="num">生成时间</th><th>状态</th><th className="num">操作</th></tr>
                </thead>
                <tbody>
                  {deliverables.map((d) => {
                    const t = typeMap[d.type]
                    const statusEl = d.status === 'pending'
                      ? <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>未生成</span>
                      : d.status === 'generated'
                        ? <span style={{ color: 'var(--ok)', fontSize: 12, fontWeight: 700 }}>已生成</span>
                        : <span style={{ color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700 }}>已盖章<span style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 4 }}>{d.sealName}</span></span>
                    const ops = d.status === 'pending'
                      ? <button className="btn btn-pri" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => genOne(d.id)}>生成</button>
                      : d.status === 'generated'
                        ? <span style={{ display: 'inline-flex', gap: 4 }}>
                            <button className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => alert('Phase A · mock 下载 ' + d.name)}>↓ 下载</button>
                            <button className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => { setSealTarget(d.id); setPickedSeal(SEALS[0].id) }}>⊘ 盖章</button>
                          </span>
                        : <button className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => alert('Phase A · mock 下载 ' + d.name + '（已盖章）')}>↓ 下载（已盖章）</button>
                    return (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td><span className="bdg" style={{ background: t.bg, color: t.co, fontSize: 10.5, padding: '1px 7px' }}>{d.type}</span></td>
                        <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{d.generatedAt || '—'}</td>
                        <td>{statusEl}</td>
                        <td className="num">{ops}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 18, height: 'fit-content' }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>完整度</span><span className="bdg ok"><span className="dot" />60%</span></div>
            <div className="bd" style={{ textAlign: 'center' }}>
              <div style={{ width: 128, height: 128, borderRadius: '50%', background: 'conic-gradient(var(--brand) 0 60%, var(--line-2) 60% 100%)', display: 'grid', placeItems: 'center', margin: '2px auto 8px', position: 'relative' }}>
                <div style={{ width: 82, height: 82, borderRadius: '50%', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)' }} />
                <div style={{ position: 'absolute', textAlign: 'center', fontWeight: 800, color: 'var(--ink)' }}>
                  <div style={{ fontSize: 28, lineHeight: 1 }}>60%</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>3 / 5</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>5 项中 3 项通过，2 项待审</div>
            </div>
          </div>

          <div className="section" style={{ marginTop: 16 }}>
            <div className="hd"><span>关联文档</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>跳转</span></div>
            <div className="bd">
              {[
                { t: '实施评估', to: '/assessments/ASM-018' },
                { t: '资源成本', to: '/resource-costs/RS-04001' },
                { t: '需求', to: '/requirements/RQ-04001' },
              ].map(({ t, to }) => (
                <Link key={t} to={to} style={{ display: 'block', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, background: '#fff', marginBottom: 8, textDecoration: 'none', color: 'var(--ink)' }}>{t}</Link>
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 14, boxShadow: 'var(--shadow-1)', marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>PM 接力</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>下一节点</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>来自</span><span style={{ fontWeight: 600 }}>王丽 · 售前架构师</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>交接给</span><span style={{ fontWeight: 600 }}>刘洋 · 项目经理</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>截止时间</span><span style={{ fontWeight: 600, color: 'var(--accent-ink)' }}>还剩 2 天 · 2026-04-26 18:00</span></div>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10, height: 32, fontSize: 12 }}>⤳ 发起接力</button>
          </div>
        </div>
      </div>

      {/* 驳回 dialog */}
      {rejectOpen && (
        <DialogBackdrop onClose={() => setRejectOpen(false)}>
          <DialogCard title="驳回评审" subtitle="必填驳回原因">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="请输入驳回原因..."
              style={{ width: '100%', minHeight: 130, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontFamily: 'inherit', fontSize: 13, outline: 'none', resize: 'vertical' }}
            />
            <DialogActions>
              <button className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setRejectOpen(false)}>取消</button>
              <button className="btn btn-dan" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={rejectConfirm}>确认驳回</button>
            </DialogActions>
          </DialogCard>
        </DialogBackdrop>
      )}

      {/* 印章选择 dialog */}
      {sealTarget && (
        <DialogBackdrop onClose={() => setSealTarget(null)}>
          <DialogCard title={`为「${deliverables.find((d) => d.id === sealTarget)?.name}」选择印章`}>
            <div style={{ display: 'grid', gap: 8 }}>
              {SEALS.map((s) => (
                <label key={s.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', border: `1px solid ${pickedSeal === s.id ? 'var(--brand)' : 'var(--line)'}`, borderRadius: 10, background: pickedSeal === s.id ? 'var(--brand-soft)' : 'var(--bg-soft)', cursor: 'pointer' }}>
                  <input type="radio" name="seal" value={s.id} checked={pickedSeal === s.id} onChange={() => setPickedSeal(s.id)} style={{ marginTop: 4 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.scope}</div>
                  </div>
                </label>
              ))}
            </div>
            <DialogActions>
              <button className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setSealTarget(null)}>取消</button>
              <button className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={sealConfirm}>确认盖章</button>
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
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', display: 'grid', placeItems: 'center', padding: 20, zIndex: 50 }}>
      {children}
    </div>
  )
}
function DialogCard({ title, subtitle, children }) {
  return (
    <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 'var(--r-lg)', boxShadow: '0 24px 64px rgba(15,23,42,0.24)', border: '1px solid var(--line)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {subtitle && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}
function DialogActions({ children }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>{children}</div>
}
