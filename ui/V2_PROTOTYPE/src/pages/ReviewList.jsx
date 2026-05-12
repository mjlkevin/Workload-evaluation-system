import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useReviewList from '../hooks/useReviewList.js'
import { reviews as mockData } from '../mock/listData.js'

export default function ReviewList() {
  const navigate = useNavigate()
  const { rows, refetch, create, creating } = useReviewList({ fallbackData: mockData })

  const handleBulkAction = (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      navigate(`/reviews/${first.id}`)
      return
    }
    if (actionKey === 'history' && first) {
      alert(`评审流转记录 · ${first.id}`)
      return
    }
    if (actionKey === 'delete') {
      alert('评审模块暂不支持删除，请联系管理员手动清理数据')
    }
  }

  return (
    <ListPage
      crumb="工作台 / 评审管理"
      title="评审列表"
      subtitle="方案评审流程与审批追踪"
      data={rows}
      rowKey="id"
      onRowClick={(row) => navigate(`/reviews/${row.id}`)}
      onBulkAction={handleBulkAction}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: '待评审', label: '待评审' },
        { key: '已通过', label: '已通过' },
        { key: '驳回', label: '驳回' },
      ]}
      columns={[
        { key: 'id', title: '评审号' },
        { key: 'projectName', title: '关联方案' },
        { key: 'version', title: '关联版本' },
        { key: 'reviewers', title: '评审人' },
        { key: 'deadline', title: '截止时间' },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'updatedAt', title: '更新时间' },
      ]}
      actions={[
        <button type="button" key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}} disabled={creating} onClick={async () => { const id = await create(); if (id) navigate(`/reviews/${id}`) }}>{creating ? '创建中...' : '+ 新建'}</button>,
        <button type="button" key="refresh" className="btn btn-out" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => refetch()}>⟳ 刷新</button>,
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
