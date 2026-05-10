import React from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

export default function ReviewDetail() {
  const checklist = [
    { type: '必检', name: '接口覆盖完整', status: '通过' },
    { type: '必检', name: '权限校验齐备', status: '通过' },
    { type: '必检', name: '关键异常处理', status: '通过' },
    { type: '建议', name: '命名统一性', status: '待审' },
    { type: '建议', name: '日志粒度', status: '待审' },
  ]

  const comments = [
    { name: '王丽', time: '2026-04-18 09:20', text: '方案覆盖度较好，但审批流异常分支需要再补充。' },
    { name: '陈晨', time: '2026-04-18 10:05', text: '收到，今天补齐后重新提交。' },
  ]

  const deliverables = [
    { name: '实施 SOW', type: 'PDF', status: 'pending' },
    { name: '详细实施方案', type: 'DOCX', status: 'pending' },
    { name: '实施计划', type: 'MD', status: 'pending' },
    { name: '对外报价单', type: 'XLSX', status: 'pending' },
  ]

  const typeMap = {
    PDF: { bg: 'var(--info-soft)', co: 'var(--info)' },
    DOCX: { bg: 'var(--brand-soft)', co: 'var(--brand)' },
    MD: { bg: 'var(--teal-soft)', co: 'var(--teal)' },
    XLSX: { bg: 'var(--accent-soft)', co: 'var(--accent)' },
  }

  return (
    <PageShell
      crumb="工作台 / 评审 / 评审详情"
      title="评审"
      subtitle="评审中 · 还剩 2 天"
      actions={[
        <button key="jump" className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>↗ 跳转方案 v07</button>,
        <button key="reject" className="btn btn-dan" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>✕ 驳回</button>,
        <button key="pass" className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }} disabled>✓ 通过</button>,
      ]}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>关联方案</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>AE-2026-0418 · 付款/库存/报表</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>发起人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>陈晨 · 产品经理</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>评审人</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>王丽 · 后端架构师</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>截止时间</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}><span style={{ color: 'var(--accent-ink)', fontWeight: 800 }}>还剩 2 天</span> · 2026-04-20</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, padding: '16px 18px 18px' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>Checklist</span><span className="bdg ci"><span className="dot" />5 项</span></div>
            <div className="bd" style={{ padding: 0 }}>
              {checklist.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 92px 1fr 92px', gap: 10, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--line)' }}>
                  <span>{it.status === '通过' ? '☑' : '☐'}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{it.type}</span>
                  <span>{it.name}</span>
                  <span style={{ color: it.status === '通过' ? 'var(--ok)' : 'var(--ink-3)', fontWeight: 700 }}>{it.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>评审评论</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>2 条评论</span></div>
            <div className="bd">
              {comments.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg,var(--brand-soft),var(--brand))', color: 'var(--brand-ink)', fontWeight: 800, fontSize: 12 }}>{c.name[0]}</div>
                  <div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{c.name}</strong>
                      <span style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{c.time}</span>
                    </div>
                    <div style={{ marginTop: 4, color: 'var(--ink-2)', lineHeight: 1.7 }}>{c.text}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 14 }}>
                <textarea placeholder="请输入新增评论..." style={{ width: '100%', minHeight: 92, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', font: '500 13px/1.6 var(--font-sans)', resize: 'vertical', background: '#fff' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button className="btn btn-pri" style={{ height: 32, fontSize: 12, padding: '0 12px' }}>发表评论</button>
                </div>
              </div>
            </div>
          </div>

          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>PM 交付物</span>
              <span className="bdg ci"><span className="dot" />4 项</span>
              <button className="btn btn-pri" style={{ height: 28, padding: '0 10px', fontSize: 12, marginLeft: 'auto' }}>✦ 一键全部生成</button>
            </div>
            <div className="bd" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr><th>文件</th><th>类型</th><th className="num">生成时间</th><th>状态</th><th className="num">操作</th></tr>
                </thead>
                <tbody>
                  {deliverables.map((d, i) => {
                    const t = typeMap[d.type]
                    return (
                      <tr key={i}>
                        <td>{d.name}</td>
                        <td><span className="bdg" style={{ background: t.bg, color: t.co, fontSize: 10.5, padding: '1px 7px' }}>{d.type}</span></td>
                        <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>—</td>
                        <td><span style={{ color: 'var(--ink-3)', fontSize: 12 }}>未生成</span></td>
                        <td className="num"><button className="btn btn-pri" style={{ height: 24, padding: '0 8px', fontSize: 11 }}>生成</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 18, height: 'fit-content' }}>
          <div className="section" style={{ margin: 0 }}>
            <div className="hd"><span>完整度</span><span className="bdg ok"><span className="dot" />60%</span></div>
            <div className="bd" style={{ textAlign: 'center' }}>
              <div style={{ width: 128, height: 128, borderRadius: '50%', background: 'conic-gradient(var(--brand) 0 60%, var(--line-2) 60% 100%)', display: 'grid', placeItems: 'center', margin: '2px auto 8px', position: 'relative' }}>
                <div style={{ width: 82, height: 82, borderRadius: '50%', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)' }} />
                <div style={{ position: 'absolute', textAlign: 'center', fontWeight: 800, color: 'var(--ink)' }}>
                  <div style={{ fontSize: 28, lineHeight: 1 }}>60%</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>3 / 5</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>5 项中 3 项通过，2 项待审</div>
            </div>
          </div>

          <div className="section" style={{ marginTop: 16 }}>
            <div className="hd"><span>关联文档</span><span style={{ fontSize: 11, color: 'var(--ink-3)' }}>跳转</span></div>
            <div className="bd">
              {['实施评估', '资源成本', '需求'].map((t) => (
                <a key={t} href="#" style={{ display: 'block', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, background: '#fff', marginBottom: 8, textDecoration: 'none', color: 'var(--ink)' }}>{t}</a>
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 14, boxShadow: 'var(--shadow-1)', marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>PM 接力</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>下一节点</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>来自</span><span style={{ fontWeight: 600 }}>王丽 · 售前架构师</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>交接给</span><span style={{ fontWeight: 600 }}>刘洋 · 项目经理</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}><span style={{ color: 'var(--ink-3)' }}>截止时间</span><span style={{ fontWeight: 600, color: 'var(--accent-ink)' }}>还剩 2 天 · 2026-04-26 18:00</span></div>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10, height: 32, fontSize: 12 }}>⤳ 发起接力</button>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
