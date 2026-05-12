import React from 'react'
import { useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import useHistoryDetail from '../hooks/useHistoryDetail.js'

export default function HistoryDetail() {
  const { id } = useParams()
  const { project: detail } = useHistoryDetail(id)
  const basicFields = [
    { k: '客户', v: detail?.customer || '—' },
    { k: '行业', v: detail?.industry || '—' },
    { k: '规模', v: detail?.scale || '—' },
    { k: '总人天', v: detail?.totalDays || '—' },
    { k: '总金额', v: detail?.totalAmount ? `¥ ${Number(detail.totalAmount).toFixed(1)} 万` : '—' },
    { k: '年份', v: detail?.year || '—' },
  ]
  const modules = detail?.modules?.length ? detail.modules : []
  const similarity = detail?.similarity || 0
  const timeline = detail?.timeline?.length ? detail.timeline : []
  const teamMembers = detail?.teamMembers?.length ? detail.teamMembers : []

  return (
    <PageShell
      crumb="工作台 / 历史项目库 / 历史项目详情"
      title={`历史项目详情 · ${detail?.projectName || '—'}`}
      subtitle={`${detail?.version || '—'} · ${detail?.industry || '—'} · ${detail?.scale || '—'}`}
      actions={[
        <button type="button" key="clone" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>克隆此方案为新评估</button>,
      ]}
    >
      <div className="grid-1fr-280" style={{ padding: '16px 18px 18px' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>基本信息</span><span className="bdg ci"><span className="dot" />{detail?.status || '—'}</span></div>
            <div className="bd">
              <div className="grid-3-eq">
                {basicFields.map((item) => (
                  <div key={item.k} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{item.k}</div>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{item.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>关键决策时间线</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>摘录</span></div>
            <div className="bd" style={{ display: 'grid', gap: 10 }}>
              {timeline.length ? timeline.map((t, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 12, alignItems: 'start' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{t.time}</div>
                  <div>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block', marginRight: 8 }} />
                    <b>{t.title}</b>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.desc}</div>
                  </div>
                </div>
              )) : (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无时间线数据</div>
              )}
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>SKU 树形回溯</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>简化展示</span></div>
            <div className="bd" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8, color: 'var(--ink-2)' }}>
              {modules.length ? modules.map((m, i) => (
                <React.Fragment key={m}>
                  {i === modules.length - 1 ? '└─ ' : '├─ '}{m}<br />
                </React.Fragment>
              )) : (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无模块数据</div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>相似度评分</span><span className="bdg ok"><span className="dot" />{similarity}%</span></div>
            <div className="bd" style={{ textAlign: 'center' }}>
              <div style={{ width: 170, height: 170, borderRadius: '50%', margin: '10px auto', background: `conic-gradient(var(--brand) 0 ${similarity}%, var(--line-2) ${similarity}% 100%)`, display: 'grid', placeItems: 'center', position: 'relative' }}>
                <div style={{ width: 112, height: 112, borderRadius: '50%', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)' }} />
                <div style={{ position: 'absolute', textAlign: 'center' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)' }}>{similarity}%</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>高相似</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>可作为新评估的优先参考案例</div>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>操作</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>快速克隆</span></div>
            <div className="bd">
              <button type="button" className="btn btn-pri" style={{ width: '100%' }}>克隆此方案为新评估</button>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>关联团队成员</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{teamMembers.length} 人</span></div>
            <div className="bd">
              {teamMembers.length ? teamMembers.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', fontWeight: 800 }}>{m.n?.[0] || '?'}</div>
                  <div><b>{m.n}</b><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.r}</div></div>
                </div>
              )) : (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无团队成员数据</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ margin: '0 18px 18px' }}>
        <div className="section" style={{ margin: 0 }}>
          <div className="hd"><span>差异对比</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>当前方案 vs 历史项目</span></div>
          <div className="bd">
            <div style={{ padding: 18, border: '1px dashed var(--line)', borderRadius: 14, color: 'var(--ink-3)', background: 'var(--bg-soft)' }}>
              差异对比占位：在这里展示当前正在做的方案与该历史项目在范围、模块、复杂度、资源投入上的差异。
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
