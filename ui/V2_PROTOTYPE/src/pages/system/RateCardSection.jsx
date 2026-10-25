import { useRef, useState } from 'react'
import SystemObjectList, { SystemBadge, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'

export default function RateCardSection({ rates }) {
  const [selected, setSelected] = useState(null)
  const searchRef = useRef(null)
  const columns = [
    { key: 'role', label: '角色', render: (rate) => <button type="button" className={`${systemTextButton} h-auto min-h-8 justify-start px-0 text-left font-semibold`} onClick={() => setSelected(rate)}>{rate.role}</button> },
    { key: 'price', label: '人天单价', render: (rate) => <span className="whitespace-nowrap font-mono text-sm tabular-nums">{rate.price}</span> },
    { key: 'source', label: '来源', hideBelow: 'md', render: () => <span className="text-xs text-ink-2">默认参考数据</span> },
    { key: 'actions', label: '操作', render: (rate) => <button type="button" className={systemTextButton} aria-label={`查看 ${rate.role}`} onClick={() => setSelected(rate)}>查看</button> },
  ]
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-2 text-xs leading-6 text-ink-2"><SystemBadge>只读参考</SystemBadge><span>默认参考数据</span></div>
    <SystemObjectList title="RateCard" searchInputRef={searchRef} rows={rates} rowKey="role" columns={columns} searchText={(rate) => [rate.role, rate.price].join(' ')} />
    <SystemObjectDialog open={Boolean(selected)} title="角色费率详情" description={selected?.role} onClose={() => setSelected(null)} fallbackFocusRef={searchRef}>
      {selected && <SystemObjectFacts items={[{ label: '角色', value: selected.role }, { label: '人天单价', value: selected.price }, { label: '来源', value: '默认参考数据' }, { label: '可用操作', value: '当前仅支持查看' }]} />}
    </SystemObjectDialog>
  </div>
}
