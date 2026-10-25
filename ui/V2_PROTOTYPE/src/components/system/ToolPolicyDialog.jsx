import { useState } from 'react'
import { normalizeEntry } from '../../hooks/useAiToolPolicy.js'
import SystemObjectDialog, { SystemObjectFacts } from './SystemObjectDialog.jsx'
import { SystemBadge, systemButton, systemInput, systemPrimaryButton } from './SystemObjectList.jsx'

const ROLES = [
  { id: 'SALES', label: '销售' }, { id: 'PRE_SALES', label: '售前' },
  { id: 'IMPL', label: '实施' }, { id: 'PM', label: '项目经理' },
  { id: 'DEV', label: '开发' }, { id: 'PMO', label: 'PMO' }, { id: 'ADMIN', label: '系统管理员' },
]
const roleLabels = Object.fromEntries(ROLES.map((role) => [role.id, role.label]))
export const rolesLabel = (entry) => entry.visibleRoles.length ? entry.visibleRoles.map((id) => roleLabels[id] || id).join('、') : '全部角色'
export const approvalLabel = (tool, entry) => tool.mutates || tool.exfiltrates ? '必须审批' : entry.approvalStrategy === 'user-confirm' ? '逐次确认' : '免审批'
export const injectionLabel = (tool, entry) => tool.discoverable || entry.injectionMode === 'on-demand' ? '按需发现' : '常驻注入'

/** Candidate edits stay here until Apply; server draft/activation remain separate page actions. */
export default function ToolPolicyDialog({ tool, entry, activeEntry, mode, onClose, onApply, fallbackFocusRef }) {
  const [candidate, setCandidate] = useState(() => ({ ...entry, visibleRoles: [...entry.visibleRoles] }))
  const editing = mode === 'edit'
  const dirty = editing && JSON.stringify(normalizeEntry(candidate)) !== JSON.stringify(normalizeEntry(entry))
  const requiredApproval = tool.mutates === true || tool.exfiltrates === true
  const patch = (values) => setCandidate((previous) => ({ ...previous, ...values }))
  const toggleRole = (role) => patch({ visibleRoles: candidate.visibleRoles.includes(role) ? candidate.visibleRoles.filter((value) => value !== role) : [...candidate.visibleRoles, role] })
  const facts = [
    { label: '说明', value: tool.description }, { label: '所需权限', value: tool.capability },
    { label: '数据写入', value: tool.mutates ? '会写数据' : '只读' }, { label: '数据外发', value: tool.exfiltrates ? '会外发' : '不外发' },
    { label: '定义 Token', value: tool.tokens }, { label: '分类', value: tool.category },
    { label: '工具来源', value: tool.origin === 'mcp' ? `MCP · ${tool.mcpServer?.name || tool.mcpServer?.id || '—'}` : '代码注册' },
    { label: '本人权限', value: tool.callable ? '可调用' : '不可调用' },
    { label: '当前生效注入', value: tool.injected ? '已注入' : '未注入' },
    { label: '生效策略', value: `${activeEntry.enabled ? '已启用' : '已停用'} · ${rolesLabel(activeEntry)} · ${approvalLabel(tool, activeEntry)} · ${injectionLabel(tool, activeEntry)}` },
    { label: '页面草稿', value: `${entry.enabled ? '已启用' : '已停用'} · ${rolesLabel(entry)} · ${approvalLabel(tool, entry)} · ${injectionLabel(tool, entry)}` },
  ]
  return (
    <SystemObjectDialog open fallbackFocusRef={fallbackFocusRef} title={editing ? '编辑工具策略' : '工具策略详情'} description={tool.name} onClose={onClose} dirty={dirty} footer={editing ? (requestClose) => <><button type="button" className={systemButton} onClick={requestClose}>取消</button><button type="button" className={systemPrimaryButton} disabled={!dirty} onClick={() => { onApply(tool.name, candidate); onClose() }}>应用修改</button></> : undefined}>
      {editing ? <div className="space-y-5">
        <p className="m-0 rounded-md bg-bg-soft px-3 py-2 text-xs leading-6 text-ink-2">应用后仍需在页面保存草稿，再生效。</p>
        <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" className="size-4 accent-brand" aria-label={`启用 ${tool.name}`} checked={candidate.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />启用此工具</label>
        <fieldset className="m-0 min-w-0 border-0 p-0"><legend className="mb-2 text-sm text-ink-2">可见角色</legend><div className="flex flex-wrap gap-2">{ROLES.map((role) => <button key={role.id} type="button" className={`${systemButton} ${candidate.visibleRoles.includes(role.id) ? 'ring-2 ring-brand' : ''}`} aria-pressed={candidate.visibleRoles.includes(role.id)} disabled={!candidate.enabled} onClick={() => toggleRole(role.id)}>{role.label}</button>)}</div><p className="mb-0 mt-2 text-xs leading-5 text-ink-2">{candidate.visibleRoles.length ? `已限定：${rolesLabel(candidate)}` : '全部角色（仍受权限位约束）'}</p></fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-ink-2">审批策略<select className={systemInput} value={candidate.approvalStrategy} disabled={requiredApproval || !candidate.enabled} onChange={(event) => patch({ approvalStrategy: event.target.value })}><option value="default">{requiredApproval ? '必须审批（代码下限）' : '按代码（免审批）'}</option><option value="user-confirm">逐次确认</option></select></label>
          <label className="flex flex-col gap-2 text-sm text-ink-2">注入模式<select className={systemInput} value={candidate.injectionMode} disabled={!candidate.enabled} onChange={(event) => patch({ injectionMode: event.target.value })}><option value="default">跟随代码{tool.discoverable ? '（按需发现）' : '（常驻）'}</option><option value="on-demand">强制按需发现</option></select></label>
        </div>
        {requiredApproval && <SystemBadge tone="warn">写入或外发工具必须审批，策略不可放宽</SystemBadge>}
      </div> : <SystemObjectFacts items={facts} />}
    </SystemObjectDialog>
  )
}
