import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import useResourceCostDetail from '../hooks/useResourceCostDetail.js'
import { apiClient } from '../api/client.js'
import { unwrapList } from '../api/utils.js'
import { mapVcsStatus } from '../hooks/mapVersionStatus.js'
import { downloadCSV } from '../utils/download.js'

export default function ResourceCostDetail() {
  const { id } = useParams()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const detail = useResourceCostDetail({ id })
  const {
    groups = [],
    months = [],
    totalDays = 0,
    totalAmount = 0,
    totalTravel = 0,
    monthTotals = [],
    actions,
    checkedOut,
  } = detail

  return (
    <PageShell
      crumb="工作台 / 资源人天及成本 / 详情"
      title="资源人天及成本"
      actions={[
        // 全套 VCS（决策 A）—— 当前 RS-04001 已检出态：检出 disabled / 检入 pri / 撤销+解锁可用
        <button type="button" key="hist" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={async () => { setHistoryOpen(true); setHistoryLoading(true); try { const payload = await apiClient.get('/versions', { type: 'resource' }); const list = unwrapList(payload).filter(r => r.baseCode === (detail.globalVersion || detail.code || id)); setHistoryRows(list.map(r => ({ version: r.versionCode || r.version || '', status: mapVcsStatus(r), owner: r.checkedOutByUsername || r.updatedByUsername || '—', updatedAt: (r.updatedAt || '').slice(0, 10) }))); } catch (err) { alert('加载历史失败: ' + err.message); } finally { setHistoryLoading(false); } }}>⏱ 历史</button>,
        <button type="button" key="promote" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => actions?.promote?.()}>⬆ 升版</button>,
        <span key="sep1" style={{ width: 1, height: 18, background: 'var(--line)' }} />,
        <button type="button" key="checkin" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => actions?.checkin?.()}>🔒 检入</button>,
        <button type="button" key="undo" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => actions?.undoCheckout?.()}>↺ 撤销</button>,
        <button type="button" key="checkout" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px', opacity: checkedOut ? 0.45 : 1, cursor: checkedOut ? 'not-allowed' : 'pointer' }} disabled={checkedOut} onClick={() => !checkedOut && actions?.checkout?.()}>🔓 检出</button>,
        <span key="sep2" style={{ width: 1, height: 18, background: 'var(--line)' }} />,
        <button type="button" key="unlock" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px', color: 'var(--err)' }} onClick={() => confirm('强制解锁会覆盖他人改动，确定？') && actions?.forceUnlock?.()}>⚠ 解锁</button>,
        <button type="button" key="export" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => { const rows = groups.flatMap(g => g.rows.map(r => ({ 角色: g.role, 姓名: r.name, 单价: r.unitPrice, 计划人天: r.plannedDays, 差旅: r.travelCost, 小计: r.unitPrice * r.plannedDays + r.travelCost }))); downloadCSV(rows, `resource-cost-${detail.code || id}.csv`); }}>↓ 导出</button>,
        <button type="button" key="save" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => actions?.saveDraft?.()}>⤒ 保存版本</button>,
      ]}
    >
      {/* pmstrip */}
      <div className="grid-3-eq" style={{ padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>总方案版本号</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{detail.globalVersion || '—'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>关联实施评估</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{detail.assessmentVersion || '—'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>资源成本版本</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{detail.resourceVersion || detail.code || detail.version || '—'}</span>
            <span className={`bdg ${checkedOut ? 'co' : 'ci'}`} style={{ marginLeft: 6 }}><span className="dot" style={{ background: checkedOut ? 'var(--accent)' : 'var(--teal)' }} />{checkedOut ? '检出' : '检入'}</span>
          </div>
        </div>
      </div>

      {/* Tabs · 用 .tabs .t 类对齐 layout.css */}
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button type="button" className="t on" style={{ background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>明细</button>
        <button type="button" className="t" style={{ background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>分配视图</button>
        <button type="button" className="t" style={{ background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>变更对比</button>
        <button type="button" className="t" style={{ background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>导出预览</button>
      </div>

      <div className="grid-1fr-280" style={{ padding: '16px 24px 24px' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* KPI3 */}
          <div className="grid-3-eq">
            {(() => {
              const BAR_COLORS = ['var(--brand)', 'var(--accent)', 'var(--teal)', 'var(--ok)', 'oklch(.55 .14 262)']
              const groupDays = groups.map(g => g.subtotal?.days ?? g.rows?.reduce((s, r) => s + (r.plannedDays || 0), 0) ?? 0)
              const maxDays = Math.max(...groupDays, 1)
              const totalGroupDays = groupDays.reduce((a, b) => a + b, 0)
              const topRole = groups.length ? groups.reduce((max, g) => (g.subtotal?.days ?? 0) > (max.subtotal?.days ?? 0) ? g : max, groups[0]) : null
              return (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff', background: 'var(--brand)' }}>⊞</span>
                  资源人天结构
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 72, padding: '0 4px' }}>
                  {groups.map((g, i) => (
                    <div key={g.group || i} style={{ flex: 1, borderRadius: '4px 4px 0 0', minHeight: 4, height: `${Math.max((groupDays[i] / maxDays) * 100, 4)}%`, background: BAR_COLORS[i % BAR_COLORS.length], position: 'relative' }}>
                      <span style={{ position: 'absolute', bottom: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{g.role}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 20 }}>总人天 {totalDays}{topRole ? ` · ${topRole.role} ${totalGroupDays ? Math.round(groupDays[0] / totalGroupDays * 100) : 0}% 最高` : ''}</div>
              </div>
              )
            })()}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff', background: 'var(--accent)' }}>⇆</span>
                资源人天汇总
              </div>
              <div className="grid-2-eq" style={{ marginBottom: 10 }}>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>总角色数</div><div style={{ fontSize: 22, fontWeight: 800 }}>{groups.length}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>总人数</div><div style={{ fontSize: 22, fontWeight: 800 }}>{groups.reduce((s, g) => s + (g.rows?.length || 0), 0)}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>总人天</div><div style={{ fontSize: 22, fontWeight: 800 }}>{totalDays}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>总成本</div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--brand)' }}>¥{totalAmount.toLocaleString()}</div></div>
              </div>
            </div>
            {(() => {
              const PIE_COLORS = ['var(--brand)', 'var(--accent)', 'var(--teal)', 'var(--ok)', 'oklch(.55 .14 262)']
              const groupAmounts = groups.map(g => g.subtotal?.amount ?? g.rows?.reduce((s, r) => s + r.unitPrice * r.plannedDays + (r.travelCost || 0), 0) ?? 0)
              const totalGroupAmount = groupAmounts.reduce((a, b) => a + b, 0)
              const circumference = 2 * Math.PI * 28
              let offset = 0
              return (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff', background: 'var(--ok)' }}>¥</span>
                  成本金额占比
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <svg viewBox="0 0 72 72" width="72" height="72">
                    <circle cx="36" cy="36" r="28" fill="none" stroke="var(--line)" strokeWidth="10" />
                    {groups.map((g, i) => {
                      const pct = totalGroupAmount ? groupAmounts[i] / totalGroupAmount : 0
                      const dash = pct * circumference
                      const prevOffset = offset
                      offset += pct
                      const rot = prevOffset * 360 - 90
                      return <circle key={g.group || i} cx="36" cy="36" r="28" fill="none" stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`} strokeDashoffset={circumference * 0.25} transform={`rotate(${rot} 36 36)`} />
                    })}
                  </svg>
                  <div style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                    {groups.map((g, i) => (
                      <div key={g.group || i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {g.role} {totalGroupAmount ? Math.round(groupAmounts[i] / totalGroupAmount * 100) : 0}%
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>总成本 ¥{(totalGroupAmount || totalAmount).toLocaleString()}</div>
              </div>
              )
            })()}
          </div>

          {/* Detail table */}
          <article className="reg" style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '18px 18px 16px', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ position: 'absolute', left: 14, top: -11, padding: '0 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--ink-3)' }}>DETAIL</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>资源明细</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>⇧ 增加投入月</button>
                <button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>⇩ 减少投入月</button>
                <button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>不含差旅</button>
                <button type="button" className="btn btn-pri" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>+ 新增行</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, padding: '10px 12px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--ink-3)', marginBottom: 10, flexWrap: 'wrap' }}>
              <b style={{ color: 'var(--ink)' }}>总人天 {totalDays}</b><span>·</span><b style={{ color: 'var(--ink)' }}>总成本估算 ¥{totalAmount.toLocaleString()}</b><span>·</span><span>差旅 ¥{totalTravel.toLocaleString()} 已含</span>
            </div>
            <div style={{ overflowX: 'auto' }}><table className="table">
              <thead>
                <tr>
                  <th>角色</th><th>姓名</th><th>单价</th><th>计划人天</th><th>差旅</th><th className="num">小计</th>
                  {months.map(m => <th key={m} className="num">{m.slice(5)}月</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <React.Fragment key={g.group}>
                    <tr style={{ background: 'color-mix(in oklab,var(--bg-soft) 82%,var(--brand-soft) 8%)', fontWeight: 700, color: 'var(--ink)' }}>
                      <td colSpan={2}>{g.group} · {g.role}</td>
                      <td className="num">—</td>
                      <td className="num">{g.subtotal.days}</td>
                      <td className="num">—</td>
                      <td className="num" style={{ color: 'var(--brand)', fontWeight: 600 }}>¥{g.subtotal.amount.toLocaleString()}</td>
                      {months.map((_, i) => <td key={i} />)}
                    </tr>
                    {g.rows.map((r, idx) => {
                      const sub = r.unitPrice * r.plannedDays + r.travelCost
                      return (
                        <tr key={idx}>
                          <td>{g.role}</td>
                          <td>{r.name}</td>
                          <td className="num">¥{r.unitPrice}</td>
                          <td className="num">{r.plannedDays}</td>
                          <td className="num">¥{r.travelCost.toLocaleString()}</td>
                          <td className="num" style={{ color: 'var(--brand)', fontWeight: 600 }}>¥{sub.toLocaleString()}</td>
                          {r.months.map((v, i) => <td key={i} className="num">{v}</td>)}
                        </tr>
                      )
                    })}
                  </React.Fragment>
                ))}
                <tr style={{ background: 'linear-gradient(135deg,var(--brand-soft),var(--surface))', fontWeight: 700 }}>
                  <td colSpan={2}>合计</td>
                  <td className="num">—</td>
                  <td className="num">{totalDays}</td>
                  <td className="num">¥{totalTravel.toLocaleString()}</td>
                  <td className="num" style={{ color: 'var(--brand)', fontWeight: 600 }}>¥{totalAmount.toLocaleString()}</td>
                  {monthTotals.map((v, i) => <td key={i} className="num">{v}</td>)}
                </tr>
              </tbody>
            </table></div>
          </article>
        </div>

        <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <h4 style={{ margin: '0 0 10px' }}>资源汇总</h4>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>总角色</span><span style={{ fontWeight: 700 }}>{groups.length}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>总人天</span><span style={{ fontWeight: 700 }}>{totalDays}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>总成本</span><span style={{ fontWeight: 700 }}>¥{totalAmount.toLocaleString()}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>差旅合计</span><span style={{ fontWeight: 700 }}>¥{totalTravel.toLocaleString()}</span></div>
            </div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'linear-gradient(180deg,color-mix(in oklab,oklch(.62 .20 320) 14%, var(--surface)),var(--surface))', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 999, background: 'oklch(.95 .03 295)', color: 'oklch(.45 .22 295)', fontSize: 11, fontWeight: 800, letterSpacing: '.04em' }}>✦ AI COPILOT</span>
            <p style={{ lineHeight: 1.7, color: 'var(--ink)', fontSize: 13 }}>检出资源成本后可点击"应用建议"，由 AI 分析资源分配并提供优化方案。</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>应用建议</button>
              <button type="button" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>查看依据</button>
            </div>
          </div>
          {groups.length > 0 && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <h4 style={{ margin: '0 0 10px' }}>单价参考</h4>
            {groups.flatMap(g => g.rows || []).slice(0, 5).map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                <span style={{ color: 'var(--ink-3)' }}>{r.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>¥{r.unitPrice?.toLocaleString()}/天</span>
              </div>
            ))}
          </div>
          )}
        </aside>
      </div>
    {/* 版本历史弹窗 */}
      {historyOpen && (
        <div onClick={(e) => e.target === e.currentTarget && setHistoryOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', display: 'grid', placeItems: 'center', padding: 20, zIndex: 50 }}>
          <div style={{ width: 'min(640px, 100%)', background: '#fff', borderRadius: 'var(--r-lg)', boxShadow: '0 24px 64px rgba(15,23,42,0.24)', border: '1px solid var(--line)', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>版本历史</strong>
            </div>
            {historyLoading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)' }}>加载中…</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ minWidth: 480, border: 0, borderRadius: 0 }}>
                  <thead><tr><th>版本号</th><th>状态</th><th>负责人</th><th>更新时间</th></tr></thead>
                  <tbody>
                    {historyRows.length ? historyRows.map((r, i) => (
                      <tr key={i}><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.version}</td><td><span className={`bdg ${r.status === '已检入' ? 'ci' : r.status === '已检出' ? 'co' : 'rev'}`}><span className="dot" />{r.status}</span></td><td>{r.owner}</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.updatedAt}</td></tr>
                    )) : <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>无历史记录</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setHistoryOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
