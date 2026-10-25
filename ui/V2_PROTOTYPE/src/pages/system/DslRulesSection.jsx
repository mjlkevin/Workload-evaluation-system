import { useRef, useState } from 'react'
import { useToast } from '../../hooks/useToast.jsx'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'

const logicLabels = { requires_all: '全部依赖', requires_any: '任一依赖', combo: '组合依赖', blocking: '阻断', warning: '警告' }
const scopes = { feature: '功能', scenario: '场景', data_source: '数据来源' }
const freshForm = () => ({ subject: '', trigger: '', logic: 'requires_all', dependenciesText: '', enabled: true })
const filters = [
  { value: 'enabled', label: '已启用', matches: (rule) => rule.enabled },
  { value: 'disabled', label: '已停用', matches: (rule) => !rule.enabled },
]
const searchText = (rule) => [rule.id, rule.subject, rule.trigger, rule.note, ...rule.dependencies, ...(rule.anyOfGroups || []).flat(), ...(rule.comboDependencies || [])].join(' ')

function DependencyFacts({ rule }) {
  return <SystemObjectFacts items={[
    { label: '规则编号', value: rule.id }, { label: '适用范围', value: scopes[rule.scope] || rule.scope || '—' },
    { label: '依赖逻辑', value: logicLabels[rule.logic] || rule.logic }, { label: '启用状态', value: rule.enabled ? '已启用' : '已停用' },
    { label: '触发场景', value: rule.trigger || '—' }, { label: '固定依赖', value: rule.dependencies?.join('、') || '无固定依赖' },
    { label: '任一依赖组', value: rule.anyOfGroups?.length ? <ol className="m-0 pl-5">{rule.anyOfGroups.map((group, index) => <li key={index}>{group.join('、')}</li>)}</ol> : '—' },
    { label: '组合依赖', value: rule.comboDependencies?.join('、') || '—' }, { label: '备注', value: rule.note || '—' },
  ]} />
}

export default function DslRulesSection({ rules, loading, error, unsaved, pending, version, actions, actionLoading }) {
  const toast = useToast()
  const searchRef = useRef(null)
  const [view, setView] = useState(null)
  const [form, setForm] = useState(freshForm)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const busy = loading || actionLoading.saveDslDraft || actionLoading.activateDsl
  const open = (kind, rule) => { setFormError(''); setForm(rule ? { enabled: rule.enabled } : freshForm()); setView({ kind, rule }) }
  const close = () => setView(null)
  const dirty = view?.kind === 'new'
    ? JSON.stringify(form) !== JSON.stringify(freshForm())
    : view?.kind === 'edit' && form.enabled !== view.rule.enabled
  const apply = () => {
    if (view.kind === 'new') {
      if (!form.subject.trim() || !form.trigger.trim()) { setFormError('规则主题与触发场景必填'); return }
      actions.addDslRule({ id: `dep-custom-${crypto.randomUUID()}`, subject: form.subject.trim(), trigger: form.trigger.trim(), logic: form.logic, dependencies: form.dependenciesText.split(/[,，]/).map((text) => text.trim()).filter(Boolean), enabled: form.enabled })
      toast.success('已添加规则，请保存草稿后生效')
    } else if (dirty) actions.toggleDsl(view.rule.id)
    close()
  }
  const commit = async (kind) => {
    setActionError('')
    const result = await actions[kind === 'save' ? 'saveDslDraft' : 'activateDsl']()
    if (result.success) toast.success(kind === 'save' ? 'DSL 草稿已保存' : 'DSL 规则已生效')
    else setActionError(`${kind === 'save' ? '草稿保存失败' : '规则生效失败'}：${result.error || '请重试'}`)
  }
  const columns = [
    { key: 'subject', label: '规则名称', render: (rule) => <button type="button" className={`${systemTextButton} h-auto min-h-8 justify-start px-0 text-left font-semibold`} onClick={() => open('detail', rule)}>{rule.subject || rule.id}</button> },
    { key: 'logic', label: '依赖逻辑', hideBelow: 'md', render: (rule) => <SystemBadge tone={rule.logic === 'requires_all' ? 'neutral' : 'brand'}>{logicLabels[rule.logic] || rule.logic}</SystemBadge> },
    { key: 'trigger', label: '触发场景', hideBelow: 'lg', className: 'max-w-64', render: (rule) => <span className="line-clamp-2 text-xs leading-5 text-ink-2" title={rule.trigger}>{rule.trigger || '—'}</span> },
    { key: 'dependencies', label: '依赖摘要', hideBelow: 'lg', className: 'max-w-56', render: (rule) => <span className="line-clamp-2 text-xs leading-5 text-ink-2">{rule.dependencies.length ? rule.dependencies.join('、') : '无固定依赖'}{rule.anyOfGroups?.length ? ` · ${rule.anyOfGroups.length} 组任选条件` : ''}{rule.comboDependencies?.length ? ` · ${rule.comboDependencies.length} 项组合依赖` : ''}</span> },
    { key: 'enabled', label: '草稿状态', render: (rule) => <SystemBadge tone={rule.enabled ? 'ok' : 'neutral'}>{rule.enabled ? '已启用' : '已停用'}</SystemBadge> },
    { key: 'actions', label: '操作', render: (rule) => <div className="flex whitespace-nowrap"><button type="button" className={systemTextButton} aria-label={`查看 ${rule.subject}`} onClick={() => open('detail', rule)}>查看</button><button type="button" className={systemTextButton} aria-label={`编辑启用 ${rule.subject}`} disabled={busy || Boolean(error)} onClick={() => open('edit', rule)}>编辑启用</button></div> },
  ]
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-solid border-line bg-surface px-4 py-3">
        {version != null && <span className="text-xs font-semibold text-ink">生效版本 v{version}</span>}
        {unsaved && <SystemBadge tone="warn">有未保存的修改</SystemBadge>}
        {pending && <SystemBadge tone="warn">草稿未生效</SystemBadge>}
        {!unsaved && !pending && !loading && !error && <SystemBadge>草稿与生效一致</SystemBadge>}
        <div className="ml-auto flex gap-2"><button type="button" className={systemButton} disabled={!unsaved || busy || Boolean(error)} onClick={() => commit('save')}>{actionLoading.saveDslDraft ? '保存中…' : '保存草稿'}</button><button type="button" className={systemPrimaryButton} disabled={unsaved || !pending || busy || Boolean(error)} title={unsaved ? '请先保存草稿，再生效' : undefined} onClick={() => commit('activate')}>{actionLoading.activateDsl ? '生效中…' : '生效'}</button></div>
      </div>
      {unsaved && <p className="m-0 text-xs leading-6 text-warn-ink">修改尚未保存，生效前请先保存草稿。</p>}
      {actionError && <p role="alert" className="m-0 text-sm text-err-ink">{actionError}</p>}
      <SystemObjectList title="DSL 规则" searchInputRef={searchRef} rows={rules} columns={columns} filters={filters} searchText={searchText} loading={loading} error={error} onRetry={actions.loadDsl} actions={<><button type="button" className={systemButton} onClick={actions.loadDsl} disabled={busy || unsaved} title={unsaved ? '先保存未保存的修改' : undefined}>刷新</button><button type="button" className={systemButton} disabled={busy || Boolean(error)} onClick={() => open('new')}>新增规则</button></>} />
      <SystemObjectDialog open={Boolean(view)} fallbackFocusRef={searchRef} title={view?.kind === 'new' ? '新增实施依赖规则' : view?.kind === 'edit' ? '编辑规则启用状态' : 'DSL 规则详情'} description={view?.rule?.subject} onClose={close} dirty={dirty} footer={view?.kind !== 'detail' ? (requestClose) => <><button type="button" className={systemButton} onClick={requestClose}>取消</button><button type="button" className={systemPrimaryButton} disabled={view?.kind === 'edit' && !dirty} onClick={apply}>{view?.kind === 'new' ? '添加规则' : '应用修改'}</button></> : undefined}>
        {view?.kind === 'detail' && <DependencyFacts rule={view.rule} />}
        {view?.kind === 'edit' && <div className="space-y-4"><p className="m-0 text-xs leading-6 text-ink-2">仅调整启用状态，应用后需保存草稿再生效。</p><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4 accent-brand" checked={form.enabled} onChange={(event) => setForm({ enabled: event.target.checked })} />启用规则</label></div>}
        {view?.kind === 'new' && <div className="space-y-4">
          <label className="flex flex-col gap-2 text-sm text-ink-2">规则主题<input className={systemInput} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label>
          <label className="flex flex-col gap-2 text-sm text-ink-2">触发场景<input className={systemInput} value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value })} /></label>
          <label className="flex flex-col gap-2 text-sm text-ink-2">依赖逻辑<select className={systemInput} value={form.logic} onChange={(event) => setForm({ ...form, logic: event.target.value })}><option value="requires_all">全部依赖（缺一不可）</option><option value="requires_any">任一依赖（满足一组即可）</option><option value="combo">组合依赖（依赖 + 组合项）</option></select></label>
          <label className="flex flex-col gap-2 text-sm text-ink-2">依赖模块<input className={systemInput} placeholder="多个模块用逗号分隔" value={form.dependenciesText} onChange={(event) => setForm({ ...form, dependenciesText: event.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4 accent-brand" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用规则</label>
        </div>}
        {formError && <p role="alert" className="mb-0 mt-4 text-sm text-err-ink">{formError}</p>}
      </SystemObjectDialog>
    </div>
  )
}
