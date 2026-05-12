import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useAssessmentList from '../hooks/useAssessmentList.js'
import { assessments as mockData } from '../mock/listData.js'

export default function AssessmentList() {
  const navigate = useNavigate()
  const { rows, creating, refetch, create, remove } = useAssessmentList({ fallbackData: mockData })
  const openDetail = (row) => {
    const id = row?.id || row?.raw?.versionRecordId || row?.raw?.id || row?.raw?.versionCode || row?.assessmentVersion
    if (!id) {
      alert('当前记录缺少实施评估详情标识，无法打开详情')
      return
    }
    navigate(`/assessments/${encodeURIComponent(id)}`)
  }

  const handleBulkAction = async (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      openDetail(first)
      return
    }
    if (actionKey === 'history' && first) {
      alert(`版本历史 · ${first.assessmentVersion || first.globalVersion}`)
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
      crumb="工作台 / 实施评估"
      title="实施评估列表"
      data={rows}
      rowKey="id"
      onRowClick={openDetail}
      onBulkAction={handleBulkAction}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'checked-out', label: '已检出', predicate: (row) => row.status === '已检出' },
        { key: 'checked-in', label: '已检入', predicate: (row) => row.status === '已检入' },
        { key: 'in-progress', label: '进行中', predicate: (row) => row.status === '进行中' },
      ]}
      columns={[
        { key: 'projectName', title: '项目名称' },
        { key: 'productLine', title: '产品线', render: (r) => <span className="bdg" style={{background:'var(--brand-soft)',color:'var(--brand)',padding:'2px 8px',borderRadius:999,fontSize:11}}>{r.productLine}</span> },
        { key: 'globalVersion', title: '总方案' },
        { key: 'assessmentVersion', title: '最新版本' },
        { key: 'quoteMode', title: '报价模式' },
        { key: 'totalDays', title: '总人天', align: 'right', getter: (r) => r.totalDays.toFixed(1) },
        { key: 'orgCount', title: '组织数', align: 'right' },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'owner', title: '创建/修改人' },
        { key: 'updatedAt', title: '更新时间' },
      ]}
      actions={[
        <button type="button" key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}} disabled={creating} onClick={async () => { const id = await create(); if (id) navigate(`/assessments/${id}`) }}>{creating ? '创建中...' : '+ 新建'}</button>,
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
