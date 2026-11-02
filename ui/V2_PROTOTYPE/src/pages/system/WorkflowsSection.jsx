import { useEffect, useRef, useState } from 'react'
import { workflowsApi } from '../../api/workflows.js'
import useWorkflowManagement from '../../hooks/useWorkflowManagement.js'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import WorkflowDefinitionEditor, { defaultWorkflowDefinition, parseWorkflowForm, toWorkflowForm } from './WorkflowDefinitionEditor.jsx'
import WorkflowStepDialog, { defaultWorkflowStep } from './WorkflowStepDialog.jsx'
import WorkflowReleasePanel from './WorkflowReleasePanel.jsx'
const current = r => r.versions.find(v => v.workflowVersionId === r.currentVersionId)
const filters = [{ value: 'enabled', label: '已启用', matches: r => r.enabled && !r.archived }, { value: 'disabled', label: '已停用', matches: r => !r.enabled && !r.archived }, { value: 'checked_out', label: '已检出', matches: r => current(r)?.checkoutStatus === 'checked_out' }]
const labels = { skill: 'Skill', userInput: '人工输入', confirmation: '人工确认', tool: '原生工具' }
export default function WorkflowsSection() {
  const { records, metadata, loading, error, load, accept } = useWorkflowManagement()
  const [view, setView] = useState(null)
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [stepIndex, setStepIndex] = useState(null)
  const [stepError, setStepError] = useState(null)
  const [pendingVersion, setPendingVersion] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [archived, setArchived] = useState(false)
  const generation = useRef(0)
  const queryOpened = useRef(false)
  const search = useRef(null)
  const record = view?.record
  const version = record?.versions.find(v => v.workflowVersionId === selected)
  const historical = Boolean(record && selected !== record.currentVersionId)
  const mine = version?.checkoutStatus === 'checked_out' && version.checkedOutBy === metadata?.viewerId
  const editable = !busy && (view?.kind === 'create' || (mine && !historical && version.status === 'draft' && !record.archived))
  const dirty = Boolean(form && JSON.stringify(form) !== baseline)
  const install = definition => { const next = toWorkflowForm(definition); setForm(next); setBaseline(JSON.stringify(next)); setErrorField(''); setStepError(null); setPendingVersion('') }
  const replaceRecord = next => { accept(next); setView({ kind: 'detail', record: next }); setSelected(next.currentVersionId); install(current(next).definition) }
  useEffect(() => () => { generation.current++ }, [])
  const open = async id => {
    const request = ++generation.current
    setBusy(true); setActionError('')
    try { const { data } = await workflowsApi.get(id); if (generation.current === request) replaceRecord(data.record) }
    catch (e) { if (generation.current === request) setActionError(e.message) }
    finally { if (generation.current === request) setBusy(false) }
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('workflowId')
    if (metadata && id && !queryOpened.current) { queryOpened.current = true; open(id) }
  }, [metadata]) // A fixed-dependency influence link opens its Workflow without editing it.
  const close = () => { generation.current++; setView(null); setForm(null); setStepIndex(null); setActionError(''); setConfirm(null) }
  const run = async (action, payload) => {
    const request = ++generation.current
    setActionError(''); setErrorField(''); setStepError(null)
    let definition
    try { if (action === 'save' || action === 'create') definition = parseWorkflowForm(form) }
    catch (e) { setActionError(e.message); setErrorField(e.field); return }
    setBusy(true)
    try {
      const { data } = action === 'create' ? await workflowsApi.create(definition) : action === 'save' ? await workflowsApi.save(record.workflowId, record.revision, definition) : action === 'status' ? await workflowsApi.status(record.workflowId, record.revision, payload) : await workflowsApi.action(record.workflowId, action, record.revision)
      if (generation.current === request) { replaceRecord(data.record); setConfirm(null) }
    } catch (e) {
      if (generation.current === request) {
        setActionError([e.message, ...(e.details || []).map(d => `${d.field}: ${d.reason}`)].join(' · '))
        const path = e.details?.[0]?.field?.replace(/^definition[/.]?/, '').split(/[/.]/) || []
        setErrorField(path[0] || '')
        if (path[0] === 'steps') {
          const index = /^\d+$/.test(path[1]) ? Number(path[1]) : form.steps.findIndex(s => s.id === path[1])
          if (form.steps[index]) setStepError({ index, field: path[2] || '', message: e.details[0].reason })
        }
      }
    } finally { if (generation.current === request) setBusy(false) }
  }
  const switchVersion = id => { setSelected(id); install(record.versions.find(v => v.workflowVersionId === id).definition); setActionError('') }
  const changeSteps = steps => { setForm({ ...form, steps }); setActionError('') }
  const move = (index, delta) => { const next = [...form.steps]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; changeSteps(next) }
  const newStepId = () => { let n = form.steps.length + 1; while (form.steps.some(s => s.id === `step${n}`)) n++; return `step${n}` }
  const create = () => { generation.current++; install({ ...defaultWorkflowDefinition(), roles: [metadata.roles.includes('delivery') ? 'delivery' : metadata.roles[0]] }); setSelected(''); setView({ kind: 'create' }); setActionError('') }
  return <div className="min-w-0 space-y-4">
    <SystemObjectList title="Workflow" rows={records.filter(r => archived || !r.archived)} rowKey="workflowId" loading={loading} error={error} onRetry={load} searchInputRef={search} searchText={r => `${current(r).definition.name} ${current(r).definition.description} ${current(r).definition.category}`} filters={filters} actions={<><button className={systemButton} disabled={loading || busy || Boolean(view)} onClick={load}>刷新 Workflow 列表</button><label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />显示归档</label><button className={systemPrimaryButton} disabled={!metadata || loading || busy} onClick={create}>新建 Workflow</button></>} columns={[
      { key: 'name', label: '名称', render: r => <button className={systemTextButton} disabled={busy} onClick={() => open(r.workflowId)} aria-label={`查看 ${current(r).definition.name}`}>{current(r).definition.name}</button> },
      { key: 'category', label: '分类', render: r => current(r).definition.category },
      { key: 'version', label: '工作版本', render: r => current(r).versionCode },
      { key: 'state', label: '状态', render: r => <SystemBadge>{r.archived ? '已归档' : r.enabled ? '已启用' : '已停用'}</SystemBadge> },
    ]} />
    {actionError && !view && <p role="alert" className="text-sm text-err-ink">{actionError}</p>}
    <SystemObjectDialog open={Boolean(view)} title={view?.kind === 'create' ? '新建 Workflow' : 'Workflow 定义'} onClose={close} dirty={dirty} busy={busy || stepIndex !== null} fallbackFocusRef={search} footer={requestClose => <><button className={systemButton} disabled={busy} onClick={requestClose}>关闭</button>{view?.kind === 'create' ? <button className={systemPrimaryButton} disabled={busy} onClick={() => run('create')}>创建</button> : !historical && <>
      {editable && <button className={systemPrimaryButton} onClick={() => run('save')}>保存草稿</button>}
      {!record?.archived && version?.status !== 'published' && (version?.checkoutStatus === 'checked_in' ? <button className={systemButton} disabled={busy || dirty} onClick={() => run('checkout')}>检出</button> : mine ? <><button className={systemButton} disabled={busy || dirty} onClick={() => run('checkin')}>检入</button><button className={systemButton} disabled={busy || dirty} onClick={() => setConfirm({ action: 'undo-checkout', title: '撤销检出' })}>撤销检出</button></> : <button className={systemButton} disabled={busy || dirty} onClick={() => setConfirm({ action: 'force-unlock', title: '管理员强制解锁' })}>管理员强制解锁</button>)}
      <button className={systemButton} disabled={busy || dirty || version?.checkoutStatus !== 'checked_in' || record?.archived} onClick={() => setConfirm({ action: 'promote', title: '升版' })}>升版</button>
    </>}</>}>
      {form && metadata && <div className="min-w-0 space-y-5">
        {record && <><WorkflowFieldVersion record={record} selected={selected} disabled={busy || stepIndex !== null} onChange={id => dirty ? setPendingVersion(id) : switchVersion(id)} /><p className="text-xs text-ink-2">{historical ? '历史版本，只读' : mine ? '由你检出' : version.checkoutStatus === 'checked_out' ? `由 ${version.checkedOutBy} 检出，只读` : '已检入，只读'}</p></>}
        {pendingVersion && <div role="alert" className="space-y-2 text-sm text-warn-ink">有未保存的修改，确定放弃并切换版本吗？<div className="flex gap-2"><button className={systemButton} onClick={() => setPendingVersion('')}>继续编辑</button><button className={systemButton} onClick={() => switchVersion(pendingVersion)}>放弃并切换</button></div></div>}
        {actionError && <p id="workflow-error" role="alert" className="text-sm text-err-ink wrap-anywhere">{actionError}</p>}
        {stepError && <button className={systemTextButton} onClick={() => setStepIndex(stepError.index)}>定位步骤错误</button>}
        {dirty && <p className="text-sm text-warn-ink">有未保存的修改，请先保存再检入或进行配置校验。</p>}
        {record && version && <WorkflowReleasePanel key={`${record.workflowId}:${selected}`} record={record} version={version} dirty={dirty} busy={busy || stepIndex !== null} setBusy={setBusy} onRecord={replaceRecord} />}
        <WorkflowDefinitionEditor form={form} onChange={setForm} disabled={!editable} metadata={metadata} errorField={errorField} />
        <section aria-label="Workflow 步骤" className="min-w-0 space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="m-0 text-base text-ink">步骤（{form.steps.length}/50）</h3><button className={systemButton} disabled={!editable || form.steps.length >= 50} onClick={() => setStepIndex(form.steps.length)}>添加步骤</button></div>
          <div role="region" aria-label="步骤表滚动区域" tabIndex={0} className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm text-ink"><thead><tr>{['顺序', '步骤', '类型 / 固定依赖', '操作'].map(t => <th key={t} scope="col" className="border-0 border-b border-solid border-line p-2">{t}</th>)}</tr></thead><tbody>{form.steps.map((s, i) => <tr key={s.id}><td className="p-2">{i + 1}</td><td className="p-2 wrap-anywhere">{s.name}<div className="text-xs text-ink-2">{s.id}</div></td><td className="p-2 wrap-anywhere">{labels[s.type]}<div className="text-xs text-ink-2">{s.skillVersionId || s.toolName || '人工步骤'}</div></td><td className="p-2"><div className="flex flex-wrap gap-1"><button className={systemTextButton} onClick={() => setStepIndex(i)} aria-label={`编辑 ${s.name}`}>{editable ? '编辑' : '查看'}</button>{editable && <><button className={systemTextButton} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`上移 ${s.name}`}>上移</button><button className={systemTextButton} disabled={i === form.steps.length - 1} onClick={() => move(i, 1)} aria-label={`下移 ${s.name}`}>下移</button><button className={systemTextButton} disabled={form.steps.length <= 1} onClick={() => changeSteps(form.steps.filter((_, n) => n !== i))} aria-label={`移除 ${s.name}`}>移除</button></>}</div></td></tr>)}</tbody></table></div>
        </section>
        {stepIndex !== null && <WorkflowStepDialog key={stepIndex} step={form.steps[stepIndex] || defaultWorkflowStep(newStepId())} steps={form.steps} index={stepIndex} metadata={metadata} disabled={!editable} initialError={stepError?.index === stepIndex ? stepError : null} onClose={() => setStepIndex(null)} onApply={step => { changeSteps(stepIndex === form.steps.length ? [...form.steps, step] : form.steps.map((s, i) => i === stepIndex ? step : s)); setStepIndex(null) }} />}
        {record && <><div className="flex flex-wrap gap-2"><SystemBadge>{record.enabled ? '已启用' : '已停用'}</SystemBadge><SystemBadge>{record.archived ? '已归档' : '未归档'}</SystemBadge>{!historical && <><button className={systemButton} disabled={busy || dirty || record.archived} onClick={() => run('status', { enabled: !record.enabled })}>{record.enabled ? '停用' : '启用'}</button><button className={systemButton} disabled={busy || dirty} onClick={() => setConfirm({ action: 'status', title: record.archived ? '取消归档' : '归档', payload: { archived: !record.archived } })}>{record.archived ? '取消归档' : '归档'}</button></>}</div><details className="text-sm text-ink-2"><summary>操作审计（{record.audit.length}）</summary><ol>{record.audit.map(e => <li key={e.id} className="wrap-anywhere">{e.action} · {e.actorName || e.actorId} · {e.versionId} · {e.createdAt} · {e.reason}</li>)}</ol></details></>}
      </div>}
    </SystemObjectDialog>
    <SystemObjectDialog open={Boolean(confirm)} title={confirm?.title || '确认操作'} onClose={() => setConfirm(null)} busy={busy} footer={closeConfirm => <><button className={systemButton} disabled={busy} onClick={closeConfirm}>取消</button><button className={systemPrimaryButton} disabled={busy || dirty} onClick={() => run(confirm.action, confirm.payload)}>确认{confirm?.title}</button></>}><p className="text-sm text-ink-2">{confirm?.action === 'undo-checkout' || confirm?.action === 'force-unlock' ? '将恢复最近检入的定义并清除检出锁，未检入的修改将丢失。' : `确认对 ${form?.name || ''} 执行${confirm?.title || ''}？`}</p>{actionError && <p role="alert" className="text-sm text-err-ink">{actionError}</p>}</SystemObjectDialog>
  </div>
}
function WorkflowFieldVersion({ record, selected, disabled, onChange }) {
  return <label className="flex min-w-0 flex-col gap-2 text-sm text-ink-2">查看版本<select className={systemInput} value={selected} disabled={disabled} onChange={e => onChange(e.target.value)}>{record.versions.map(v => <option key={v.workflowVersionId} value={v.workflowVersionId}>{v.versionCode} · {v.workflowVersionId === record.currentVersionId ? '当前' : '历史'}</option>)}</select></label>
}
