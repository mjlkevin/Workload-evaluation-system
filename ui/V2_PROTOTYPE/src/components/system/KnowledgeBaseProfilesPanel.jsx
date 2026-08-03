import { useState } from 'react'
import { Dialog, DialogActions } from '../ui/Dialog.jsx'

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

export default function KnowledgeBaseProfilesPanel({
  profiles = [],
  probes = {},
  disabled = false,
  testingProfileId = '',
  onChange,
  onTest,
}) {
  const [editor, setEditor] = useState(null)
  const [form, setForm] = useState(emptyProfile)
  const [error, setError] = useState('')

  const openNew = () => {
    setEditor({ index: -1 })
    setForm(emptyProfile())
    setError('')
  }

  const openEdit = (profile, index) => {
    setEditor({ index })
    setForm({ ...profile, routingKeywords: [...(profile.routingKeywords || [])], allowedBusinessRoles: [...(profile.allowedBusinessRoles || [])] })
    setError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setError('')
  }

  const saveProfile = () => {
    const candidate = {
      ...form,
      id: String(form.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''),
      name: String(form.name || '').trim(),
      description: String(form.description || '').trim(),
      knowledgeId: String(form.knowledgeId || '').trim(),
      priority: Math.max(0, Math.min(999, Number(form.priority) || 0)),
    }
    if (!candidate.name || !candidate.id || !candidate.knowledgeId) {
      setError('请填写知识库名称、内部标识和知识库 ID')
      return
    }
    const duplicate = profiles.some((profile, index) => (
      index !== editor.index
      && (profile.id === candidate.id || profile.knowledgeId === candidate.knowledgeId)
    ))
    if (duplicate) {
      setError('内部标识或知识库 ID 已存在')
      return
    }
    let next = profiles.map((profile) => candidate.isDefault ? { ...profile, isDefault: false } : profile)
    if (editor.index === -1) next = [...next, candidate]
    else next = next.map((profile, index) => index === editor.index ? candidate : profile)
    onChange?.(next)
    closeEditor()
  }

  const toggleRole = (roleId) => {
    setForm((current) => ({
      ...current,
      allowedBusinessRoles: current.allowedBusinessRoles.includes(roleId)
        ? current.allowedBusinessRoles.filter((item) => item !== roleId)
        : [...current.allowedBusinessRoles, roleId],
    }))
  }

  return (
    <section className="kb-profiles" aria-labelledby="kb-profiles-title">
      <div className="kb-profiles__header">
        <div>
          <h3 id="kb-profiles-title">知识库档案</h3>
          <p>先按角色和关键词路由，无法确定时才由 AI 在授权候选中选择。</p>
        </div>
        <button type="button" className="btn btn-ghost" aria-label="新增知识库" disabled={disabled} onClick={openNew}>＋ 新增知识库</button>
      </div>

      {profiles.length === 0 ? (
        <div className="kb-profiles__empty">尚未配置知识库档案。新增后保存草稿，并逐个完成连通性测试。</div>
      ) : (
        <div className="kb-profiles__table-wrap">
          <table className="kb-profiles__table">
            <thead>
              <tr>
                <th>知识库</th>
                <th>路由关键词</th>
                <th>角色范围</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile, index) => {
                const probe = probes[profile.id]
                const probeLabel = probe?.status === 'success' ? '已验证' : probe?.status === 'failure' ? '验证失败' : '待测试'
                return (
                  <tr key={`${profile.id}-${index}`}>
                    <td data-label="知识库">
                      <div className="kb-profile__title">
                        <strong>{profile.name}</strong>
                        {profile.isDefault ? <span className="bdg ci">默认</span> : null}
                        {!profile.enabled ? <span className="bdg">已停用</span> : null}
                      </div>
                      <div className="kb-profile__meta mono">{profile.knowledgeId}</div>
                      {profile.description ? <div className="kb-profile__description">{profile.description}</div> : null}
                    </td>
                    <td data-label="路由关键词"><span className="kb-profile__summary">{keywordText(profile)}</span></td>
                    <td data-label="角色范围"><span className="kb-profile__summary">{roleText(profile)}</span></td>
                    <td data-label="状态">
                      <span className={`kb-profile__probe kb-profile__probe--${probe?.status || 'pending'}`}>{probeLabel}</span>
                    </td>
                    <td data-label="操作">
                      <div className="kb-profile__actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={testingProfileId === profile.id ? '测试中...' : `测试 ${profile.name}`}
                          disabled={disabled || !profile.enabled || Boolean(testingProfileId)}
                          onClick={() => onTest?.(profile.id)}
                        >
                          {testingProfileId === profile.id ? '测试中...' : '测试'}
                        </button>
                        <button type="button" className="btn btn-ghost" aria-label={`编辑 ${profile.name}`} disabled={disabled} onClick={() => openEdit(profile, index)}>编辑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={Boolean(editor)}
        title={editor?.index === -1 ? '新增知识库' : '编辑知识库'}
        description="路由器只会在当前用户有权访问且已启用的知识库中选择。"
        onClose={closeEditor}
        wide
      >
        <div className="kb-profile-form">
          {error ? <div role="alert" className="kb-profile-form__error">{error}</div> : null}
          <div className="kb-profile-form__grid">
            <label>知识库名称<input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>内部标识<input className="input" value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} /></label>
            <label>知识库 ID<input className="input" value={form.knowledgeId} onChange={(event) => setForm((current) => ({ ...current, knowledgeId: event.target.value }))} /></label>
            <label>优先级<input className="input" type="number" min="0" max="999" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: Number(event.target.value) }))} /></label>
          </div>
          <label>说明<textarea className="input" rows="2" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>路由关键词<textarea className="input" rows="2" placeholder="用逗号或换行分隔，例如：资金计划，网上银行" value={(form.routingKeywords || []).join('，')} onChange={(event) => setForm((current) => ({ ...current, routingKeywords: parseKeywords(event.target.value) }))} /></label>
          <fieldset className="kb-profile-form__roles">
            <legend>可访问业务角色</legend>
            <p>不勾选表示全部已认证业务角色可访问。</p>
            <div>
              {BUSINESS_ROLES.map((role) => (
                <label key={role.id}><input type="checkbox" checked={form.allowedBusinessRoles.includes(role.id)} onChange={() => toggleRole(role.id)} />{role.label}</label>
              ))}
            </div>
          </fieldset>
          <div className="kb-profile-form__switches">
            <label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />启用知识库</label>
            <label><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} />设为安全默认库</label>
            {form.isDefault ? <span>保存后会替换当前默认库。</span> : null}
          </div>
        </div>
        <DialogActions>
          <button type="button" className="btn btn-out" onClick={closeEditor}>取消</button>
          <button type="button" className="btn btn-pri" onClick={saveProfile}>保存档案</button>
        </DialogActions>
      </Dialog>
    </section>
  )
}
