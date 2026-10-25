// The backend catalog is the source of truth. This page never writes rule/status data.
import { useRef, useState } from 'react'
import { useStateMachineCatalog } from '../../hooks/useStateMachineCatalog.js'
import SystemObjectList, { SystemBadge, systemButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import StateMachineDetails from './StateMachineDetails.jsx'

const filters = [
  { value: 'business_object', label: '业务对象', matches: (item) => item.domain === 'business_object' },
  { value: 'version_document', label: '版本文档', matches: (item) => item.domain === 'version_document' },
]
const counts = (item) => {
  const transitions = item.axes.flatMap((axis) => axis.transitions)
  return {
    statuses: item.axes.reduce((total, axis) => total + axis.statuses.length, 0),
    transitions: transitions.length,
    pending: transitions.filter((transition) => !transition.implemented).length,
  }
}
const searchText = (item) => [
  item.id, item.objectLabel, item.sourceRef, ...item.invariants,
  ...item.axes.flatMap((axis) => [axis.key, axis.label,
    ...axis.statuses.flatMap((status) => [status.key, status.label, status.description]),
    ...axis.transitions.flatMap((transition) => [transition.trigger, transition.guard]),
  ]),
].join(' ')

export default function StateMachinesSection() {
  const { items, loading, error, load } = useStateMachineCatalog()
  const [selected, setSelected] = useState(null)
  const searchRef = useRef(null)
  const columns = [
    { key: 'objectLabel', label: '业务对象', render: (item) => <div className="min-w-0"><button type="button" className={`${systemTextButton} h-auto min-h-7 justify-start px-0 text-left font-semibold wrap-anywhere`} onClick={() => setSelected(item)}>{item.objectLabel}</button><div className="font-mono text-xs leading-5 text-ink-2 wrap-anywhere">{item.id}</div></div> },
    { key: 'domain', label: '所属域', hideBelow: 'md', render: (item) => <span className="whitespace-nowrap text-xs text-ink-2">{item.domain === 'version_document' ? '版本文档' : '业务对象'}</span> },
    { key: 'axes', label: '状态维度', hideBelow: 'lg', render: (item) => <span className="text-xs tabular-nums text-ink-2">{item.axes.length} 个维度</span> },
    { key: 'statuses', label: '状态数', hideBelow: 'lg', render: (item) => <span className="text-xs tabular-nums text-ink-2">{counts(item).statuses}</span> },
    { key: 'transitions', label: '流转数', hideBelow: 'lg', render: (item) => <span className="text-xs tabular-nums text-ink-2">{counts(item).transitions}</span> },
    { key: 'coverage', label: '落地情况', render: (item) => { const pending = counts(item).pending; return <SystemBadge tone={pending ? 'warn' : 'neutral'}>{pending ? `${pending} 项未实现` : counts(item).transitions ? '已声明流转均落地' : '未声明流转'}</SystemBadge> } },
    { key: 'actions', label: '操作', render: (item) => <button type="button" className={systemTextButton} aria-label={`查看 ${item.objectLabel}`} onClick={() => setSelected(item)}>查看</button> },
  ]
  return <div className="min-w-0 space-y-4 pb-6">
    <div className="flex flex-wrap items-center gap-2 text-xs leading-6 text-ink-2"><SystemBadge>只读目录</SystemBadge><span>状态、流转和守卫以规则目录为准。</span></div>
    <SystemObjectList title="状态机对象" rows={items} columns={columns} filters={filters} filterAllLabel="全部域" loading={loading} error={error} onRetry={load} searchInputRef={searchRef} searchText={searchText} actions={<button type="button" className={systemButton} onClick={load} disabled={loading}>刷新</button>} />
    <SystemObjectDialog open={Boolean(selected)} title="状态机规则详情" description={selected?.objectLabel} onClose={() => setSelected(null)} fallbackFocusRef={searchRef}>
      {selected && <StateMachineDetails descriptor={selected} />}
    </SystemObjectDialog>
  </div>
}
