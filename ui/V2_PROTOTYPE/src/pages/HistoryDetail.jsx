import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function HistoryDetail() {
  return (
    <PageShell
      crumb="工作台 / 历史项目库 / 历史项目详情"
      title="历史项目详情 · 离散制造 ERP 升级"
      subtitle="GL-01 · 离散制造 · 2400 人"
      actions={[
        <button key="clone" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>克隆此方案为新评估</button>,
      ]}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, padding: '16px 18px 18px' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>基本信息</span><span className="bdg ci"><span className="dot" />已交付</span></div>
            <div className="bd">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[{ k: '客户', v: '华东智造' }, { k: '行业', v: '离散制造' }, { k: '规模', v: '2400 人' }, { k: '总人天', v: '1260' }, { k: '总金额', v: '¥ 380 万' }, { k: '年份', v: '2024' }].map((item) => (
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
              {[{ time: '2024-01', title: '需求冻结', desc: '完成一期范围确认，锁定 ERP 主干流程。' }, { time: '2024-03', title: '架构评审', desc: '统一采用分层服务与批量导入方案。' }, { time: '2024-07', title: '上线切换', desc: '按周末窗口切换，风险可控。' }].map((t, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 12, alignItems: 'start' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{t.time}</div>
                  <div>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block', marginRight: 8 }} />
                    <b>{t.title}</b>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>SKU 树形回溯</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>简化展示</span></div>
            <div className="bd" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8, color: 'var(--ink-2)' }}>
              ├─ ERP 核心<br />
              │  ├─ 订单管理<br />
              │  ├─ 库存管理<br />
              │  └─ 财务结算<br />
              ├─ 报表中心<br />
              │  ├─ 经营看板<br />
              │  └─ 明细钻取<br />
              └─ 集成适配<br />
              &nbsp;&nbsp;&nbsp;├─ 主数据同步<br />
              &nbsp;&nbsp;&nbsp;└─ 第三方接口
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>相似度评分</span><span className="bdg ok"><span className="dot" />92%</span></div>
            <div className="bd" style={{ textAlign: 'center' }}>
              <div style={{ width: 170, height: 170, borderRadius: '50%', margin: '10px auto', background: 'conic-gradient(var(--brand) 0 82%, var(--line-2) 82% 100%)', display: 'grid', placeItems: 'center', position: 'relative' }}>
                <div style={{ width: 112, height: 112, borderRadius: '50%', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)' }} />
                <div style={{ position: 'absolute', textAlign: 'center' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)' }}>92%</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>高相似</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>可作为新评估的优先参考案例</div>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>操作</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>快速克隆</span></div>
            <div className="bd">
              <button className="btn btn-pri" style={{ width: '100%' }}>克隆此方案为新评估</button>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>关联团队成员</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>3 人</span></div>
            <div className="bd">
              {[{ n: '王丽', r: '后端架构师' }, { n: '陈晨', r: '产品经理' }, { n: '李峰', r: '前端负责人' }].map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', fontWeight: 800 }}>{m.n[0]}</div>
                  <div><b>{m.n}</b><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.r}</div></div>
                </div>
              ))}
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
