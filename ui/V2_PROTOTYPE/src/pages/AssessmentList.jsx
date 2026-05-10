import React from 'react'
import { useNavigate } from 'react-router-dom'
import ListPage from '../components/ListPage.jsx'
import { assessments } from '../mock/listData.js'

export default function AssessmentList() {
  const navigate = useNavigate()
  return (
    <ListPage
      crumb="工作台 / 实施评估"
      title="实施评估列表"
      subtitle="基于模板生成 SKU 人天与 DSL 校验的单据清单"
      data={assessments}
      rowKey="id"
      onRowClick={(row) => navigate(`/assessments/${row.id}`)}
      filterTags={[
        { key: 'all', label: '全部' },
        { key: 'checked-out', label: '已检出' },
        { key: 'checked-in', label: '已检入' },
        { key: 'in-progress', label: '进行中' },
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
