import React, { useEffect, useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import useCurrentUser from '../hooks/useCurrentUser.js'
import AiHomeWorkbench from './AiHomeWorkbench.jsx'
import TraditionalHomeDashboard from './TraditionalHomeDashboard.jsx'

const VIEW_KEY = 'wes_home_view'

function ViewButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        height: 32,
        padding: '0 12px',
        border: 0,
        borderLeft: children === '传统工作台' ? '1px solid var(--line)' : 0,
        background: active ? 'var(--brand)' : '#fff',
        color: active ? '#fff' : 'var(--ink)',
        fontFamily: 'inherit',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

export default function HomeWorkspace() {
  const { user } = useCurrentUser()
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'ai')
  const isAiView = view === 'ai'
  const pageTitle = isAiView ? 'AI 工作台' : '项目评估工作台'

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  return (
    <PageShell
      crumb={`工作台 / ${pageTitle}`}
      title={pageTitle}
      subtitle={isAiView ? undefined : '项目评估视图：查看项目评估概览、快速操作和最近动态'}
      fillViewport={isAiView}
      actions={[
        <div key="switch" style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', height: 32 }}>
          <ViewButton active={isAiView} onClick={() => setView('ai')}>AI 工作台</ViewButton>
          <ViewButton active={!isAiView} onClick={() => setView('traditional')}>传统工作台</ViewButton>
        </div>,
      ]}
    >
      {isAiView ? <AiHomeWorkbench currentUser={user} /> : <TraditionalHomeDashboard embedded />}
    </PageShell>
  )
}
