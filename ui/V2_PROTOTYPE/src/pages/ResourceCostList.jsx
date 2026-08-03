import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useResourceCostList from '../hooks/useResourceCostList.js'
import { resourceCosts as mockData } from '../mock/listData.js'

export default function ResourceCostList() {
  const navigate = useNavigate()
  const { rows, creating, refetch, create, remove } = useResourceCostList({ fallbackData: mockData })

  const kpiCards = useMemo(() => {
    const total = rows.length
    const checkedOut = rows.filter((r) => r.status === '已检出').length
    const checkedIn = rows.filter((r) => r.status === '已检入').length
    const totalDays = rows.reduce((s, r) => s + (r.totalDays || 0), 0)
    return [
      { ic: '$', lb: '成本方案', num: total, pct: 100, barColor: 'var(--brand)', sub: `共 ${total} 条` },
      { ic: '✎', lb: '已检出', num: checkedOut, pct: total ? Math.round(checkedOut / total * 100) : 0, barColor: 'var(--accent)', sub: '正在编辑' },
      { ic: '✓', lb: '已检入', num: checkedIn, pct: total ? Math.round(checkedIn / total * 100) : 0, barColor: 'var(--ok)', sub: '已提交' },
      { ic: '◔', lb: '总人天', num: totalDays.toFixed(1), pct: 100, barColor: 'var(--teal, #0d9488)', sub: '累计资源人天' },
    ]
  }, [rows])

  const handleBulkAction = async (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      navigate(`/resource-costs/${first.id}`)
      return
    }
    if (actionKey === 'history' && first) {
      alert(`版本历史 · ${first.resourceVersion || first.globalVersion}`)
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
      crumb="工作台 / 资源成本"
      title="资源及人天成本"
      subtitle="查看资源成本概览与版本管理"
      data={rows}
      rowKey="id"
      kpiCards={kpiCards}
      onRowClick={(row) => navigate(`/resource-costs/${row.id}`)}
      onBulkAction={handleBulkAction}
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
        <button type="button" key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}} disabled={creating} onClick={async () => { const id = await create(); if (id) navigate(`/resource-costs/${id}`) }}>{creating ? '创建中...' : '+ 新建'}</button>,
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
