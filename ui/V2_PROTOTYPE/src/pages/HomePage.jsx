import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function HomePage() {
  const kpiData = [
    { ic: '▣', lb: '方案数', num: 12, sub: '近 7 天 +1 进行中', bar: '80%' },
    { ic: '≡', lb: '需求条目', num: 186, sub: '待结构化 4 · 待处理 2', bar: '62%', icBg: 'var(--accent-soft)', icCo: 'var(--accent)' },
    { ic: '⏱', lb: '评估人天', num: 762, sub: '高复杂占比 20%', bar: '48%', icBg: 'var(--info-soft)', icCo: 'var(--info)' },
    { ic: '⚇', lb: '参与成员', num: 14, sub: '在线 6 人', bar: '35%', icBg: 'var(--ok-soft)', icCo: 'var(--ok)' },
  ]

  const plans = [
    { id: 1, projectName: '利民集团数字化二期', globalVersion: 'GL-04001', status: '进行中', checkedOut: false, mandays: 210.5 },
    { id: 2, projectName: '金石科技 ERP 升级', globalVersion: 'GL-04002', status: '待评审', checkedOut: true, mandays: 315.2 },
    { id: 3, projectName: '华东智造供应链改造', globalVersion: 'GL-04003', status: '已发布', checkedOut: false, mandays: 178.0 },
    { id: 4, projectName: '新材料集团财务共享', globalVersion: 'GL-04004', status: '进行中', checkedOut: true, mandays: 245.8 },
    { id: 5, projectName: '地产集团成本管理', globalVersion: 'GL-04005', status: '已发布', checkedOut: false, mandays: 132.4 },
    { id: 6, projectName: '零售集团会员中台', globalVersion: 'GL-04006', status: '进行中', checkedOut: false, mandays: 289.6 },
  ]

  const feed = [
    { name: '王丽', action: '检出了 开发评估 · DV-04001', time: '10 分钟前', accent: false },
    { name: '陈晨', action: '完成了 需求评审 · RQ-04001', time: '32 分钟前', accent: true },
    { name: '张鹏', action: '更新了 资源成本 · RS-04001', time: '1 小时前', accent: false },
    { name: '刘洋', action: '发布了 总方案 · GL-04005', time: '3 小时前', accent: true },
  ]

  return (
    <PageShell
      crumb="工作台 / 主页"
      title="主页"
      subtitle="总览、评估方案列表与快速操作"
      actions={[
        <button key="new" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>+ 新建</button>,
      ]}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {kpiData.map((k, i) => (
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

          {/* Plan list */}
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>评估方案列表</span>
              <span className="bdg ci" style={{ fontSize: 10.5, padding: '1px 6px' }}><span className="dot" />已检入 9</span>
              <span className="bdg co" style={{ fontSize: 10.5, padding: '1px 6px' }}><span className="dot" />已检出 3</span>
              <div className="right"><span style={{ fontSize: 11 }}>共 12 条</span></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)', fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>已选 0</span>
              <div style={{ display: 'flex', gap: 4, paddingRight: 12, borderRight: '1px solid var(--line)' }}>
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>🕘 历史</button>
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>🔗 ER</button>
                <button className="btn btn-pri" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>＋ 新建</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-2)' }}>状态：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>全部</b><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-2)' }}>行业：<b style={{ color: 'var(--ink)', fontWeight: 600 }}>制造业</b><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>×</span></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 5, background: '#fff', border: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)', minWidth: 200 }}>⌕ 搜索项目名 / 版本号 / 检出人</span>
              </div>
            </div>
            <table className="table" style={{ borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
              <thead>
                <tr>
                  <th style={{ width: 38 }}>#</th>
                  <th>项目名称</th>
                  <th>总方案版本</th>
                  <th>状态</th>
                  <th>检出</th>
                  <th className="num">人天</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>
                      <b>{p.projectName}</b>
                      <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>{p.globalVersion} · 制造-离散</div>
                    </td>
                    <td className="mono" style={{ fontFamily: 'var(--font-mono)' }}>{p.globalVersion.replace('GL-', 'v')}</td>
                    <td>
                      <span className={`bdg ${p.status === '进行中' ? 'co' : p.status === '待评审' ? 'rev' : 'ci'}`} style={{ fontSize: 10.5 }}>
                        <span className="dot" />{p.status}
                      </span>
                    </td>
                    <td>
                      <span className={`bdg ${p.checkedOut ? 'co' : 'ci'}`} style={{ fontSize: 10.5 }}>
                        <span className="dot" />{p.checkedOut ? '已检出' : '已检入'}
                      </span>
                    </td>
                    <td className="num">{p.mandays}</td>
                    <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>2026-04-{18 - i} 14:33</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700 }}>快速操作</div>
            {['新建评估方案', '导入需求访谈纪要', '发起评审', '查看 API 调用指南'].map((t) => (
              <a key={t} href="#" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', color: 'var(--ink)', textDecoration: 'none', fontSize: 12.5, borderBottom: '1px solid var(--line)' }}>
                {t}<span style={{ color: 'var(--ink-3)', fontSize: 11 }}>→</span>
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
    </PageShell>
  )
}
