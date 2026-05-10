import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import { assessment } from '../mock/assessmentData.js'
import ProjectIdentityCard from '../components/Assessment/ProjectIdentityCard.jsx'
import VcsToolbar from '../components/Assessment/VcsToolbar.jsx'
import ParamMiniBar from '../components/Assessment/ParamMiniBar.jsx'
import AdvancedCollapsible from '../components/Assessment/AdvancedCollapsible.jsx'
import KpiCards from '../components/Assessment/KpiCards.jsx'
import PathBreadcrumb from '../components/Assessment/PathBreadcrumb.jsx'
import SkuTable from '../components/Assessment/SkuTable.jsx'
import DslBanner from '../components/Assessment/DslBanner.jsx'
import SidePanel from '../components/Assessment/SidePanel.jsx'

const TABS = [
  { key: 'sku', label: '模块明细', count: 12 },
  { key: 'multi', label: '多组织推广估算', badge: assessment.multiOrg?.incompleteCount },
  { key: 'diff', label: '变更对比' },
  { key: 'dsl', label: 'DSL 规则审阅' },
  { key: 'story', label: '五段叙事' },
  { key: 'sow', label: '附件 SOW' },
]

const DIFF_DATA = [
  { field: '实施顾问人天', before: '45', after: '52', type: '上调' },
  { field: '架构师人天', before: '30', after: '28', type: '下调' },
  { field: '多组织数量', before: '2', after: '3', type: '上调' },
]

const DSL_DATA = [
  { id: 'DSL-01', type: 'blocking', message: '需求条目必须关联至少一个业务模块', status: '已触发' },
  { id: 'DSL-02', type: 'warning', message: '多组织推广估算应提供相似度依据', status: '已触发' },
  { id: 'DSL-03', type: 'blocking', message: '评审通过前必须完成全部 checklist', status: '已通过' },
  { id: 'DSL-04', type: 'warning', message: '资源成本与实施评估差额超过 10% 需说明', status: '已触发' },
  { id: 'DSL-05', type: 'blocking', message: '评估人天不得低于基准值的 80%', status: '已通过' },
]

const STORY_PANELS = [
  { title: '背景', text: '金石制造集团成立于 2008 年，专注于精密零部件加工，年营收约 10 亿，员工 2400 人。随着业务扩张，现有 ERP 系统已无法满足多基地协同与精细化成本核算的需求。' },
  { title: '现状', text: '当前 ERP 已使用 5 年，核心模块包括总账、销售、采购、库存。系统间数据孤岛严重，跨基地对账依赖手工，月均对账耗时 120 人天。' },
  { title: '方案', text: '升级 ERP 核心模块，打通订单到交付全链路。实施总账自动化、销售订单跟踪、采购询比价、库存可视与经营看板五大模块。' },
  { title: '价值', text: '预计缩短交付周期 20%，减少跨系统对账成本 60%，实现多基地库存实时可视，支撑年营收增长 15% 的战略目标。' },
  { title: '风险', text: '数据迁移复杂度较高，历史 5 年数据清洗预计需 30 人天；用户习惯改变可能导致上线初期效率波动，需预留 2 周缓冲期。' },
]

const SOW_FILES = [
  { name: '实施 SOW v07.pdf', type: 'PDF', size: '3.2 MB', date: '2026-04-20' },
  { name: '详细实施方案.docx', type: 'DOCX', size: '2.8 MB', date: '2026-04-18' },
  { name: '对外报价单.xlsx', type: 'XLSX', size: '1.5 MB', date: '2026-04-16' },
]

export default function AssessmentDetail() {
  const { id } = useParams()
  const [activeTab, setActiveTab] = useState('sku')

  return (
    <PageShell
      crumb="工作台 / 实施评估 / 详情"
      title="实施评估详情"
      subtitle={`${assessment.assessmentVersion || 'IA-04003'} · ${assessment.globalVersion || 'GL-04001'} · 已检入`}
      actions={[
        <button key="hist" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => alert('Phase A · mock · [版本历史]')}>🕘 历史</button>,
        <button key="export" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => alert('Phase A · mock · [导出]')}>↓ 导出</button>,
        <button key="checkin" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => alert('Phase A · mock · [签入版本]')}>⇡ 签入</button>,
      ]}
    >
      {/* DSL Banner */}
      <DslBanner dsl={assessment.dsl} />

      {/* Top region */}
      <div style={{ padding: '16px 24px 0' }}>
        <ProjectIdentityCard data={assessment} />
        <VcsToolbar dsl={assessment.dsl} hasLocalChanges={assessment.vcs?.hasLocalChanges} />
        <ParamMiniBar params={assessment.params} />
        <AdvancedCollapsible context={assessment.context} />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '16px 24px 0',
          alignItems: 'center',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              border: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: activeTab === t.key ? 'var(--brand)' : 'var(--bg-soft)',
              color: activeTab === t.key ? '#fff' : 'var(--ink-3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  background: activeTab === t.key ? 'rgba(255,255,255,0.25)' : 'var(--ink-4)',
                  color: '#fff',
                }}
              >
                {t.count}
              </span>
            )}
            {typeof t.badge === 'number' && t.badge > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  background: 'var(--accent)',
                  color: '#fff',
                  padding: '0 5px',
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            className="bdg muted"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              background: 'var(--bg-soft)',
              color: 'var(--ink-3)',
              cursor: 'pointer',
            }}
          >
            仅显示已勾选
          </span>
          <span
            className="bdg muted"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              background: 'var(--bg-soft)',
              color: 'var(--ink-3)',
              cursor: 'pointer',
            }}
          >
            展开全部
          </span>
        </span>
      </div>

      {/* Main body */}
      <div
        style={{
          display: 'grid',
          className: 'grid-1fr-280',
          gap: 16,
          padding: '16px 24px 24px',
        }}
      >
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {activeTab === 'sku' && (
            <>
              <KpiCards kpi={assessment.kpi} dsl={assessment.dsl} />
              <PathBreadcrumb path={assessment.path} />
              <div
                className="reg"
                style={{
                  position: 'relative',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-lg)',
                  padding: '18px 18px 16px',
                  boxShadow: 'var(--shadow-1)',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    color: 'var(--ink-3)',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    background: 'transparent',
                    padding: 0,
                    marginBottom: 8,
                  }}
                >
                  SKU
                </div>
                <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>模块明细 · SKU 主表</h3>
                <SkuTable groups={assessment.skuGroups} />
              </div>
            </>
          )}

          {activeTab === 'multi' && (
            <div
              className="reg"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-lg)',
                padding: 18,
                boxShadow: 'var(--shadow-1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>多组织推广估算</h3>
                <button className="btn btn-out" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>+ 新增组织</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 10px' }}>
                基于组织相似度 <span className="mono">{assessment.params.orgSimilarity}</span> 与当前方案估算增量条目与交付策略。
              </p>
              <table className="at" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th>组织名</th>
                    <th>规模</th>
                    <th>复用率</th>
                    <th>增量条目</th>
                    <th>交付策略</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assessment.multiOrg.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.org}</td>
                      <td>{i === 0 ? '大' : i === 1 ? '中' : '小'}</td>
                      <td>{[100, 72, 68][i] || 80}%</td>
                      <td>{r.increment}</td>
                      <td>
                        <select
                          defaultValue={r.strategy}
                          style={{
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            padding: '4px 8px',
                            background: '#fff',
                            font: 'inherit',
                            fontSize: 12,
                          }}
                        >
                          <option>标准</option>
                          <option>差异化</option>
                          <option>轻量</option>
                        </select>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'diff' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>变更对比 · v06 → v07</h3>
              <div className="grid-2-eq" style={{ gap: 14 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: 'var(--bg-soft)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, fontWeight: 700 }}>v06（ before ）</div>
                  {DIFF_DATA.map((d) => (
                    <div key={d.field} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                      <span style={{ color: 'var(--ink-3)' }}>{d.field}</span>
                      <span style={{ float: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{d.before}</span>
                    </div>
                  ))}
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: '#fff' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, fontWeight: 700 }}>v07（ after ）</div>
                  {DIFF_DATA.map((d) => (
                    <div key={d.field} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                      <span style={{ color: 'var(--ink-3)' }}>{d.field}</span>
                      <span style={{ float: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: d.type === '上调' ? 'var(--err)' : 'var(--ok)' }}>{d.after}</span>
                      <span className={`bdg ${d.type === '上调' ? 'co' : 'ci'}`} style={{ float: 'right', marginRight: 8, fontSize: 10, padding: '1px 6px' }}>
                        <span className="dot" />{d.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dsl' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>DSL 规则审阅</h3>
              <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                <thead>
                  <tr><th>规则 ID</th><th>类型</th><th>说明</th><th>状态</th></tr>
                </thead>
                <tbody>
                  {DSL_DATA.map((r) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ fontSize: 12 }}>{r.id}</td>
                      <td>
                        <span className="bdg" style={{ fontSize: 10.5, padding: '1px 6px', background: r.type === 'blocking' ? 'var(--err-soft)' : 'var(--warn-soft)', color: r.type === 'blocking' ? 'var(--err)' : 'var(--warn-ink)' }}>
                          {r.type === 'blocking' ? '阻断' : '警告'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.message}</td>
                      <td>
                        <span className={`bdg ${r.status === '已通过' ? 'ok' : 'co'}`} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                          <span className="dot" />{r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'story' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>五段叙事</h3>
              <div style={{ display: 'grid', gap: 12 }}>
                {STORY_PANELS.map((p, i) => (
                  <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: 'var(--bg-soft)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6, letterSpacing: '.06em', textTransform: 'uppercase' }}>{p.title}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)' }}>{p.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'sow' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>附件 SOW</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {SOW_FILES.map((f) => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{f.type === 'PDF' ? '📕' : f.type === 'DOCX' ? '📘' : '📗'}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{f.size} · {f.date}</div>
                      </div>
                    </div>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 26 }} onClick={() => alert(`Phase A · mock · [下载 ${f.name}]`)}>下载</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <SidePanel kpi={assessment.kpi} summary={assessment.summary} aiCopilot={assessment.aiCopilot} />
      </div>
    </PageShell>
  )
}
