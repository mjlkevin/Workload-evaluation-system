import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function RequirementDetail() {
  const basicInfo = [
    ['客户名称', '金石制造集团'],
    ['地点', '江苏苏州'],
    ['项目名称', '数字化二期'],
    ['商机号', 'OP-2026-0418'],
    ['产品线', 'ERP · 供应链'],
    ['客户行业', '离散制造'],
    ['企业营收', '8–12 亿/年'],
    ['信息化现状', '已有 ERP，需升级'],
    ['预期上线', '2026-10'],
  ]

  const valueProps = [
    { type: '价值', text: '打通订单到交付全链路，缩短交付周期 20%。' },
    { type: '需求', text: '统一主数据口径，减少跨系统对账成本。' },
    { type: '行业', text: '符合离散制造行业合规与追溯要求。' },
  ]

  const scopeItems = [
    { group: 'A 核算与凭证', name: '总账凭证自动生成', status: '正常' },
    { group: 'A 核算与凭证', name: '成本核算精细化', status: '正常' },
    { group: 'B 销售与采购', name: '销售订单到发货跟踪', status: '违反' },
    { group: 'B 销售与采购', name: '采购询比价流程', status: '正常' },
  ]

  return (
    <PageShell
      crumb="工作台 / 需求 / 需求详情"
      title="需求详情"
      subtitle="RQ-04001 · v03 / VA2 · 模型 kimi-k2.5"
      actions={[
        <button key="kimi" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>Kimi-help ▾</button>,
        <button key="hist" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>🕘 历史</button>,
        <button key="export" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>↓ 导出</button>,
        <button key="co" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>⤓ 检出编辑</button>,
      ]}
    >
      {/* Tabs placeholder */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <span className="on">条目明细 (22)</span>
        <span>版本历史 (8)</span>
        <span>变更对比</span>
        <span>附件</span>
        <span>SOW</span>
        <span>DSL 规则审阅</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <article className="reg" style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '18px 18px 16px', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ position: 'absolute', left: 14, top: -11, padding: '0 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--ink-3)' }}>CONTEXT</div>
            <h3 style={{ margin: '0 0 12px' }}>版本与上下文</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--bg-soft)' }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>总方案</div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>总方案 A2</div>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--bg-soft)' }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>需求版本</div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>v03 / VA2</div>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--bg-soft)' }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>检出状态</div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>已检入</div>
              </div>
            </div>
          </article>

          <article className="reg" style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '18px 18px 16px', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ position: 'absolute', left: 14, top: -11, padding: '0 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--ink-3)' }}>BASIC</div>
            <h3 style={{ margin: '0 0 12px' }}>基本情况</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {basicInfo.map(([k, v]) => (
                <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--bg-soft)' }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{k}</div>
                  <div style={{ marginTop: 4, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 12, background: 'var(--bg-soft)', lineHeight: 1.65, color: 'var(--ink)' }}>
                  <b>企业简介</b><br />金石制造集团成立于 2008 年，专注于精密零部件加工，年营收约 10 亿，员工 2400 人。
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 12, background: 'var(--bg-soft)', lineHeight: 1.65, color: 'var(--ink)' }}>
                  <b>项目背景</b><br />现有 ERP 已使用 5 年，无法支撑多基地协同与精细化成本核算，需升级核心模块。
                </div>
              </div>
            </div>
          </article>

          <article className="reg" style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '18px 18px 16px', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ position: 'absolute', left: 14, top: -11, padding: '0 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--ink-3)' }}>VALUE</div>
            <h3 style={{ margin: '0 0 12px' }}>价值主张</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {valueProps.map((x, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '128px minmax(0, 1fr)', gap: 10, alignItems: 'start', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--bg-soft)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: idx === 0 ? 'color-mix(in oklab,var(--ok-soft) 70%, var(--bg-soft))' : idx === 1 ? 'color-mix(in oklab,var(--brand-soft) 72%, var(--bg-soft))' : 'color-mix(in oklab,var(--accent-soft) 72%, var(--bg-soft))', color: idx === 0 ? 'var(--ok)' : idx === 1 ? 'var(--brand)' : 'var(--accent)' }}>{x.type}</span>
                  <div style={{ lineHeight: 1.6 }}>{x.text}</div>
                </div>
              ))}
            </div>
          </article>

          <article className="reg" style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '18px 18px 16px', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ position: 'absolute', left: 14, top: -11, padding: '0 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--ink-3)' }}>SCOPE</div>
            <h3 style={{ margin: '0 0 12px' }}>业务范围 · 需求条目</h3>
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr><th style={{ width: 52 }}>#</th><th style={{ width: 140 }}>分组</th><th>条目</th><th style={{ width: 120 }}>状态</th></tr>
              </thead>
              <tbody>
                <tr style={{ background: 'color-mix(in oklab,var(--bg-soft) 75%, var(--brand-soft) 5%)', fontWeight: 800, color: 'var(--ink)' }}><td colSpan={4}>A 核算与凭证</td></tr>
                {scopeItems.filter(s => s.group === 'A 核算与凭证').map((s, i) => (
                  <tr key={i}><td>{i + 1}</td><td>{s.group}</td><td>{s.name}</td><td>{s.status}</td></tr>
                ))}
                <tr style={{ background: 'color-mix(in oklab,var(--bg-soft) 75%, var(--brand-soft) 5%)', fontWeight: 800, color: 'var(--ink)' }}><td colSpan={4}>B 销售与采购</td></tr>
                {scopeItems.filter(s => s.group === 'B 销售与采购').map((s, i) => (
                  <tr key={i} className={s.status === '违反' ? 'row-error' : ''}><td>{i + 3}</td><td>{s.group}</td><td>{s.name}</td><td>{s.status}</td></tr>
                ))}
                <tr style={{ background: 'var(--bg-soft)', fontWeight: 800 }}><td colSpan={4}>合计：4 条需求，1 条 DSL 违反</td></tr>
              </tbody>
            </table>
          </article>
        </div>

        <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <h4 style={{ margin: '0 0 10px' }}>完整度</h4>
            <div style={{ display: 'grid', placeItems: 'center', gap: 10, marginBottom: 10 }}>
              <svg viewBox="0 0 120 120" width="120" height="120">
                <circle cx="60" cy="60" r="44" fill="none" stroke="var(--line)" strokeWidth="12" />
                <circle cx="60" cy="60" r="44" fill="none" stroke="oklch(.55 .22 295)" strokeWidth="12" strokeLinecap="round" strokeDasharray="276" strokeDashoffset="60" transform="rotate(-90 60 60)" />
                <text x="60" y="58" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--ink)">78%</text>
                <text x="60" y="78" textAnchor="middle" fontSize="11" fill="var(--ink-3)">完整度</text>
              </svg>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-3)' }}>
              <span>基础</span><b>9/9</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-3)' }}>
              <span>价值</span><b>3/3</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-3)' }}>
              <span>DSL 违反</span><b>1</b>
            </div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'linear-gradient(180deg,color-mix(in oklab,oklch(.62 .20 320) 14%, var(--surface)),var(--surface))', padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 999, background: 'oklch(.95 .03 295)', color: 'oklch(.45 .22 295)', fontSize: 11, fontWeight: 800, letterSpacing: '.04em' }}>✦ AI COPILOT</span>
            <p style={{ lineHeight: 1.7, color: 'var(--ink)', fontSize: 13 }}>建议优先固化 DSL 冲突条目并同步到实施评估页，再以 Kimi 评估预览补足风险与公式校准，减少后续版本回滚。</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>应用建议</button>
              <button className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>查看依据</button>
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  )
}
