import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useRequirementList from '../hooks/useRequirementList.js'
import { requirements as mockData } from '../mock/listData.js'

export default function RequirementList() {
  const navigate = useNavigate()
  const { rows, loading, loadError, creating, refetch, create, remove } = useRequirementList({ fallbackData: mockData })

  const kpiCards = useMemo(() => {
    const total = rows.length
    const inProgress = rows.filter((r) => r.status === '进行中' || r.status === '评审中').length
    const published = rows.filter((r) => r.status === '已发布' || r.status === '已通过').length
    const customers = new Set(rows.map((r) => r.customer).filter(Boolean)).size
    return [
      { ic: '✎', lb: '需求总数', num: total, pct: 100, barColor: 'var(--brand)', sub: `共 ${total} 条需求` },
      { ic: '◎', lb: '进行中', num: inProgress, pct: total ? Math.round(inProgress / total * 100) : 0, barColor: 'var(--info)', sub: '待完成的需求' },
      { ic: '✓', lb: '已发布', num: published, pct: total ? Math.round(published / total * 100) : 0, barColor: 'var(--ok)', sub: '已完成发布' },
      { ic: '☺', lb: '客户数', num: customers, pct: 100, barColor: 'var(--accent)', sub: `涉及 ${customers} 个客户` },
    ]
  }, [rows])

  const handleBulkAction = async (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      navigate(`/requirements/${first.id}`)
      return
    }
    if (actionKey === 'aiEvaluation' && first) {
      navigate(`/requirements/${first.id}/ai-evaluation`)
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
      subtitle="查看需求概览与版本管理"
      data={rows}
      loading={loading}
      loadingText="正在加载需求列表…"
      error={loadError}
      errorText="加载需求列表失败，请检查网络后重试"
      onRetry={refetch}
      rowKey="id"
      kpiCards={kpiCards}
      onRowClick={(row) => navigate(`/requirements/${row.id}`)}
      onBulkAction={handleBulkAction}
      bulkActions={[
        { key: 'preview', label: '👁 预览', mode: 'single' },
        { key: 'edit', label: '✏ 修改', mode: 'single' },
        { key: 'aiEvaluation', label: '✦ AI 评估', mode: 'single' },
        { key: 'history', label: '🕘 历史', mode: 'single' },
        { key: 'delete', label: '🗑 删除', mode: 'multi', danger: true },
      ]}
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
