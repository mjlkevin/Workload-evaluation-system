import { useRef, useState } from 'react'
import { useToast } from '../../hooks/useToast.jsx'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'

const filters = [
  { value: 'active', label: '生效中', matches: (rule) => rule.status === 'active' },
  { value: 'draft', label: '草稿', matches: (rule) => rule.status === 'draft' },
  { value: 'disabled', label: '已禁用', matches: (rule) => rule.status === 'disabled' },
]
const statusLabel = (rule) => ({ active: '生效中', draft: '草稿', disabled: '已禁用' }[rule.status] || rule.status || '—')
const ruleTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

export default function CodeRulesSection({ rules, loading, error, onRetry, actions, actionLoading }) {
  const toast = useToast()
  const searchRef = useRef(null)
  const [view, setView] = useState(null)
  const [form, setForm] = useState({ prefix: '', format: '' })
  const [saveError, setSaveError] = useState('')
  const rule = view?.rule
  const id = rule?.id || rule?.code
  const busy = Boolean(actionLoading[`configure:${id}`] || actionLoading[`activate:${id}`] || actionLoading[`disable:${id}`])
  const dirty = view?.kind === 'edit' && (form.prefix !== (rule.prefix || '') || form.format !== (rule.format || ''))
  const open = (kind, target) => { setSaveError(''); setForm({ prefix: target.prefix || '', format: target.format || '' }); setView({ kind, rule: target }) }
  const close = () => setView(null)
  const runAction = async (kind) => {
    setSaveError('')
    const result = await actions[kind === 'save' ? 'configureRule' : kind === 'activate' ? 'activateRule' : 'disableRule'](id, kind === 'save' ? form : undefined)
    if (result.success) {
      close()
      toast.success(kind === 'save' ? '编码规则配置已保存' : kind === 'activate' ? '编码规则已生效' : '编码规则已禁用')
    } else setSaveError(result.error || '操作失败')
  }
  const status = (entry) => <SystemBadge tone={entry.status === 'active' ? 'ok' : 'neutral'}>{statusLabel(entry)}</SystemBadge>
  const columns = [
    { key: 'module', label: '规则名称', render: (entry) => <button type="button" className={`${systemTextButton} h-auto min-h-8 justify-start px-0 text-left font-semibold`} onClick={() => open('detail', entry)}>{entry.module || entry.code}</button> },
    { key: 'prefix', label: '前缀', hideBelow: 'md', render: (entry) => <span className="font-mono text-xs">{entry.prefix || '—'}</span> },
    { key: 'format', label: '编码格式', hideBelow: 'lg', render: (entry) => <span className="font-mono text-xs wrap-anywhere">{entry.format || '—'}</span> },
    { key: 'example', label: '示例编码', hideBelow: 'md', render: (entry) => <span className="font-mono text-xs">{entry.example || '—'}</span> },
    { key: 'status', label: '状态', render: status },
    { key: 'activatedAt', label: '生效时间', hideBelow: 'lg', render: (entry) => <span className="whitespace-nowrap text-xs text-ink-2">{ruleTime(entry.activatedAt)}</span> },
    { key: 'actions', label: '操作', render: (entry) => <div className="flex items-center whitespace-nowrap"><button type="button" className={systemTextButton} aria-label={`查看 ${entry.module}`} onClick={() => open('detail', entry)}>查看</button><button type="button" className={systemTextButton} aria-label={`编辑 ${entry.module}`} onClick={() => open('edit', entry)}>编辑</button><button type="button" className={systemTextButton} aria-label={`更多操作 ${entry.module}`} onClick={() => open('actions', entry)}>更多</button></div> },
  ]
  return (
    <>
      <SystemObjectList title="编码规则" searchInputRef={searchRef} rows={rules} rowKey="code" columns={columns} filters={filters} loading={loading} error={error} onRetry={onRetry} searchText={(entry) => [entry.module, entry.code, entry.prefix, entry.format, entry.example].join(' ')} actions={<button type="button" className={systemButton} onClick={onRetry} disabled={loading}>刷新</button>} />
      <SystemObjectDialog fallbackFocusRef={searchRef} open={Boolean(view)} title={view?.kind === 'edit' ? '编辑编码规则' : view?.kind === 'actions' ? '编码规则操作' : '编码规则详情'} description={rule?.module} onClose={close} dirty={dirty} busy={busy} footer={(requestClose) => view?.kind === 'edit' ? <><button type="button" className={systemButton} disabled={busy} onClick={requestClose}>取消</button><button type="button" className={systemPrimaryButton} disabled={busy} onClick={() => runAction('save')}>{busy ? '保存中…' : '保存配置'}</button></> : view?.kind === 'actions' ? <><button type="button" className={systemButton} onClick={requestClose} disabled={busy}>取消</button><button type="button" className={systemButton} disabled={busy} onClick={() => runAction('disable')}>禁用</button><button type="button" className={systemPrimaryButton} disabled={busy} onClick={() => runAction('activate')}>生效</button></> : undefined}>
        {rule && (view.kind === 'edit' ? <div className="space-y-4"><label className="flex flex-col gap-2 text-sm text-ink-2">前缀<input className={systemInput} value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} /></label><label className="flex flex-col gap-2 text-sm text-ink-2">格式<input className={systemInput} value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })} /></label></div> : <SystemObjectFacts items={[{ label: '业务模块', value: rule.module }, { label: '状态', value: status(rule) }, { label: '前缀', value: rule.prefix }, { label: '编码格式', value: rule.format }, { label: '示例编码', value: rule.example }, { label: '生效时间', value: ruleTime(rule.activatedAt) }]} />)}
        {saveError && <p role="alert" className="mt-4 text-sm text-err-ink">{saveError}</p>}
      </SystemObjectDialog>
    </>
  )
}
