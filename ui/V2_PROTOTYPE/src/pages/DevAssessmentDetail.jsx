import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function DevAssessmentDetail() {
  const items = [
    { group: 'A 接口开发', name: '登录/权限 API', base: 3, diff: 2, factor: 1.15, status: '进行中' },
    { group: 'A 接口开发', name: '项目 CRUD API', base: 4, diff: 3, factor: 1.25, status: '未开始' },
    { group: 'A 接口开发', name: '审批流接口', base: 3.5, diff: 4, factor: 1.35, status: '待确认' },
    { group: 'A 接口开发', name: '导出与回写', base: 2.5, diff: 2, factor: 1.10, status: '进行中' },
    { group: 'B 报表看板', name: 'KPI 总览卡片', base: 2, diff: 1, factor: 1.05, status: '已完成' },
    { group: 'B 报表看板', name: '筛选统计图表', base: 3, diff: 3, factor: 1.20, status: '进行中' },
    { group: 'B 报表看板', name: '明细钻取列表', base: 3, diff: 2, factor: 1.12, status: '未开始' },
    { group: 'B 报表看板', name: '权限可见性校验', base: 2, diff: 4, factor: 1.30, status: '待确认' },
  ]

  const groups = Array.from(new Set(items.map(i => i.group)))

  function renderBar(n) {
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} style={{ width: 14, height: 10, borderRadius: 3, background: i < n ? 'linear-gradient(180deg,var(--brand),var(--brand-2))' : 'var(--line-2)' }} />
        ))}
      </div>
    )
  }

  return (
    <PageShell
      crumb="工作台 / 开发评估 / 开发评估详情"
      title="开发评估详情"
      subtitle="Dev-04 · v07 · 评估中"
      actions={[
        <button key="ai" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>AI 生成 ▾</button>,
        <button key="export" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>↓ 导出 CSV</button>,
        <button key="merge" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>⌥ 合并到实施评估</button>,
        <button key="save" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>⤒ 保存</button>,
      ]}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>总方案版本</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>实施评估 v07 · 初稿冻结</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>关联实施评估</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>AE-2026-0418 · 付款/库存/报表</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>评估人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>王丽 · 后端架构师</div>
        </div>
      </div>

      <div className="section" style={{ margin: '16px 18px 18px' }}>
        <div className="hd">
          <span>开发子项明细</span>
          <span className="bdg ci"><span className="dot" />8 项 / 2 组</span>
        </div>
        <div className="bd" style={{ padding: 0, overflow: 'hidden' }}>
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
              {groups.map(g => (
                <React.Fragment key={g}>
                  <tr style={{ background: '#fbfbff', fontWeight: 800, color: 'var(--ink)' }}>
                    <td colSpan={6}>{g} <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>· {items.filter(x => x.group === g).length} 项</span></td>
                  </tr>
                  {items.filter(x => x.group === g).map((it, idx) => (
                    <tr key={idx}>
                      <td><span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{g}</span></td>
                      <td>{it.name}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <button style={{ width: 22, height: 22, border: '1px solid var(--line)', background: '#fff', borderRadius: 6, color: 'var(--ink)', cursor: 'pointer' }}>−</button>
                          <input type="number" min={0} step={0.5} defaultValue={it.base} style={{ width: 38, textAlign: 'center', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 0', font: '600 12px/1 var(--font-mono)', color: 'var(--ink)' }} />
                          <button style={{ width: 22, height: 22, border: '1px solid var(--line)', background: '#fff', borderRadius: 6, color: 'var(--ink)', cursor: 'pointer' }}>+</button>
                        </div>
                      </td>
                      <td>{renderBar(it.diff)}</td>
                      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{it.base} × {it.factor} = {(it.base * it.factor).toFixed(2)}</span></td>
                      <td>
                        <span className={`bdg ${it.status === '已完成' ? 'ok' : it.status === '进行中' ? 'ci' : 'rev'}`}><span className="dot" />{it.status}</span>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--ink-3)', fontSize: 11.5, background: 'var(--bg-soft)' }}>
          <span>vcs-bar · 主次分层浅条</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>基线：dev-2026.04.18</span>
        </div>
      </div>
    </PageShell>
  )
}
