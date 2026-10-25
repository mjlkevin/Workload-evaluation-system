import { useRef, useState } from 'react'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from './SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from './SystemObjectDialog.jsx'

const BUSINESS_ROLES = [
  { id: 'sales', label: '销售' },
  { id: 'pre_sales', label: '售前顾问' },
  { id: 'delivery', label: '实施顾问' },
  { id: 'pm', label: '项目经理' },
  { id: 'pmo', label: 'PMO' },
  { id: 'dev', label: '开发' },
  { id: 'admin', label: '管理员' },
]

const ROLE_LABELS = Object.fromEntries(BUSINESS_ROLES.map((role) => [role.id, role.label]))

function emptyProfile() {
  return {
    id: `knowledge-${Date.now()}`,
    name: '',
    description: '',
    knowledgeId: '',
    routingKeywords: [],
    allowedBusinessRoles: [],
    enabled: true,
    isDefault: false,
    priority: 100,
  }
}

function keywordText(profile) {
  return (profile.routingKeywords || []).join(' · ') || '由 AI 判断'
}

function roleText(profile) {
  if (!profile.allowedBusinessRoles?.length) return '全部角色'
  return profile.allowedBusinessRoles.map((role) => ROLE_LABELS[role] || role).join(' · ')
}

function parseKeywords(value) {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]
}

function probeLabel(probe) {
  return probe?.status === 'success' ? '已验证' : probe?.status === 'failure' ? '验证失败' : '待测试'
}

function profileSearchText(profile) {
  return [profile.name, profile.id, profile.knowledgeId, profile.description, keywordText(profile), roleText(profile), profile.priority].join(' ')
}

const PROFILE_FILTERS = [
  { value: 'enabled', label: '已启用', matches: (profile) => profile.enabled },
  { value: 'disabled', label: '已停用', matches: (profile) => !profile.enabled },
]
const fieldClass = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium leading-5 text-ink-2'
const checkboxClass = 'flex items-center gap-2 text-sm font-normal leading-6 text-ink'

export default function KnowledgeBaseProfilesPanel({
  profiles = [],
  probes = {},
  disabled = false,
  testingProfileId = '',
  onChange,
  onTest,
}) {
  const [editor, setEditor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(emptyProfile)
  const [keywords, setKeywords] = useState('')
  const [error, setError] = useState('')
  const searchRef = useRef(null)
  const nameRef = useRef(null)

  const openEditor = (profile, index) => {
    const next = { ...profile, routingKeywords: [...(profile.routingKeywords || [])], allowedBusinessRoles: [...(profile.allowedBusinessRoles || [])] }
    const nextKeywords = next.routingKeywords.join('，')
    setEditor({ index, initial: JSON.stringify([next, nextKeywords]) })
    setForm(next)
    setKeywords(nextKeywords)
    setError('')
  }
  const closeEditor = () => { setEditor(null); setError('') }
  const dirty = Boolean(editor && editor.initial !== JSON.stringify([form, keywords]))

  const saveProfile = () => {
    if (disabled || !editor) return
    const candidate = {
      ...form,
      id: String(form.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''),
      name: String(form.name || '').trim(),
      description: String(form.description || '').trim(),
      knowledgeId: String(form.knowledgeId || '').trim(),
      routingKeywords: parseKeywords(keywords),
      priority: Math.max(0, Math.min(999, Number(form.priority) || 0)),
    }
    if (!candidate.name || !candidate.id || !candidate.knowledgeId) {
      setError('请填写知识库名称、内部标识和知识库 ID')
      return
    }
    if (profiles.some((profile, index) => index !== editor.index && (profile.id === candidate.id || profile.knowledgeId === candidate.knowledgeId))) {
      setError('内部标识或知识库 ID 已存在')
      return
    }
    let next = profiles.map((profile) => candidate.isDefault ? { ...profile, isDefault: false } : profile)
    if (editor.index === -1) next = [...next, candidate]
    else next = next.map((profile, index) => index === editor.index ? candidate : profile)
    onChange?.(next)
    closeEditor()
  }

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const toggleRole = (roleId) => {
    setForm((current) => ({
      ...current,
      allowedBusinessRoles: current.allowedBusinessRoles.includes(roleId)
        ? current.allowedBusinessRoles.filter((item) => item !== roleId)
        : [...current.allowedBusinessRoles, roleId],
    }))
  }
  const columns = [
    { key: 'name', label: '知识库', className: 'min-w-48 max-w-64', render: (profile) => <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2"><strong className="max-w-52 truncate font-medium">{profile.name}</strong>{profile.isDefault && <SystemBadge tone="brand">默认</SystemBadge>}{!profile.enabled && <SystemBadge>已停用</SystemBadge>}</div>
      <div className="max-w-60 truncate font-mono text-xs text-ink-2">{profile.knowledgeId}</div>
    </div> },
    { key: 'routingKeywords', label: '路由关键词', hideBelow: 'lg', className: 'min-w-36 max-w-52', render: (profile) => <span className="block max-w-48 truncate text-xs text-ink-2">{keywordText(profile)}</span> },
    { key: 'allowedBusinessRoles', label: '角色范围', hideBelow: 'lg', className: 'min-w-32 max-w-48', render: (profile) => <span className="block max-w-44 truncate text-xs text-ink-2">{roleText(profile)}</span> },
    { key: 'probe', label: '验证状态', className: 'whitespace-nowrap', render: (profile) => <SystemBadge tone={probes[profile.id]?.status === 'success' ? 'ok' : probes[profile.id]?.status === 'failure' ? 'warn' : 'neutral'}>{probeLabel(probes[profile.id])}</SystemBadge> },
    { key: 'actions', label: '操作', className: 'whitespace-nowrap', render: (profile) => <div className="flex items-center gap-1">
      <button type="button" className={systemTextButton} aria-label={`查看 ${profile.name}`} onClick={() => setDetail(profile)}>查看</button>
      <button type="button" className={systemTextButton} aria-label={testingProfileId === profile.id ? '测试中...' : `测试 ${profile.name}`} disabled={disabled || !profile.enabled || Boolean(testingProfileId)} onClick={() => onTest?.(profile.id)}>{testingProfileId === profile.id ? '测试中...' : '测试'}</button>
      <button type="button" className={systemTextButton} aria-label={`编辑 ${profile.name}`} disabled={disabled} onClick={() => openEditor(profile, profiles.indexOf(profile))}>编辑</button>
    </div> },
  ]
  const detailProbe = detail ? probes[detail.id] : null

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="kb-profiles-title">
      <h3 id="kb-profiles-title" className="m-0 text-base font-semibold leading-6 text-ink">知识库档案</h3>
      <SystemObjectList title="知识库档案" rows={profiles} columns={columns} searchText={profileSearchText} filters={PROFILE_FILTERS} filterAllLabel="全部启用状态" searchInputRef={searchRef}
        emptyText="尚未配置知识库档案。新增后保存草稿，并逐个完成连通性测试。"
        actions={<button type="button" className={systemPrimaryButton} aria-label="新增知识库" disabled={disabled} onClick={() => openEditor(emptyProfile(), -1)}>＋ 新增知识库</button>} />

      <SystemObjectDialog open={Boolean(detail)} title={`知识库详情：${detail?.name || ''}`} onClose={() => setDetail(null)} fallbackFocusRef={searchRef}>
        {detail && <SystemObjectFacts items={[
          { label: '知识库名称', value: detail.name },
          { label: '内部标识', value: detail.id },
          { label: '知识库 ID', value: detail.knowledgeId },
          { label: '说明', value: detail.description || '—' },
          { label: '路由关键词', value: keywordText(detail) },
          { label: '角色范围', value: roleText(detail) },
          { label: '启用状态', value: detail.enabled ? '已启用' : '已停用' },
          { label: '安全默认库', value: detail.isDefault ? '是' : '否' },
          { label: '优先级', value: detail.priority },
          { label: '验证状态', value: probeLabel(detailProbe) },
          { label: '验证状态值', value: detailProbe?.status },
          { label: '验证时间', value: detailProbe?.checkedAt },
          { label: '验证耗时', value: detailProbe?.latencyMs != null ? `${detailProbe.latencyMs} ms` : null },
          { label: '验证档案标识', value: detailProbe?.profileId },
          { label: '验证提示', value: detailProbe?.warning },
          { label: '错误代码', value: detailProbe?.errorCode },
          { label: '供应商业务码', value: detailProbe?.providerCode },
          { label: '供应商说明', value: detailProbe?.providerMessage },
          { label: '供应商请求标识', value: detailProbe?.providerRequestId },
          { label: '验证配置摘要', value: detailProbe?.configHash },
        ]} />}
      </SystemObjectDialog>

      <SystemObjectDialog open={Boolean(editor)} title={editor?.index === -1 ? '新增知识库' : '编辑知识库'} description="路由器只会在当前用户有权访问且已启用的知识库中选择。" onClose={closeEditor} dirty={dirty} initialFocusRef={nameRef} fallbackFocusRef={searchRef}
        footer={(requestClose) => <><button type="button" className={systemButton} onClick={requestClose}>取消</button><button type="button" className={systemPrimaryButton} disabled={disabled} onClick={saveProfile}>保存档案</button></>}>
        <div className="min-w-0 space-y-4">
          {error && <div role="alert" className="rounded-md border border-solid border-err/30 bg-err-soft p-3 text-sm leading-6 text-err-ink">{error}</div>}
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={fieldClass}>知识库名称<input ref={nameRef} className={systemInput} value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label className={fieldClass}>内部标识<input className={systemInput} value={form.id} onChange={(event) => setField('id', event.target.value)} /></label>
            <label className={fieldClass}>知识库 ID<input className={systemInput} value={form.knowledgeId} onChange={(event) => setField('knowledgeId', event.target.value)} /></label>
            <label className={fieldClass}>优先级<input className={systemInput} type="number" min="0" max="999" value={form.priority} onChange={(event) => setField('priority', Number(event.target.value))} /></label>
          </div>
          <label className={fieldClass}>说明<textarea className={`${systemInput} h-auto py-2`} rows="2" value={form.description || ''} onChange={(event) => setField('description', event.target.value)} /></label>
          <label className={fieldClass}>路由关键词<textarea className={`${systemInput} h-auto py-2`} rows="2" placeholder="用逗号或换行分隔，例如：资金计划，网上银行" value={keywords} onChange={(event) => setKeywords(event.target.value)} /></label>
          <fieldset className="m-0 min-w-0 rounded-md border border-solid border-line p-3">
            <legend className="px-1 text-sm font-medium text-ink-2">可访问业务角色</legend>
            <p className="mt-0 mb-3 text-xs leading-5 text-ink-2">不勾选表示全部已认证业务角色可访问。</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">{BUSINESS_ROLES.map((role) => <label className={checkboxClass} key={role.id}><input type="checkbox" checked={form.allowedBusinessRoles.includes(role.id)} onChange={() => toggleRole(role.id)} />{role.label}</label>)}</div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className={checkboxClass}><input type="checkbox" checked={form.enabled} onChange={(event) => setField('enabled', event.target.checked)} />启用知识库</label>
            <label className={checkboxClass}><input type="checkbox" checked={form.isDefault} onChange={(event) => setField('isDefault', event.target.checked)} />设为安全默认库</label>
            {form.isDefault && <span className="text-xs leading-5 text-ink-2">保存后会替换当前默认库。</span>}
          </div>
        </div>
      </SystemObjectDialog>
    </section>
  )
}
