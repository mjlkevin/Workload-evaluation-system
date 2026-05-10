import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function ResourceCostDetail() {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
  const groups = [
    { group: 'A', role: '实施顾问', color: 'var(--brand)', subtotal: { days: 110, amount: 362000 }, rows: [
      { name: '张鹏', unitPrice: 3000, plannedDays: 60, travelCost: 18000, months: [20, 20, 15, 5, 0] },
      { name: '王敏', unitPrice: 2800, plannedDays: 50, travelCost: 12000, months: [15, 20, 10, 5, 0] },
    ]},
    { group: 'B', role: '架构师', color: 'var(--accent)', subtotal: { days: 46, amount: 196000 }, rows: [
      { name: '李华', unitPrice: 4000, plannedDays: 46, travelCost: 12000, months: [10, 12, 14, 10, 0] },
    ]},
    { group: 'C', role: '项目经理', color: 'var(--teal)', subtotal: { days: 30, amount: 126000 }, rows: [
      { name: '刘洋', unitPrice: 4000, plannedDays: 30, travelCost: 6000, months: [6, 6, 6, 6, 6] },
    ]},
  ]

  const totalDays = 186
  const totalAmount = 684000
  const totalTravel = groups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.travelCost, 0), 0)
  const monthTotals = months.map((_, i) => groups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.months[i], 0), 0))

  return (
    <PageShell
      crumb="工作台 / 资源人天及成本 / RS-04001"
      title="资源人天及成本"
      subtitle="RS-04001-v04 · 已检出"
      actions={[
        // 全套 VCS（决策 A）—— 当前 RS-04001 已检出态：检出 disabled / 检入 pri / 撤销+解锁可用
        <button key="hist" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => alert('Phase A · 静态 mock · [⏱ 历史]')}>⏱ 历史</button>,
        <button key="promote" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => alert('Phase A · 静态 mock · [⬆ 升版]')}>⬆ 升版</button>,
        <span key="sep1" style={{ width: 1, height: 18, background: 'var(--line)' }} />,
        <button key="checkin" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => alert('Phase A · 静态 mock · [🔒 检入]')}>🔒 检入</button>,
        <button key="undo" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => alert('Phase A · 静态 mock · [↺ 撤销检出]')}>↺ 撤销</button>,
        <button key="checkout" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px', opacity: 0.45, cursor: 'not-allowed' }} disabled>🔓 检出</button>,
        <span key="sep2" style={{ width: 1, height: 18, background: 'var(--line)' }} />,
        <button key="unlock" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px', color: 'var(--err)' }} onClick={() => confirm('强制解锁会覆盖他人改动，确定？') && alert('Phase A · 静态 mock · [⚠ 强制解锁]')}>⚠ 解锁</button>,
        <button key="export" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => alert('Phase A · 静态 mock · [↓ 导出]')}>↓ 导出</button>,
        <button key="save" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => alert('Phase A · 静态 mock · [⤒ 保存版本]')}>⤒ 保存版本</button>,
      ]}
    >
      {/* pmstrip */}
      <div className="grid-3-eq" style={{ padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>总方案版本号</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>GL-04001</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>关联实施评估</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>IA-04003（可选）</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>资源成本版本</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>RS-04001-v04</span>
            <span className="bdg co" style={{ marginLeft: 6 }}><span className="dot" style={{ background: 'var(--accent)' }} />检出</span>
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
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff', background: 'var(--brand)' }}>⊞</span>
                实施评估人天结构
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 72, padding: '0 4px' }}>
                {[{ h: 100, c: 'var(--brand)' }, { h: 42, c: 'var(--accent)' }, { h: 27, c: 'var(--teal)' }, { h: 4, c: 'var(--ok)' }, { h: 4, c: 'oklch(.55 .14 262)' }].map((b, i) => (
                  <div key={i} style={{ flex: 1, borderRadius: '4px 4px 0 0', minHeight: 4, height: `${b.h}%`, background: b.c, position: 'relative' }}>
                    <span style={{ position: 'absolute', bottom: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{['实施顾问', '架构师', '项目经理', '测试', '开发'][i]}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 20 }}>总人天 {totalDays} · 实施顾问 59% 最高</div>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff', background: 'var(--accent)' }}>⇆</span>
                实施评估人天分配
                <span className="bdg ok" style={{ marginLeft: 'auto', fontSize: 10, height: 18, padding: '0 6px' }}><span className="dot" style={{ background: 'var(--ok)' }} />联动</span>
              </div>
              <div className="grid-2-eq" style={{ marginBottom: 10 }}>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>实施总人天</div><div style={{ fontSize: 22, fontWeight: 800 }}>194</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>表格已分配</div><div style={{ fontSize: 22, fontWeight: 800 }}>186</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>差额</div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>−8</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>分配率</div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--brand)' }}>96%</div></div>
              </div>
              <div style={{ height: 8, background: 'var(--bg-soft)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--line)' }}><div style={{ height: '100%', width: '96%', background: 'linear-gradient(90deg,var(--brand),var(--accent))', borderRadius: 999 }} /></div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>差额 −8 人天（4.1%）</div>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff', background: 'var(--ok)' }}>¥</span>
                成本金额占比
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg viewBox="0 0 72 72" width="72" height="72">
                  <circle cx="36" cy="36" r="28" fill="none" stroke="var(--line)" strokeWidth="10" />
                  <circle cx="36" cy="36" r="28" fill="none" stroke="var(--brand)" strokeWidth="10" strokeLinecap="round" strokeDasharray="176" strokeDashoffset="70" transform="rotate(-90 36 36)" />
                  <circle cx="36" cy="36" r="28" fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" strokeDasharray="176" strokeDashoffset="132" transform="rotate(54 36 36)" />
                  <circle cx="36" cy="36" r="28" fill="none" stroke="var(--teal)" strokeWidth="10" strokeLinecap="round" strokeDasharray="176" strokeDashoffset="158" transform="rotate(144 36 36)" />
                </svg>
                <div style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--brand)' }} />实施顾问 60%</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />架构师 25%</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--teal)' }} />项目经理 15%</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>总成本 ¥68.4 万</div>
            </div>
          </div>

          {/* Detail table */}
          <article className="reg" style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '18px 18px 16px', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ position: 'absolute', left: 14, top: -11, padding: '0 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--ink-3)' }}>DETAIL</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>资源明细</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>⇧ 增加投入月</button>
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>⇩ 减少投入月</button>
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>不含差旅</button>
                <button className="btn btn-pri" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>+ 新增行</button>
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
            <h4 style={{ margin: '0 0 10px' }}>与实施评估对照</h4>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>实施总人天</span><span style={{ fontWeight: 700 }}>194</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>资源已分配</span><span style={{ fontWeight: 700 }}>{totalDays}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>差额</span><span style={{ fontWeight: 700, color: 'var(--accent)' }}>−8（4.1%）</span></div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>建议：补项目经理 +8 人天</div>
            </div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'linear-gradient(180deg,color-mix(in oklab,oklch(.62 .20 320) 14%, var(--surface)),var(--surface))', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 999, background: 'oklch(.95 .03 295)', color: 'oklch(.45 .22 295)', fontSize: 11, fontWeight: 800, letterSpacing: '.04em' }}>✦ AI COPILOT</span>
            <p style={{ lineHeight: 1.7, color: 'var(--ink)', fontSize: 13 }}>资源分配比实施评估少 8 人天（项目经理）。基于 RateCard 按 ¥4,000/天 平摊到 5–9 月，预计 +¥32,000。</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>应用建议</button>
              <button className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>查看依据</button>
            </div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <h4 style={{ margin: '0 0 10px' }}>RateCard 2026Q2</h4>
            {[{ role: '实施顾问', range: '¥2,800–3,200/天' }, { role: '架构师', range: '¥4,000/天' }, { role: '项目经理', range: '¥4,000/天' }, { role: '差旅日均', range: '¥600/天' }].map(r => (
              <div key={r.role} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                <span style={{ color: 'var(--ink-3)' }}>{r.role}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.range}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </PageShell>
  )
}
