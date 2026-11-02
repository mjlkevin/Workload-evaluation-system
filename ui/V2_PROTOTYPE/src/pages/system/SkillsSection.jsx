import { useRef, useState } from 'react'
import { skillsApi } from '../../api/skills.js'
import useSkillManagement from '../../hooks/useSkillManagement.js'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import SkillReleaseDialog from './SkillReleaseDialog.jsx'
import SkillDefinitionEditor, { defaultSkillDefinition, parseSkillForm, toSkillForm } from './SkillDefinitionEditor.jsx'

const currentVersion = (record) => record.versions.find((version) => version.skillVersionId === record.currentVersionId)
const filters = [
  { value: 'enabled', label: '已启用', matches: (record) => record.enabled && !record.archived },
  { value: 'disabled', label: '已停用', matches: (record) => !record.enabled && !record.archived },
  { value: 'checked_out', label: '已检出', matches: (record) => currentVersion(record)?.checkoutStatus === 'checked_out' },
]
const definitionField = (path) => {
  const parts = String(path || '').split(/[/.]/).filter(Boolean)
  if (parts[0] === 'definition') parts.shift()
  return parts[0] === 'model' ? parts.slice(0, 2).join('.') : parts[0] || ''
}
const time = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

export default function SkillsSection() {
  const { records, metadata, loading, error, load, accept } = useSkillManagement()
  const [view, setView] = useState(null)
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [archived, setArchived] = useState(false)
  const searchRef = useRef(null)
  const releaseOpenerRef = useRef(null)
  const nameRef = useRef(null)
  const record = view?.record
  const version = record?.versions.find((entry) => entry.skillVersionId === selectedVersionId)
  const historical = Boolean(record && selectedVersionId !== record.currentVersionId)
  const mine = version?.checkoutStatus === 'checked_out' && version.checkedOutBy === metadata?.viewerId
  const editable = !busy && (view?.kind === 'create' || (mine && !historical && version?.status === 'draft' && !record?.archived))
  const dirty = Boolean(form && JSON.stringify(form) !== baseline)
  const install = (definition) => { const next = toSkillForm(definition); setForm(next); setBaseline(JSON.stringify(next)) }
  const replaceRecord = (next) => { accept(next); setView({ kind: 'detail', record: next }); setSelectedVersionId(next.currentVersionId); install(currentVersion(next).definition) }
  const open = async (target, kind = 'detail', opener) => {
    if (kind === 'release') releaseOpenerRef.current = opener
    setActionError(''); setErrorField(''); setNotice(''); setBusy(true)
    try {
      const result = await skillsApi.get(target.skillId)
      if (kind === 'release') { accept(result.data.record); setForm(null); setView({ kind, record: result.data.record }) }
      else replaceRecord(result.data.record)
    }
    catch (cause) { setActionError(cause.message) }
    finally { setBusy(false) }
  }
  const create = () => { setActionError(''); setErrorField(''); setNotice(''); setSelectedVersionId(''); install(defaultSkillDefinition()); setView({ kind: 'create' }) }
  const run = async (action, status) => {
    setActionError(''); setNotice(''); setErrorField('')
    let definition
    try { if (['save', 'create', 'validate'].includes(action)) definition = parseSkillForm(form) }
    catch (cause) { setActionError(cause.message); setErrorField(cause.field || ''); return }
    setBusy(true)
    try {
      const result = action === 'create' ? await skillsApi.create(definition)
        : action === 'save' ? await skillsApi.saveDraft(record.skillId, record.revision, definition)
          : action === 'validate' ? await skillsApi.validate(definition)
            : action === 'status' ? await skillsApi.status(record.skillId, record.revision, status)
              : await skillsApi.action(record.skillId, action, record.revision)
      if (result.data.record) replaceRecord(result.data.record)
      setNotice(action === 'validate' ? '结构校验通过；请继续模型试运行与复核。' : '操作成功，已显示服务器保存的状态。')
      setConfirm(null)
    } catch (cause) {
      setErrorField(definitionField(cause.details?.[0]?.field || cause.details?.[0]?.path))
      const details = Array.isArray(cause.details) ? cause.details.map((item) => `${item.field || item.path || ''} ${item.message || item.reason || ''}`).join('；') : ''
      setActionError(`${cause.message}${details ? `：${details}` : ''}`)
      setConfirm(null)
    } finally { setBusy(false) }
  }
  const columns = [
    { key: 'name', label: '名称 / 标识', render: (item) => <div className="min-w-0"><button type="button" className={`${systemTextButton} h-auto whitespace-normal px-0 text-left font-semibold wrap-anywhere`} onClick={() => open(item)} disabled={busy}>{currentVersion(item)?.definition.name}</button><div className="text-xs text-ink-2 wrap-anywhere">{item.skillId}</div></div> },
    { key: 'category', label: '分类 / 角色', hideBelow: 'md', render: (item) => <div className="text-xs wrap-anywhere">{currentVersion(item)?.definition.category}<div className="text-ink-2">{currentVersion(item)?.definition.roles.join('、')}</div></div> },
    { key: 'version', label: '版本', render: (item) => <div className="text-xs">{currentVersion(item)?.versionCode}<div className="text-ink-2">{item.activeVersionId ? '已有生效版本' : '尚未发布'}</div></div> },
    { key: 'status', label: '状态', render: (item) => <div className="flex flex-wrap gap-1"><SystemBadge>{item.archived ? '已归档' : item.enabled ? '已启用' : '已停用'}</SystemBadge><SystemBadge tone={currentVersion(item)?.checkoutStatus === 'checked_out' ? 'warn' : 'neutral'}>{currentVersion(item)?.checkoutStatus === 'checked_out' ? '已检出' : '已检入'}</SystemBadge></div> },
    { key: 'updatedAt', label: '更新时间', hideBelow: 'lg', render: (item) => <span className="text-xs text-ink-2">{time(item.updatedAt)}</span> },
    { key: 'actions', label: '操作', render: (item) => <div className="flex flex-wrap gap-2"><button type="button" className={systemTextButton} aria-label={`查看 ${currentVersion(item)?.definition.name}`} onClick={() => open(item)} disabled={busy}>定义</button><button type="button" className={systemTextButton} aria-label={`试运行与发布 ${currentVersion(item)?.definition.name}`} onClick={event => open(item, 'release', event.currentTarget)} disabled={busy}>试运行与发布</button></div> },
  ]
  return <div aria-busy={busy || loading} className="min-w-0 space-y-3">
    <SystemObjectList title="Skill" rows={records.filter((item) => archived || !item.archived)} rowKey="skillId" columns={columns} filters={filters} loading={loading} error={error} onRetry={load} searchInputRef={searchRef} searchText={(item) => [item.skillId, ...Object.values(currentVersion(item)?.definition || {})].join(' ')} actions={<><label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />显示归档</label><button type="button" className={systemButton} onClick={load} disabled={loading || busy}>刷新</button><button type="button" className={systemPrimaryButton} onClick={create} disabled={!metadata || busy}>新建 Skill</button></>} />
    {!view && actionError && <p role="alert" className="text-sm text-err-ink">{actionError}</p>}
    <SystemObjectDialog open={Boolean(view && view.kind !== 'release')} title={view?.kind === 'create' ? '新建 Skill' : 'Skill 定义'} description={record?.skillId} onClose={() => { setView(null); setActionError(''); setNotice('') }} dirty={dirty} busy={busy} initialFocusRef={view?.kind === 'create' ? nameRef : undefined} fallbackFocusRef={searchRef} footer={(requestClose) => <div className="flex w-full flex-wrap justify-end gap-2"><button type="button" className={systemButton} onClick={requestClose} disabled={busy}>关闭</button>{view?.kind === 'create' ? <button type="button" className={systemPrimaryButton} onClick={() => run('create')} disabled={busy}>创建 Skill</button> : !historical && <>
      {version?.checkoutStatus === 'checked_in' && version.status === 'draft' && !record?.archived && <button type="button" className={systemPrimaryButton} onClick={() => run('checkout')} disabled={busy}>检出</button>}
      {mine && version?.status === 'draft' && !record?.archived && <><button type="button" className={systemButton} onClick={() => run('validate')} disabled={busy}>校验定义</button><button type="button" className={systemPrimaryButton} onClick={() => run('save')} disabled={busy}>保存草稿</button><button type="button" className={systemButton} onClick={() => run('checkin')} disabled={busy || dirty} title={dirty ? '请先保存草稿再检入' : undefined}>检入</button><button type="button" className={systemButton} onClick={() => setConfirm({ action: 'undo-checkout', title: '撤销检出', description: '将恢复最近检入的定义，丢弃本次检出期间的修改。' })} disabled={busy}>撤销检出</button></>}
      {version?.checkoutStatus === 'checked_in' && !record?.archived && <button type="button" className={systemButton} onClick={() => run('promote')} disabled={busy}>升版</button>}
      {version?.checkoutStatus === 'checked_out' && !mine && <button type="button" className={systemButton} onClick={() => setConfirm({ action: 'force-unlock', title: '管理员强制解锁', description: '将释放他人的编辑锁并保留审计记录。' })} disabled={busy}>管理员强制解锁</button>}
    </>}</div>}>
      {form && metadata && <div className="min-w-0 space-y-5">
        {record && <div className="flex flex-wrap items-center gap-3"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink-2">查看版本<select className={systemInput} value={selectedVersionId} disabled={busy || dirty} title={dirty ? '请先保存或关闭并放弃修改，再切换版本' : undefined} onChange={(e) => { setSelectedVersionId(e.target.value); install(record.versions.find((item) => item.skillVersionId === e.target.value).definition); setActionError(''); setNotice('') }}>{record.versions.map((item) => <option key={item.skillVersionId} value={item.skillVersionId}>{item.versionCode}{item.skillVersionId === record.currentVersionId ? ' · 当前' : ' · 历史'}</option>)}</select></label><SystemBadge tone={historical ? 'neutral' : mine ? 'brand' : 'neutral'}>{historical ? '历史版本，只读' : mine ? '由你检出' : version?.checkoutStatus === 'checked_out' ? `由 ${version.checkedOutBy} 检出，只读` : '已检入，只读'}</SystemBadge></div>}
        {actionError && <p id="skill-form-error" role="alert" className="m-0 text-sm leading-6 text-err-ink wrap-anywhere">{actionError}</p>}
        {notice && <p role="status" className="m-0 text-sm leading-6 text-ok-ink">{notice}</p>}
        {dirty && <p className="m-0 text-sm text-warn-ink">有未保存的修改，请先保存草稿再检入或切换版本。</p>}
        <SkillDefinitionEditor form={form} onChange={(next) => { setForm(next); setNotice(''); setActionError(''); setErrorField('') }} errorField={errorField} disabled={!editable} metadata={metadata} nameRef={nameRef} />
        {record && <><section aria-label="Skill 状态" className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-line pt-4"><SystemBadge>{record.enabled ? '已启用' : '已停用'}</SystemBadge><SystemBadge>{record.archived ? '已归档' : '未归档'}</SystemBadge><span className="text-xs text-ink-2 wrap-anywhere">当前生效版本：{record.activeVersionId || '无'}</span>{!historical && <><button type="button" className={systemTextButton} onClick={() => run('status', { enabled: !record.enabled })} disabled={busy || dirty || record.archived}>{record.enabled ? '停用' : '启用'}</button><button type="button" className={systemTextButton} onClick={() => setConfirm({ action: 'status', status: { archived: !record.archived }, title: record.archived ? '取消归档' : '归档 Skill', description: record.archived ? '将重新显示在常规清单中。' : '归档后隐藏常规入口，历史版本与记录保留。' })} disabled={busy || dirty}>{record.archived ? '取消归档' : '归档'}</button></>}</section><details className="min-w-0 text-sm text-ink-2"><summary className="cursor-pointer">操作审计（{record.audit.length}）</summary><ol className="space-y-3 pl-5">{record.audit.map((event) => <li key={event.id} className="wrap-anywhere">{event.action} · {event.actorName || event.actorId} · {time(event.createdAt)}<div className="text-xs">版本：{event.versionId || '—'}</div></li>)}</ol></details></>}
      </div>}
    </SystemObjectDialog>
    {view?.kind === 'release' && <SkillReleaseDialog key={record.skillId} record={record} viewerId={metadata.viewerId} busy={busy} setBusy={setBusy} onRecord={next => { accept(next); setView({ kind: 'release', record: next }) }} onClose={() => setView(null)} fallbackFocusRef={releaseOpenerRef} />}
    <SystemObjectDialog open={Boolean(confirm)} title={confirm?.title || '确认操作'} description={confirm?.description} onClose={() => setConfirm(null)} busy={busy} footer={(requestClose) => <><button type="button" className={systemButton} onClick={requestClose} disabled={busy}>取消</button><button type="button" className={systemPrimaryButton} disabled={busy} onClick={() => run(confirm.action, confirm.status)}>确认{confirm?.title}</button></>} />
  </div>
}
