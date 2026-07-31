import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import useReviewList from '../hooks/useReviewList.js'
import { reviews as mockData } from '../mock/listData.js'

export default function ReviewList() {
  const navigate = useNavigate()
  const [historyNotice, setHistoryNotice] = useState('')
  const {
    rows,
    loading,
    loadError,
    createError,
    refetch,
    create,
    creating,
  } = useReviewList({ fallbackData: mockData })

  const handleCreate = async () => {
    const result = await create()
    if (result.ok && result.id) {
      navigate(`/reviews/${encodeURIComponent(result.id)}`)
    }
  }

  const handleBulkAction = (actionKey, selectedRows) => {
    const first = selectedRows[0]
    if (actionKey === 'open' && first) {
      navigate(`/reviews/${encodeURIComponent(first.id)}`)
      return
    }
    if (actionKey === 'history' && first) {
      setHistoryNotice(`${first.id} 暂无可展示的评审历史；当前仅支持打开详情查看最新状态。`)
    }
  }

  return (
    <ListPage
      crumb="工作台 / 评审管理"
      title="评审列表"
      subtitle="方案评审流程与审批追踪"
      data={rows}
      loading={loading}
      loadingText="正在加载评审列表…"
      error={loadError}
      errorText="加载评审列表失败，请检查网络后重试"
      onRetry={refetch}
      feedback={createError
        ? { role: 'alert', message: '创建评审失败，请稍后重试' }
        : historyNotice
          ? { role: 'status', message: historyNotice }
          : null}
      rowKey="id"
      onRowClick={(row) => navigate(`/reviews/${encodeURIComponent(row.id)}`)}
      onBulkAction={handleBulkAction}
      bulkActions={[
        { key: 'open', label: '查看详情', mode: 'single' },
        { key: 'history', label: '历史', mode: 'single' },
      ]}
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
        {
          key: 'actions',
          title: '操作',
          nowrap: true,
          render: (r) => (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`查看 ${r.id} 详情`}
              onClick={(event) => {
                event.stopPropagation()
                navigate(`/reviews/${encodeURIComponent(r.id)}`)
              }}
            >
              查看详情
            </button>
          ),
        },
      ]}
      actions={[
        <button type="button" key="new" className="btn btn-pri" style={{height:32,padding:'0 14px',fontSize:13}} disabled={creating} onClick={handleCreate}>{creating ? '创建中...' : '+ 新建'}</button>,
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
