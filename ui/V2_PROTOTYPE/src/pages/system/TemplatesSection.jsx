import { useRef, useState } from 'react'
import SystemObjectList, { SystemBadge, systemButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'

export default function TemplatesSection({ templates, loading, error, onRetry }) {
  const [selected, setSelected] = useState(null)
  const searchRef = useRef(null)
  const columns = [
    { key: 'name', label: '模板名称', render: (template) => <button type="button" className={`${systemTextButton} h-auto min-h-8 justify-start px-0 text-left font-semibold`} onClick={() => setSelected(template)}>{template.name}</button> },
    { key: 'version', label: '版本', render: (template) => <span className="font-mono text-xs text-ink-2">{template.version || '—'}</span> },
    { key: 'desc', label: '说明', hideBelow: 'lg', className: 'max-w-80', render: (template) => <span className="line-clamp-2 text-xs leading-5 text-ink-2" title={template.desc}>{template.desc || '—'}</span> },
    { key: 'tags', label: '标签', hideBelow: 'md', render: (template) => <span className="text-xs text-ink-2" title={template.tags.join('、')}>{template.tags.slice(0, 2).join('、') || '—'}{template.tags.length > 2 ? ` +${template.tags.length - 2}` : ''}</span> },
    { key: 'actions', label: '操作', render: (template) => <button type="button" className={systemTextButton} aria-label={`查看 ${template.name}`} onClick={() => setSelected(template)}>查看</button> },
  ]
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-2 text-xs leading-6 text-ink-2"><SystemBadge>只读目录</SystemBadge><span>当前仅支持查看模板。</span></div>
    <SystemObjectList title="模板" searchInputRef={searchRef} rows={templates} columns={columns} loading={loading} error={error} onRetry={onRetry} searchText={(template) => [template.id, template.name, template.version, template.desc, ...template.tags].join(' ')} actions={<button type="button" className={systemButton} onClick={onRetry} disabled={loading}>刷新</button>} />
    <SystemObjectDialog open={Boolean(selected)} title="模板详情" description={selected?.name} onClose={() => setSelected(null)} fallbackFocusRef={searchRef}>
      {selected && <SystemObjectFacts items={[{ label: '模板编号', value: selected.id }, { label: '版本', value: selected.version || '—' }, { label: '说明', value: selected.desc || '—' }, { label: '标签', value: selected.tags.join('、') || '—' }]} />}
    </SystemObjectDialog>
  </div>
}
