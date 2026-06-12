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

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  return (
    <PageShell
      crumb="工作台 / AI 工作台"
      title="AI 工作台"
      subtitle={view === 'ai' ? '按登录账号业务角色预置对话工作流' : '已切换为传统主页视图'}
      actions={[
        <div key="switch" style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', height: 32 }}>
          <ViewButton active={view === 'ai'} onClick={() => setView('ai')}>AI 工作台</ViewButton>
          <ViewButton active={view === 'traditional'} onClick={() => setView('traditional')}>传统工作台</ViewButton>
        </div>,
      ]}
    >
      {view === 'ai' ? <AiHomeWorkbench currentUser={user} /> : <TraditionalHomeDashboard embedded />}
    </PageShell>
  )
}
