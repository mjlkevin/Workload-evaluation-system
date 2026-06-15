import PendingActionCard from './PendingActionCard.jsx'

function previewContent(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export default function ArtifactPanel({ session, onConfirmAction, confirmingActionId = '' }) {
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : []
  const pendingActions = (Array.isArray(session?.pendingActions) ? session.pendingActions : []).filter((action) => action.status === 'pending')
  const linked = session?.linkedRecords || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontWeight: 800, fontSize: 13 }}>当前产物</div>
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          {artifacts.length ? artifacts.map((artifact) => (
            <div key={artifact.artifactId || artifact.title} style={{ padding: 10, borderRadius: 8, background: 'var(--bg-soft)' }}>
              <b style={{ fontSize: 12 }}>{artifact.title}</b>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>{previewContent(artifact.content).slice(0, 80)}</p>
            </div>
          )) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>暂无产物</span>}
        </div>
      </section>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontWeight: 800, fontSize: 13 }}>待确认动作</div>
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          {pendingActions.length ? pendingActions.map((action) => (
            <PendingActionCard key={action.actionId || action.title} action={action} onConfirm={onConfirmAction} confirming={confirmingActionId === (action.actionId || action.title)} />
          )) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>暂无待确认动作</span>}
        </div>
      </section>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontWeight: 800, fontSize: 13 }}>关联记录</div>
        <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-2)' }}>
          项目：{linked.projectName || linked.projectId || '未关联'}
        </div>
      </section>
    </div>
  )
}
