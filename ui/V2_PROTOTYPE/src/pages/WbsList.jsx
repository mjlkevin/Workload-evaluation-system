import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import { wbsItems } from '../mock/listData.js'

export default function WbsList() {
  const navigate = useNavigate()
  return (
    <ListPage
      crumb="工作台 / WBS 任务"
      title="WBS 任务列表"
      subtitle="工作分解结构与任务进度跟踪"
      data={wbsItems}
      rowKey="id"
      onRowClick={(row) => navigate(`/wbs/${row.id}`)}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'completed', label: '已完成' },
        { key: 'in-progress', label: '进行中' },
      ]}
      columns={[
        { key: 'name', title: '任务名称' },
        { key: 'assignee', title: '负责人' },
        { key: 'start', title: '开始日期' },
        { key: 'end', title: '结束日期' },
        { key: 'progress', title: '进度', align: 'right', getter: (r) => `${r.progress}%` },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      actions={[
        <button key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}}>+ 新建</button>,
        <button key="refresh" className="btn btn-out" style={{height:32,padding:'0 14px',fontSize:13}}>⟳ 刷新</button>,
      ]}
    />
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
