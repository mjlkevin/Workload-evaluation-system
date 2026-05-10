import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import { historyItems } from '../mock/listData.js'

export default function HistoryList() {
  const navigate = useNavigate()
  return (
    <ListPage
      crumb="工作台 / 历史项目"
      title="历史项目列表"
      subtitle="历史项目归档与相似度检索"
      data={historyItems}
      rowKey="id"
      onRowClick={(row) => navigate(`/history/${row.id}`)}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'archived', label: '已归档' },
      ]}
      columns={[
        { key: 'projectName', title: '项目名称', render: (r) => (
          <div>
            <b>{r.projectName}</b>
            <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2 }}>{r.customer} · {r.industry}</div>
          </div>
        ) },
        { key: 'scale', title: '规模', nowrap: true },
        { key: 'totalDays', title: '总人天', align: 'right', getter: (r) => r.totalDays.toFixed(1) },
        { key: 'totalAmount', title: '总金额(万)', align: 'right', getter: (r) => r.totalAmount.toFixed(1) },
        { key: 'year', title: '年份' },
        { key: 'similarity', title: '相似度', render: (r) => <SimilarityBar value={r.similarity} /> },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      actions={[
        <button key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}}>+ 新建</button>,
        <button key="refresh" className="btn btn-out" style={{height:32,padding:'0 14px',fontSize:13}}>⟳ 刷新</button>,
      ]}
    />
  )
}

// v3 §7 相似度进度条 — 进度条 + 百分比，按区间染色
function SimilarityBar({ value }) {
  const color = value >= 80 ? 'var(--ok)' : value >= 60 ? 'var(--brand)' : 'var(--ink-3)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-soft)', overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color, fontWeight: 700, minWidth: 32 }}>{value}%</span>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    '已检出': { bg: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    '已检入': { bg: 'var(--ok-soft)', color: 'var(--ok-ink)' },
    '进行中': { bg: 'var(--info-soft)', color: 'var(--info)' },
    '待评审': { bg: 'var(--warn-soft)', color: 'var(--warn-ink)' },
    '已归档': { bg: 'var(--bg-soft)', color: 'var(--ink-3)' },
    '已发布': { bg: 'var(--ok-soft)', color: 'var(--ok-ink)' },
    '评审中': { bg: 'var(--info-soft)', color: 'var(--info)' },
    '已通过': { bg: 'var(--ok-soft)', color: 'var(--ok-ink)' },
    '驳回': { bg: 'var(--danger-soft)', color: 'var(--danger)' },
    '已完成': { bg: 'var(--ok-soft)', color: 'var(--ok-ink)' },
  }
  const s = map[status] || { bg: 'var(--bg-soft)', color: 'var(--ink-3)' }
  return (
    <span style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:600,background:s.bg,color:s.color}}>
      {status}
    </span>
  )
}
