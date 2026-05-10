import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import { resourceCosts } from '../mock/listData.js'

export default function ResourceCostList() {
  const navigate = useNavigate()
  return (
    <ListPage
      crumb="工作台 / 资源成本"
      title="资源成本列表"
      subtitle="资源投入核算与成本管控"
      data={resourceCosts}
      rowKey="id"
      onRowClick={(row) => navigate(`/resource-costs/${row.id}`)}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'checked-in', label: '已检入' },
        { key: 'checked-out', label: '已检出' },
      ]}
      columns={[
        { key: 'projectName', title: '项目名称' },
        { key: 'globalVersion', title: '总方案' },
        { key: 'resourceVersion', title: '最新版本' },
        { key: 'quoteMode', title: '报价模式' },
        { key: 'totalDays', title: '总人天', align: 'right', getter: (r) => r.totalDays.toFixed(1) },
        { key: 'orgCount', title: '组织数', align: 'right' },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'owner', title: '创建/修改人' },
        { key: 'updatedAt', title: '更新时间' },
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
