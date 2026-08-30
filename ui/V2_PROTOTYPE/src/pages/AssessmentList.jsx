import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useAssessmentList from '../hooks/useAssessmentList.js'
import { assessments as mockData } from '../mock/listData.js'

export default function AssessmentList() {
  const navigate = useNavigate()
  const { rows, loading, loadError, creating, refetch, create, remove } = useAssessmentList({ fallbackData: mockData })

  const kpiCards = useMemo(() => {
    const total = rows.length
    const checkedOut = rows.filter((r) => r.status === '已检出').length
    const checkedIn = rows.filter((r) => r.status === '已检入').length
    const totalDays = rows.reduce((s, r) => s + (r.totalDays || 0), 0)
    return [
      { ic: '▣', lb: '评估总数', num: total, pct: 100, barColor: 'var(--brand)', sub: `共 ${total} 条评估` },
      { ic: '✎', lb: '已检出', num: checkedOut, pct: total ? Math.round(checkedOut / total * 100) : 0, barColor: 'var(--accent)', sub: '正在编辑中' },
      { ic: '✓', lb: '已检入', num: checkedIn, pct: total ? Math.round(checkedIn / total * 100) : 0, barColor: 'var(--ok)', sub: '已提交锁定' },
      { ic: '◔', lb: '总人天', num: totalDays.toFixed(1), pct: 100, barColor: 'var(--teal, #0d9488)', sub: '累计评估人天' },
    ]
  }, [rows])

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
      subtitle="查看评估概览与版本管理"
      data={rows}
      loading={loading}
      loadingText="正在加载实施评估列表…"
      error={loadError}
      errorText="加载实施评估列表失败，请检查网络后重试"
      onRetry={refetch}
      rowKey="id"
      kpiCards={kpiCards}
      onRowClick={openDetail}
      onBulkAction={handleBulkAction}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'ai-draft', label: 'AI 草稿', predicate: (row) => row.isAiDraft },
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
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} isAiDraft={r.isAiDraft} /> },
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

function StatusBadge({ status, isAiDraft }) {
  const map = {
    'AI 草稿': { bg: 'var(--brand-soft)', color: 'var(--brand-ink)' },
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
      {isAiDraft ? 'AI · ' : ''}{status}
    </span>
  )
}
