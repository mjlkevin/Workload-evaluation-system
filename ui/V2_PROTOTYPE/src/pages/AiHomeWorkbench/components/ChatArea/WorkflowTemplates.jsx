const panel = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: '#fff',
  boxShadow: 'var(--shadow-1)',
}

export default function WorkflowTemplates({ workflows, activeWorkflowKey, onStartWorkflow }) {
  return (
    <section style={{ ...panel, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 800, color: 'var(--ink-2)', flexShrink: 0 }}>工作流模板</div>
      <div className="ai-workflow-list" style={{ padding: 10, display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto', minHeight: 0 }}>
        {workflows.map((workflow) => {
          const isActive = activeWorkflowKey === workflow.key
          return (
            <button
              key={workflow.key}
              type="button"
              onClick={() => onStartWorkflow(workflow)}
              title={`${workflow.title}：${workflow.desc}`}
              aria-pressed={isActive}
              aria-label={isActive ? `${workflow.title}（当前任务）` : workflow.title}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                borderRadius: 8,
                background: isActive ? 'var(--accent-soft)' : '#fff',
                cursor: 'pointer',
                fontFamily: 'inherit',
                position: 'relative',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {isActive && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }} aria-hidden>●</span>}
                <b style={{ display: 'block', fontSize: 12, color: 'var(--ink)' }}>{workflow.title}</b>
              </span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>{workflow.desc}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
