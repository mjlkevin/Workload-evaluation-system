import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useRequirementList from '../hooks/useRequirementList.js'
import { requirements as mockData } from '../mock/listData.js'

export default function RequirementList() {
  const navigate = useNavigate()
  const { rows, creating, refetch, create, remove } = useRequirementList({ fallbackData: mockData })

  const handleBulkAction = async (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      navigate(`/requirements/${first.id}`)
      return
    }
    if (actionKey === 'history' && first) {
      alert(`版本历史 · ${first.versionCode || first.globalVersion}`)
      return
    }
    if (actionKey === 'delete') {
      const vcList = selectedRows.map((r) => r.raw?.versionCode).filter(Boolean)
      if (!vcList.length) return
      for (const vc of vcList) await remove(vc)
      alert(`已删除 ${vcList.length} 条`)
    }
  }

  return (
    <ListPage
      crumb="工作台 / 需求管理"
      title="需求管理列表"
      data={rows}
      rowKey="id"
      onRowClick={(row) => navigate(`/requirements/${row.id}`)}
      onBulkAction={handleBulkAction}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'in-progress', label: '进行中', predicate: (row) => row.status === '进行中' },
        { key: 'published', label: '已发布', predicate: (row) => row.status === '已发布' },
        { key: 'reviewing', label: '评审中', predicate: (row) => row.status === '评审中' },
      ]}
      columns={[
        { key: 'globalVersion', title: '总方案版本号' },
        { key: 'versionCode', title: '需求版本号' },
        { key: 'projectName', title: '项目名称' },
        { key: 'productLine', title: '产品线', render: (r) => <span className="bdg" style={{background:'var(--brand-soft)',color:'var(--brand)',padding:'2px 8px',borderRadius:999,fontSize:11}}>{r.productLine}</span> },
        { key: 'customer', title: '客户名称' },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'creator', title: '创建人' },
        { key: 'updater', title: '修改人' },
        { key: 'updatedAt', title: '更新时间' },
      ]}
      actions={[
        <button type="button" key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}} disabled={creating} onClick={async () => { const id = await create(); if (id) navigate(`/requirements/${id}`) }}>{creating ? '创建中...' : '+ 新建'}</button>,
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
