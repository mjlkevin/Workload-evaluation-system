import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { assessment } from '../mock/assessmentData.js'
import ProjectIdentityCard from '../components/Assessment/ProjectIdentityCard.jsx'
import VcsToolbar from '../components/Assessment/VcsToolbar.jsx'
import ParamMiniBar from '../components/Assessment/ParamMiniBar.jsx'
import AdvancedCollapsible from '../components/Assessment/AdvancedCollapsible.jsx'
import KpiCards from '../components/Assessment/KpiCards.jsx'
import PathBreadcrumb from '../components/Assessment/PathBreadcrumb.jsx'
import SkuTable from '../components/Assessment/SkuTable.jsx'
import DslBanner from '../components/Assessment/DslBanner.jsx'
import AiCopilot from '../components/Assessment/AiCopilot.jsx'
import SidePanel from '../components/Assessment/SidePanel.jsx'

const TABS = [
  { key: 'sku', label: '模块明细', count: 12 },
  { key: 'multi', label: '多组织推广估算', badge: assessment.multiOrg?.incompleteCount },
  { key: 'diff', label: '变更对比' },
  { key: 'dsl', label: 'DSL 规则审阅' },
  { key: 'story', label: '五段叙事' },
  { key: 'sow', label: '附件 SOW' },
]

export default function AssessmentDetail() {
  const { id } = useParams()
  const [activeTab, setActiveTab] = useState('sku')

  return (
    <div>
      {/* Page header — sticky */}
      <div
        className="pg-hd"
        style={{
          padding: '18px 24px 14px',
          borderBottom: '1px solid var(--line)',
          position: 'sticky',
          top: 0,
          background: 'var(--bg, #f6f7f9)',
          zIndex: 20,
        }}
      >
        <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>工作台 / 实施评估 / 详情</div>
      </div>

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
              background: activeTab === t.key ? 'var(--brand, #4f46e5)' : 'var(--bg-soft, #f3f4f6)',
              color: activeTab === t.key ? '#fff' : 'var(--ink-3, #6b7280)',
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
                  color: activeTab === t.key ? '#fff' : '#fff',
                }}
              >
                {t.count}
              </span>
            )}
            {typeof t.badge === 'number' && t.badge > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  background: 'var(--accent, #f59e0b)',
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
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: 16,
          padding: '16px 24px 24px',
        }}
      >
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {activeTab === 'sku' && (
            <>
              {/* KPI Cards */}
              <KpiCards kpi={assessment.kpi} dsl={assessment.dsl} />

              {/* Path Breadcrumb */}
              <PathBreadcrumb path={assessment.path} />

              {/* SKU Table */}
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
                <button className="btn btn-out" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
                  + 新增组织
                </button>
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
                        <button className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab !== 'sku' && activeTab !== 'multi' && (
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
              <h3 style={{ margin: '0 0 12px' }}>
                {TABS.find((t) => t.key === activeTab)?.label}
              </h3>
              <div
                style={{
                  border: '2px dashed var(--line)',
                  borderRadius: 'var(--r-md)',
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--ink-3)',
                }}
              >
                <p>此 Tab 内容占位</p>
                <p style={{ fontSize: 12 }}>Phase B 后续迭代补充</p>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <SidePanel kpi={assessment.kpi} summary={assessment.summary} aiCopilot={assessment.aiCopilot} />
      </div>

    </div>
  )
}
