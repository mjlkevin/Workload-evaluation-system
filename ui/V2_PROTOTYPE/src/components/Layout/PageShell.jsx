import React from 'react'
import { Link } from 'react-router-dom'

const CRUMB_ROUTE_MAP = {
  工作台: '/',
  主页: '/',
  'AI 工作台': '/',
  传统工作台: '/',
  项目评估工作台: '/',
  需求: '/requirements',
  需求管理: '/requirements',
  实施评估: '/assessments',
  开发评估: '/dev-assessments',
  资源成本: '/resource-costs',
  资源人天及成本: '/resource-costs',
  WBS: '/wbs',
  评审: '/reviews',
  评审管理: '/reviews',
  历史: '/history',
  历史项目: '/history',
  历史项目库: '/history',
  系统管理: undefined,
  用户管理: '/users',
  API密钥: '/api-keys',
  'API 密钥': '/api-keys',
  API密钥与接入: '/api-keys',
  'API 密钥与接入': '/api-keys',
}

function normalizeCrumbs(crumb) {
  if (Array.isArray(crumb)) {
    return crumb
      .map((item) => (typeof item === 'string' ? { label: item.trim() } : item))
      .filter((item) => item?.label)
  }
  return String(crumb || '')
    .split('/')
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => ({ label, to: CRUMB_ROUTE_MAP[label] }))
}

function Crumbs({ crumb }) {
  const items = normalizeCrumbs(crumb)
  if (!items.length) return null

  return (
    <nav className="page-crumbs" aria-label="页面路径">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        const to = item.to || CRUMB_ROUTE_MAP[item.label]
        return (
          <React.Fragment key={`${item.label}-${index}`}>
            {to ? (
              <Link to={to} aria-current={isLast ? 'page' : undefined}>{item.label}</Link>
            ) : (
              <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
            )}
            {!isLast && <span className="sep">/</span>}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

export default function PageShell({ crumb, title, subtitle, actions, children, fillViewport = false }) {
  return (
    <div
      style={fillViewport ? {
        height: 'calc(100vh - var(--workspace-tabs-height, 0px))',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      } : undefined}
    >
      <div
        className="pg-hd"
        style={{
          padding: fillViewport ? '10px 24px 8px' : '18px 24px 14px',
          borderBottom: '1px solid var(--line)',
          position: fillViewport ? 'relative' : 'sticky',
          top: fillViewport ? undefined : 0,
          background: 'var(--bg)',
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        {crumb && <Crumbs crumb={crumb} />}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: fillViewport ? 16 : 20, fontWeight: 700 }}>{title}</h1>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>{subtitle}</p>
            )}
          </div>
          {actions && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {actions}
            </div>
          )}
        </div>
      </div>
      <div style={{
        padding: '16px 24px 24px',
        ...(fillViewport ? { flex: 1, minHeight: 0, overflow: 'hidden' } : {}),
      }}>
        {children}
      </div>
    </div>
  )
}
