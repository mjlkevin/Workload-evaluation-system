import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import useAssessmentDetail from '../hooks/useAssessmentDetail.js'
import { apiClient } from '../api/client.js'
import { unwrapList } from '../api/utils.js'
import { mapVcsStatus } from '../hooks/mapVersionStatus.js'
import { useSetUnsavedDirty } from '../hooks/useUnsavedChanges.jsx'
import { downloadJSON } from '../utils/download.js'

import ProjectIdentityCard from '../components/Assessment/ProjectIdentityCard.jsx'
import VcsToolbar from '../components/Assessment/VcsToolbar.jsx'
import ParamMiniBar from '../components/Assessment/ParamMiniBar.jsx'
import AdvancedCollapsible from '../components/Assessment/AdvancedCollapsible.jsx'
import KpiCards from '../components/Assessment/KpiCards.jsx'
import PathBreadcrumb from '../components/Assessment/PathBreadcrumb.jsx'
import SkuTable from '../components/Assessment/SkuTable.jsx'
import DslBanner from '../components/Assessment/DslBanner.jsx'
import SidePanel from '../components/Assessment/SidePanel.jsx'

function getTabs(vm) {
  const skuCount = vm.skuGroups?.length || 0
  return [
    { key: 'sku', label: '模块明细', count: skuCount || undefined },
    { key: 'multi', label: '多组织推广估算', badge: vm.multiOrg?.incompleteCount },
    { key: 'diff', label: '变更对比' },
    { key: 'dsl', label: 'DSL 规则审阅', count: vm.dsl?.issues?.length || undefined },
    { key: 'story', label: '五段叙事' },
    { key: 'sow', label: '附件 SOW' },
  ]
}

export default function AssessmentDetail() {
  const { id } = useParams()
  const [activeTab, setActiveTab] = useState('sku')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [aiConfirmError, setAiConfirmError] = useState('')
  const vm = useAssessmentDetail(id)
  const setUnsavedDirty = useSetUnsavedDirty()
  const tabs = getTabs(vm)

  useEffect(() => {
    setUnsavedDirty(Boolean(vm.vcs?.hasLocalChanges && !vm.vcs?.isReadonly))
    return () => setUnsavedDirty(false)
  }, [vm.vcs?.hasLocalChanges, vm.vcs?.isReadonly, setUnsavedDirty])

  return (
    <PageShell
      crumb="工作台 / 实施评估 / 详情"
      title="实施评估详情"
      actions={[
        <button type="button" key="hist" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={async () => { setHistoryOpen(true); setHistoryLoading(true); try { const payload = await apiClient.get('/versions', { type: 'assessment' }); const list = unwrapList(payload).filter(r => r.baseCode === (vm.globalVersion || id)); setHistoryRows(list.map(r => ({ version: r.versionCode || r.version || '', status: mapVcsStatus(r), owner: r.checkedOutByUsername || r.updatedByUsername || '—', updatedAt: (r.updatedAt || '').slice(0, 10) }))); } catch (err) { alert('加载历史失败: ' + err.message); } finally { setHistoryLoading(false); } }}>🕘 历史</button>,
        <button type="button" key="export" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => downloadJSON(vm, `assessment-${vm.versionCode || id}.json`)}>↓ 导出</button>,
        <button type="button" key="checkin" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => vm.actions?.checkin?.()}>⇡ 签入</button>,
      ]}
    >
      {/* DSL Banner */}
      <DslBanner dsl={vm.dsl} />

      {/* Top region */}
      <div style={{ padding: '16px 24px 0' }}>
        {vm.raw?.payload?.draftStatus === 'draft_from_ai' && (
          <AiDraftBanner
            record={vm.raw}
            confirming={Boolean(vm.actionLoading?.confirmAiDraft)}
            error={aiConfirmError}
            onConfirm={async () => {
              setAiConfirmError('')
              const result = await vm.actions?.confirmAiDraft?.()
              if (!result?.success) setAiConfirmError(result?.error || '确认失败')
            }}
          />
        )}
        <ProjectIdentityCard data={vm} />
        <VcsToolbar dsl={vm.dsl} hasLocalChanges={vm.vcs?.hasLocalChanges} />
        <ParamMiniBar params={vm.params} />
        <AdvancedCollapsible context={vm.context} />
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
        {tabs.map((t) => (
          <button type="button"
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
        className="grid-1fr-280"
        style={{
          gap: 16,
          padding: '16px 24px 24px',
        }}
      >
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {activeTab === 'sku' && (
            <>
              <KpiCards kpi={vm.kpi} dsl={vm.dsl} />
              {/* ISS-2026-08-18-005（档 2）：估算失败页面内占位（非弹窗）——
                  估算区明确展示「估算暂不可用」，其余评估信息继续展示。 */}
              {vm.estimateError && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-soft)',
                  border: '1px solid var(--line)',
                  color: 'var(--err)',
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span>⚠️</span>
                  <span>估算暂不可用：{vm.estimateError?.message || '估算服务异常'}，已保留其余评估信息</span>
                </div>
              )}
              <PathBreadcrumb path={vm.path} />
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
                <SkuTable groups={vm.skuGroups} />
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
                <button type="button" className="btn btn-out" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>+ 新增组织</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 10px' }}>
                基于组织相似度 <span className="mono">{vm.params.orgSimilarity}</span> 与当前方案估算增量条目与交付策略。
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
                  {vm.multiOrg.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.org}</td>
                      <td>{r.size || '—'}</td>
                      <td>{r.reuseRate != null ? `${r.reuseRate}%` : '—'}</td>
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
                        <button type="button" className="btn btn-ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'diff' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>变更对比</h3>
              {vm.diff && vm.diff.length ? (
                <div className="grid-2-eq" style={{ gap: 14 }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: 'var(--bg-soft)' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, fontWeight: 700 }}>before</div>
                    {vm.diff.map((d) => (
                      <div key={d.field} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                        <span style={{ color: 'var(--ink-3)' }}>{d.field}</span>
                        <span style={{ float: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{d.before}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: '#fff' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, fontWeight: 700 }}>after</div>
                    {vm.diff.map((d) => (
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
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无变更对比数据，签出版本后可查看版本间差异</div>
              )}
            </div>
          )}

          {activeTab === 'dsl' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>DSL 规则审阅</h3>
              {vm.dsl?.issues?.length ? (
                <div className="sys-table-wrap">
                  <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                    <thead>
                      <tr><th>规则 ID</th><th>类型</th><th>说明</th><th>状态</th></tr>
                    </thead>
                    <tbody>
                      {vm.dsl.issues.map((r) => (
                        <tr key={r.ruleId || r.id}>
                          <td className="mono" style={{ fontSize: 12 }}>{r.ruleId || r.id}</td>
                          <td>
                            <span className="bdg" style={{ fontSize: 10.5, padding: '1px 6px', background: r.type === 'blocking' ? 'var(--err-soft)' : 'var(--warn-soft)', color: r.type === 'blocking' ? 'var(--err)' : 'var(--warn-ink)' }}>
                              {r.type === 'blocking' ? '阻断' : '警告'}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.message}</td>
                          <td>
                            <span className={`bdg ${r.blocking ? 'co' : 'ok'}`} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                              <span className="dot" />{r.blocking ? '已触发' : '已通过'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无 DSL 规则审阅数据，完成评估计算后自动生成</div>
              )}
            </div>
          )}

          {activeTab === 'story' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>五段叙事</h3>
              {vm.story && vm.story.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {vm.story.map((p, i) => (
                    <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, background: 'var(--bg-soft)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6, letterSpacing: '.06em', textTransform: 'uppercase' }}>{p.title}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)' }}>{p.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无五段叙事数据，需求结构化完成后自动生成</div>
              )}
            </div>
          )}

          {activeTab === 'sow' && (
            <div className="reg" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 18, boxShadow: 'var(--shadow-1)' }}>
              <h3 style={{ margin: '0 0 12px' }}>附件 SOW</h3>
              {vm.sow && vm.sow.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {vm.sow.map((f) => (
                    <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18 }}>{f.type === 'PDF' ? '📕' : f.type === 'DOCX' ? '📘' : '📗'}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{f.size} · {f.date}</div>
                        </div>
                      </div>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 26 }} onClick={() => downloadJSON(f, `${f.name.replace(/\.[^.]+$/, '')}-metadata.json`)}>下载</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无附件，评估完成后可在此查看生成的 SOW 文件</div>
              )}
            </div>
          )}
        </div>

        {/* Side panel */}
        <SidePanel kpi={vm.kpi} summary={vm.summary} aiCopilot={vm.aiCopilot} />
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

function AiDraftBanner({ record, confirming = false, error = '', onConfirm }) {
  const payload = record?.payload || {}
  const harnessRunId = payload.harnessRunId || ''
  const harnessActionId = payload.harnessActionId || ''
  const versionCode = payload.versionCode || record.versionCode || ''
  const review = payload.aiDraftReview || {}
  const confirmed = review.status === 'confirmed'
  const toolEventId = review.harnessToolEventId || payload.aiDraftHarnessWriteBack?.toolEventId || ''
  const confirmedBy = review.confirmedByUsername || ''
  const confirmedAt = review.confirmedAt ? String(review.confirmedAt).slice(0, 16).replace('T', ' ') : ''

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '12px 16px',
        borderRadius: 12,
        border: '1px solid var(--brand)',
        background: 'var(--brand-soft)',
        color: 'var(--brand-ink)',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 0 }}>AI</span>
        <span>{confirmed ? 'AI 草稿 · 已人工确认' : 'AI 草稿 · 待人工确认'}</span>
      </div>
      <div style={{ color: 'var(--ink-2)', fontSize: 12 }}>
        {confirmed
          ? '该 AI 草稿已完成传统工作台人工确认，并已回写 Harness 审计。后续仍按传统评估流程继续编辑、检入或发布。'
          : '该评估由 Harness AI 生成，尚未进入正式评估流程。请人工审核、编辑并确认后发布。'}
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 18px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        {harnessRunId && <span>Harness Run: {harnessRunId}</span>}
        {harnessActionId && <span>动作: {harnessActionId}</span>}
        {versionCode && <span>版本: {versionCode}</span>}
        {toolEventId && <span>ToolEvent: {toolEventId}</span>}
        {confirmedBy && <span>确认人: {confirmedBy}</span>}
        {confirmedAt && <span>确认时间: {confirmedAt}</span>}
      </div>
      {!confirmed && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-pri"
            style={{ height: 30, fontSize: 12, padding: '0 14px' }}
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? '确认中…' : '确认 AI 草稿'}
          </button>
          <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>确认后会记录 Harness ToolEvent，不会自动发布正式评估。</span>
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: 'var(--err)', fontSize: 12 }}>{error}</div>}
    </div>
  )
}
