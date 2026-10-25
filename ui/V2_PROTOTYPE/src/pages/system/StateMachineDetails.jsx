const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

function StatusPill({ status, isInitial }) {
  const color = status.terminal
    ? 'border-line-2 bg-bg-soft text-ink-2'
    : isInitial ? 'border-brand/20 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink-2'
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border border-solid px-2.5 py-1 text-xs leading-5 ${color}`} title={status.description}>
      {status.label}
      {isInitial && <span className="text-xs">初始</span>}
      {status.terminal && <span className="text-xs">终态</span>}
    </span>
  )
}

function TransitionTable({ axis }) {
  const labelOf = (key) => axis.statuses.find((status) => status.key === key)?.label || key
  const cellClass = 'border-0 border-b border-solid border-line px-4 py-3 text-left align-top text-xs leading-6 text-ink-2'
  return (
    <div className={`min-w-0 overflow-x-auto rounded-md border border-solid border-line ${focusClass}`} role="region" aria-label={`${axis.label}流转规则`} tabIndex={0}>
      <table className="w-full min-w-160 border-collapse" aria-label={`${axis.label}流转规则`}>
        <thead className="bg-bg-soft">
          <tr>{['起始态', '目标态', '触发动作', '前置守卫', '落地'].map((label) => <th key={label} scope="col" className={`${cellClass} whitespace-nowrap font-semibold`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {axis.transitions.map((transition, index) => (
            <tr key={`${transition.from}-${transition.to}-${index}`} className="bg-surface">
              <td className={`${cellClass} whitespace-nowrap`}>{labelOf(transition.from)}</td>
              <td className={`${cellClass} whitespace-nowrap`}>{labelOf(transition.to)}</td>
              <td className={`${cellClass} max-w-80 wrap-anywhere`}>{transition.trigger}</td>
              <td className={`${cellClass} max-w-80 wrap-anywhere`}>{transition.guard}</td>
              <td className={`${cellClass} whitespace-nowrap`}>
                <span className={transition.implemented ? 'text-ok-ink' : 'inline-flex rounded-sm bg-warn-soft px-2 font-medium text-warn-ink'}>{transition.implemented ? '已落地' : '未实现'}</span>
              </td>
            </tr>
          ))}
          {axis.transitions.length === 0 && <tr><td colSpan={5} className={cellClass}>目录未声明状态流转</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function AxisBlock({ axis }) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="m-0 text-sm leading-6 font-semibold text-ink">{axis.label}</h4>
        <span className="font-mono text-xs text-ink-2">{axis.key}</span>
        <span className="ml-auto text-xs text-ink-2">{axis.statuses.length} 个状态 · {axis.transitions.length} 条流转</span>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label={`${axis.label}状态集合`}>
        {axis.statuses.map((status) => <StatusPill key={status.key} status={status} isInitial={axis.initial === status.key} />)}
      </div>
      <TransitionTable axis={axis} />
    </div>
  )
}

export default function StateMachineDetails({ descriptor }) {
  return (
    <div className="min-w-0 space-y-6">
      {descriptor.axes.map((axis) => <AxisBlock key={axis.key} axis={axis} />)}
      {descriptor.invariants.length > 0 && (
        <div className="rounded-md bg-bg-soft px-4 py-3">
          <h4 className="m-0 text-xs font-semibold leading-6 text-ink">约束规则</h4>
          <ul className="m-0 pl-4 text-xs leading-6 text-ink-2">{descriptor.invariants.map((text) => <li key={text}>{text}</li>)}</ul>
        </div>
      )}
      <div className="min-w-0 text-xs leading-5 text-ink-2">
        <span className="mr-2 font-medium">源码位置</span>
        <code className="font-mono wrap-anywhere">{descriptor.sourceRef}</code>
      </div>
    </div>
  )
}
