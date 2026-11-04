import { useId, useState } from 'react'
import RailIcon, { railFocus } from '../../../../components/AiWorkbench/RailIcon.jsx'

export default function WorkflowTemplates({ workflows = [], activeWorkflowKey, onStartWorkflow }) {
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  return (
    <section className="flex min-h-0 shrink-0 flex-col border-t border-line pt-3">
      <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}
        className={`flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-1 text-left text-xs text-ink-2 ${railFocus}`}>
        <RailIcon name="workflow" className="size-3.5" />
        <span className="flex-1 font-medium">工作流模板</span>
        <span className="text-[11px] tabular-nums">{workflows.length}</span>
        <RailIcon name="chevron" className={`size-3 ${expanded ? 'rotate-90' : ''}`} />
      </button>
      <div id={listId} hidden={!expanded} className="ai-workflow-list min-h-0 overflow-y-auto" style={{ maxHeight: 220, overflowY: 'auto' }}>
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
              className={`my-0.5 flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-md border-0 px-2.5 py-2 text-left font-sans ${isActive ? 'bg-brand-soft text-brand-ink' : 'bg-transparent text-ink hover:bg-bg-soft'} ${railFocus}`}
            >
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-sm ${isActive ? 'bg-surface text-brand' : 'bg-bg-2 text-ink-2'}`}><RailIcon name="workflow" className="size-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium leading-5">{workflow.title}</span>
                <span className="block truncate text-[11px] leading-4 text-ink-2">{workflow.desc}</span>
              </span>
              {isActive && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-brand" />}
            </button>
          )
        })}
      </div>
    </section>
  )
}
