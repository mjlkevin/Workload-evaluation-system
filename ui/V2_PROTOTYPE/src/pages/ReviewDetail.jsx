import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import useReviewDetail from '../hooks/useReviewDetail.js'
import { downloadJSON } from '../utils/download.js'

export default function ReviewDetail() {
  const { id } = useParams()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [sealTarget, setSealTarget] = useState(null)
  const [pickedSeal, setPickedSeal] = useState('')
  const [commentText, setCommentText] = useState('')
  const {
    header,
    checklist,
    comments,
    deliverables,
    completeness,
    handoff,
    relatedDocs,
    reviewStatus,
    seals,
    loading,
    error,
    actionLoading,
    actions,
  } = useReviewDetail(id)

  const genOne = async (deliverableId) => {
    const result = await actions.generateOne(deliverableId)
    if (!result.success) alert(result.error)
  }
  const genAll = async () => {
    const result = await actions.generateAll()
    if (!result.success) alert(result.error)
  }
  const sealConfirm = async () => {
    if (!sealTarget) return
    const result = await actions.sealDeliverable(sealTarget, pickedSeal)
    if (!result.success) {
      alert(result.error)
      return
    }
    setSealTarget(null)
  }
  const rejectConfirm = async () => {
    if (!rejectReason.trim()) { alert('请输入驳回原因'); return }
    const result = await actions.rejectReview(rejectReason.trim())
    if (!result.success) {
      alert(result.error)
      return
    }
    alert('已驳回 · ' + rejectReason)
    setRejectReason(''); setRejectOpen(false)
  }
  const approveConfirm = async () => {
    const result = await actions.approveReview()
    if (!result.success) alert(result.error)
  }
  const commentConfirm = async () => {
    const text = commentText.trim()
    if (!text) return
    const result = await actions.addComment(text)
    if (!result.success) {
      alert(result.error)
      return
    }
    setCommentText('')
  }
  const handoffConfirm = async () => {
    const result = await actions.initiateHandoff()
    if (!result.success) alert(result.error)
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
      actions={[
        <Link key="jump" to={relatedDocs[0]?.to || '#'} className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}>↗ 跳转方案</Link>,
        <button type="button" key="reject" className="btn btn-dan" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => setRejectOpen(true)} disabled={actionLoading.rejectReview}>✕ 驳回</button>,
        <button type="button" key="pass" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={approveConfirm} disabled={actionLoading.approveReview || reviewStatus === 'approved'}>✓ 通过</button>,
      ]}
    >
      <div className="grid-4-eq" style={{ padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>关联方案</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{header.versionLabel}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>发起人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{header.initiator}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>评审人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{header.reviewers}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>截止时间</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}><span style={{ color: 'var(--accent-ink)', fontWeight: 800 }}>还剩 {header.remainingDays} 天</span> · {header.deadline}</div>
        </div>
      </div>

      <div className="grid-1fr-280" style={{ padding: '16px 18px 18px' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>Checklist</span><span className="bdg ci"><span className="dot" />{checklist.length} 项</span></div>
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
            <div className="hd"><span>评审评论</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{comments.length} 条评论</span></div>
            <div className="bd">
              {comments.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg,var(--brand-soft),var(--brand))', color: 'var(--brand-ink)', fontWeight: 800, fontSize: 12 }}>{c.avatarInitial || c.name[0]}</div>
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
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="请输入新增评论..." style={{ width: '100%', minHeight: 92, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', font: '500 13px/1.6 var(--font-sans)', resize: 'vertical', background: '#fff' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={commentConfirm} disabled={actionLoading.addComment || !commentText.trim()}>发表评论</button>
                </div>
              </div>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>PM 交付物</span>
              <span className="bdg ci"><span className="dot" />{deliverables.length} 项</span>
              <button type="button"
                className="btn btn-pri"
                style={{ height: 28, padding: '0 10px', fontSize: 12, marginLeft: 'auto', opacity: pendingCount === 0 || actionLoading.generateAll ? 0.5 : 1 }}
                disabled={pendingCount === 0 || actionLoading.generateAll}
                onClick={genAll}
              >{pendingCount === 0 ? '✦ 已全部生成' : '✦ 一键全部生成'}</button>
            </div>
            <div className="bd" style={{ padding: 0 }}>
              <div className="sys-table-wrap">
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
                        ? <button type="button" className="btn btn-pri" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => genOne(d.id)} disabled={actionLoading[`generate:${d.id}`]}>生成</button>
                        : d.status === 'generated'
                          ? <span style={{ display: 'inline-flex', gap: 4 }}>
                              <button type="button" className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => downloadJSON(d, `${d.name}.json`)}>↓ 下载</button>
                              <button type="button" className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => { setSealTarget(d.id); setPickedSeal(seals[0]?.id || '') }} disabled={actionLoading[`seal:${d.id}`]}>⊘ 盖章</button>
                            </span>
                          : <button type="button" className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }} onClick={() => downloadJSON(d, `${d.name}.json`)}>↓ 下载（已盖章）</button>
                      return (
                        <tr key={d.id}>
                          <td>{d.name}</td>
                          <td><span className="bdg" style={{ background: t?.bg || 'var(--bg-soft)', color: t?.co || 'var(--ink-3)', fontSize: 10.5, padding: '1px 7px' }}>{d.type}</span></td>
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
        </div>

        <div style={{ position: 'sticky', top: 18, height: 'fit-content' }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>完整度</span><span className="bdg ok"><span className="dot" />{completeness.percent}%</span></div>
            <div className="bd" style={{ textAlign: 'center' }}>
              <div style={{ width: 128, height: 128, borderRadius: '50%', background: `conic-gradient(var(--brand) 0 ${completeness.percent}%, var(--line-2) ${completeness.percent}% 100%)`, display: 'grid', placeItems: 'center', margin: '2px auto 8px', position: 'relative' }}>
                <div style={{ width: 82, height: 82, borderRadius: '50%', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)' }} />
                <div style={{ position: 'absolute', textAlign: 'center', fontWeight: 800, color: 'var(--ink)' }}>
                  <div style={{ fontSize: 28, lineHeight: 1 }}>{completeness.percent}%</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{completeness.passed} / {completeness.total}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{completeness.total} 项中 {completeness.passed} 项通过，{completeness.total - completeness.passed} 项待审</div>
            </div>
          </div>

          <div className="section" style={{ marginTop: 16 }}>
            <div className="hd"><span>关联文档</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>跳转</span></div>
            <div className="bd">
              {relatedDocs.map(({ label, to }) => (
                <Link key={label} to={to} style={{ display: 'block', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, background: '#fff', marginBottom: 8, textDecoration: 'none', color: 'var(--ink)' }}>{label}</Link>
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 14, boxShadow: 'var(--shadow-1)', marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>PM 接力</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>下一节点</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>来自</span><span style={{ fontWeight: 600 }}>{handoff.fromName} · {handoff.fromRole}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>交接给</span><span style={{ fontWeight: 600 }}>{handoff.toName} · {handoff.toRole}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>截止时间</span><span style={{ fontWeight: 600, color: 'var(--accent-ink)' }}>还剩 {handoff.remainingDays} 天 · {handoff.deadline}</span></div>
            <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 10, height: 32, fontSize: 12 }} onClick={handoffConfirm} disabled={actionLoading.initiateHandoff}>⤳ 发起接力</button>
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
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setRejectOpen(false)}>取消</button>
              <button type="button" className="btn btn-dan" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={rejectConfirm}>确认驳回</button>
            </DialogActions>
          </DialogCard>
        </DialogBackdrop>
      )}

      {/* 印章选择 dialog */}
      {sealTarget && (
        <DialogBackdrop onClose={() => setSealTarget(null)}>
          <DialogCard title={`为「${deliverables.find((d) => d.id === sealTarget)?.name}」选择印章`}>
            <div style={{ display: 'grid', gap: 8 }}>
              {seals.map((s) => (
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
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setSealTarget(null)}>取消</button>
              <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={sealConfirm} disabled={actionLoading[`seal:${sealTarget}`]}>确认盖章</button>
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
