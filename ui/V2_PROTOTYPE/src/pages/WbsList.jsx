import React from 'react'
import ListPage from '../components/ListPage.jsx'
import useWbsList from '../hooks/useWbsList.js'
import { wbsItems as mockData } from '../mock/listData.js'

export default function WbsList() {
  // WBS 详情页 PB-R3 待建；列表行不导航避免 404
  const { rows, refetch } = useWbsList({ fallbackData: mockData })

  const handleBulkAction = (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if ((actionKey === 'preview' || actionKey === 'edit') && first) {
      alert(`WBS 详情页 · PB-R3 待建：${first.name}`)
      return
    }
    if (actionKey === 'history' && first) {
      alert(`WBS 派生记录 · ${first.name}`)
      return
    }
    if (actionKey === 'delete') {
      alert('WBS 任务为方案自动派生，不支持独立删除。请通过方案管理调整')
    }
  }

  return (
    <ListPage
      crumb="工作台 / WBS 任务"
      title="WBS 任务列表"
      subtitle="工作分解结构与任务进度跟踪"
      data={rows}
      rowKey="id"
      onRowClick={(row) => alert('WBS 详情页 · PB-R3 待建')}
      onBulkAction={handleBulkAction}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'completed', label: '已完成' },
        { key: 'in-progress', label: '进行中' },
      ]}
      columns={[
        { key: 'name', title: '任务名称' },
        { key: 'assignee', title: '负责人' },
        { key: 'start', title: '开始', nowrap: true },
        { key: 'end', title: '结束', nowrap: true },
        { key: 'progress', title: '进度', render: (r) => <MiniGantt progress={r.progress} status={r.status} /> },
        { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      actions={[
        <button type="button" key="new" className="btn btn-out" style={{height:32,padding:'0 14px',fontSize:13}} disabled title="WBS 任务由总方案自动派生，不支持手动新建">派生任务</button>,
        <button type="button" key="refresh" className="btn btn-out" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => refetch()}>⟳ 刷新</button>,
      ]}
    />
  )
}

// §6.10.2 迷你甘特列 — 120px 进度条 + 已完成/进行中两段色
function MiniGantt({ progress, status }) {
  const done = status === '已完成' ? 100 : Math.max(0, progress - 20)
  const inProg = status === '已完成' ? 0 : Math.min(20, progress)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 120, height: 8, borderRadius: 4, background: 'var(--bg-soft)', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${done}%`, height: '100%', background: 'var(--ok)' }} />
        <div style={{ width: `${inProg}%`, height: '100%', background: 'var(--brand)' }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', minWidth: 32 }}>{progress}%</span>
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
