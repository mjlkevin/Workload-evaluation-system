import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useDevAssessmentList from '../hooks/useDevAssessmentList.js'
import { devAssessments as mockData } from '../mock/listData.js'

export default function DevAssessmentList() {
  const navigate = useNavigate()
  const { rows, creating, refetch, create } = useDevAssessmentList({ fallbackData: mockData })

  const handleBulkAction = (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      navigate(`/dev-assessments/${first.id}`)
      return
    }
    if (actionKey === 'history' && first) {
      alert(`版本历史 · ${first.devVersion || first.globalVersion}`)
      return
    }
    if (actionKey === 'delete') {
      alert('开发评估模块暂不支持删除，请联系管理员手动清理数据')
    }
  }

  return (
    <ListPage
      crumb="工作台 / 开发评估"
      title="开发评估"
      data={rows}
      rowKey="id"
      onRowClick={(row) => navigate(`/dev-assessments/${row.id}`)}
      onBulkAction={handleBulkAction}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'checked-in', label: '已检入' },
        { key: 'in-progress', label: '进行中' },
      ]}
      columns={[
        { key: 'projectName', title: '项目名称' },
        { key: 'globalVersion', title: '总方案' },
        { key: 'devVersion', title: '最新版本' },
        { key: 'assessor', title: '评估人' },
        { key: 'totalDays', title: '总人天', align: 'right', getter: (r) => r.totalDays.toFixed(1) },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'owner', title: '创建/修改人' },
        { key: 'updatedAt', title: '更新时间' },
      ]}
      actions={[
        <button type="button" key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}} disabled={creating} onClick={async () => { const id = await create(); if (id) navigate(`/dev-assessments/${id}`) }}>{creating ? '创建中...' : '+ 新建'}</button>,
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
