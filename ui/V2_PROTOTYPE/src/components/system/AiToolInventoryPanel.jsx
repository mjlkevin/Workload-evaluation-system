import { useEffect, useRef, useState } from 'react'
import { useAiToolPolicy, normalizeEntry } from '../../hooks/useAiToolPolicy.js'
import AiMcpServersPanel from './AiMcpServersPanel.jsx'
import SystemObjectList, { SystemBadge, systemButton, systemPrimaryButton, systemTextButton } from './SystemObjectList.jsx'
import ToolPolicyDialog, { approvalLabel, injectionLabel, rolesLabel } from './ToolPolicyDialog.jsx'

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : String(value)
}

export default function AiToolInventoryPanel() {
  const {
    tools, summary, version, draftPolicies, activePolicies, updatedAt, effectiveAt, revisions,
    loading, saving, activating, reverting, error, unsavedLocal, pendingActivation,
    load, saveDraft, activate, setEntry, discardLocalEdits, revertSavedDraftToActive,
  } = useAiToolPolicy()
  const [savingOk, setSavingOk] = useState(false)
  const searchRef = useRef(null)
  const [view, setView] = useState(null)
  useEffect(() => { load() }, [load])
  const busy = loading || saving || activating || reverting
  const entryFor = (tool) => normalizeEntry(draftPolicies[tool.name] ?? activePolicies[tool.name])
  const editEntry = (name, patch) => { setSavingOk(false); setEntry(name, patch) }
  const handleSave = async () => { setSavingOk(false); if (await saveDraft(draftPolicies)) setSavingOk(true) }
  const open = (mode, tool) => setView({ mode, tool, entry: entryFor(tool), activeEntry: normalizeEntry(activePolicies[tool.name]) })
  const filters = [
    { value: 'enabled', label: '已启用', matches: (tool) => entryFor(tool).enabled },
    { value: 'disabled', label: '已停用', matches: (tool) => !entryFor(tool).enabled },
  ]
  const columns = [
    { key: 'name', label: '工具名称', render: (tool) => <div className="min-w-0"><button type="button" className={`${systemTextButton} h-auto min-h-7 justify-start px-0 text-left font-mono font-semibold wrap-anywhere`} onClick={() => open('detail', tool)}>{tool.name}</button><div className="flex flex-wrap gap-x-2 text-xs leading-5 text-ink-2"><span>{tool.category || '未分类'}</span><span className={tool.mutates ? 'text-warn-ink' : ''}>{tool.mutates ? '会写数据' : '只读'}</span>{tool.exfiltrates && <span className="text-warn-ink">会外发</span>}{tool.origin === 'mcp' && <span title={tool.mcpServer?.name || tool.mcpServer?.id}>MCP · {tool.mcpServer?.name || tool.mcpServer?.id || '未知服务'}</span>}</div></div> },
    { key: 'description', label: '说明', hideBelow: 'lg', className: 'max-w-56', render: (tool) => <span className="line-clamp-2 text-xs leading-5 text-ink-2" title={tool.description}>{tool.description || '—'}</span> },
    { key: 'enabled', label: '草稿状态', render: (tool) => <div className="space-y-1 whitespace-nowrap"><SystemBadge tone={entryFor(tool).enabled ? 'ok' : 'neutral'}>{entryFor(tool).enabled ? '已启用' : '已停用'}</SystemBadge><div className="text-xs leading-5 text-ink-2">{tool.callable ? '可调用' : '不可调用'}</div></div> },
    { key: 'roles', label: '可见角色', hideBelow: 'lg', render: (tool) => { const entry = entryFor(tool); const labels = rolesLabel(entry).split('、'); return <span className="text-xs leading-5 text-ink-2" title={rolesLabel(entry)}>{labels.slice(0, 2).join('、')}{labels.length > 2 ? ` +${labels.length - 2}` : ''}</span> } },
    { key: 'approval', label: '审批策略', hideBelow: 'lg', render: (tool) => <span className="whitespace-nowrap text-xs text-ink-2">{approvalLabel(tool, entryFor(tool))}</span> },
    { key: 'injection', label: '注入方式', hideBelow: 'md', render: (tool) => <div className="whitespace-nowrap text-xs leading-5 text-ink-2"><div>{injectionLabel(tool, entryFor(tool))}</div><div>{tool.injected ? '已注入' : '未注入'}</div></div> },
    { key: 'actions', label: '操作', render: (tool) => <div className="flex whitespace-nowrap"><button type="button" className={systemTextButton} aria-label={`查看 ${tool.name}`} onClick={() => open('detail', tool)}>查看</button><button type="button" className={systemTextButton} aria-label={`编辑 ${tool.name}`} disabled={busy} onClick={() => open('edit', tool)}>编辑</button></div> },
  ]
  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-6 text-ink-2"><span>共 {tools.length} 个工具 · 其中 {tools.filter((tool) => tool.mutates).length} 个会写数据 · {tools.filter((tool) => tool.exfiltrates).length} 个会外发数据 · 你本人可调用 {tools.filter((tool) => tool.callable).length} 个</span><span>当前注入 {summary.injectedCount ?? 0} 个 / {summary.injectedTokens ?? 0} tokens</span></div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-solid border-line bg-surface px-4 py-3">
          <span className="text-xs font-semibold text-ink">生效版本 v{version}</span>
          {unsavedLocal && <SystemBadge tone="warn">有未保存的修改</SystemBadge>}
          {pendingActivation && <SystemBadge tone="warn">草稿未生效</SystemBadge>}
          {!unsavedLocal && !pendingActivation && <SystemBadge>草稿与生效一致</SystemBadge>}
          {savingOk && <SystemBadge tone="ok">草稿已保存</SystemBadge>}
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={systemButton} disabled={!unsavedLocal || busy} onClick={() => { setSavingOk(false); discardLocalEdits() }}>放弃未保存的修改</button>
            <button type="button" className={systemButton} disabled={!unsavedLocal || busy} onClick={handleSave}>{saving ? '保存中...' : '保存草稿'}</button>
            <button type="button" className={systemButton} disabled={!pendingActivation || busy} onClick={async () => { setSavingOk(false); await revertSavedDraftToActive() }} title="把服务端草稿回退成生效版本，同时丢弃未保存编辑；会记入变更轨迹">{reverting ? '回退中...' : '草稿回退为生效版本'}</button>
            <button type="button" className={systemPrimaryButton} disabled={!pendingActivation || unsavedLocal || busy} title={unsavedLocal ? '先保存草稿，再生效' : pendingActivation ? '把服务端草稿提升为生效版本' : '草稿与生效版本一致，无需生效'} onClick={async () => { setSavingOk(false); await activate() }}>{activating ? '生效中...' : '生效'}</button>
          </div>
        </div>
        {unsavedLocal && <p role="alert" className="m-0 rounded-md bg-warn-soft px-3 py-2 text-xs leading-6 text-warn-ink">本页有未保存的修改，这些修改不会进入生效版本。请先保存草稿，再生效。</p>}
      </div>
      <SystemObjectList title="工具策略" searchInputRef={searchRef} rows={tools} rowKey="name" columns={columns} filters={filters} loading={loading} error={error} onRetry={unsavedLocal ? undefined : load} emptyText="暂无已注册的工具" searchText={(tool) => [tool.name, tool.description, tool.category, tool.capability].join(' ')} actions={<button type="button" className={systemButton} disabled={busy || unsavedLocal} title={unsavedLocal ? '先保存或放弃未保存的修改' : undefined} onClick={load}>刷新</button>} />
      <details className="rounded-lg border border-solid border-line bg-surface px-4 py-3 text-xs leading-6 text-ink-2"><summary className="cursor-pointer font-medium text-ink">策略说明与配置时间</summary><p>工具本身（名称、参数、实现）来自代码，清单只读不可编辑；本页编辑的是策略决定：启用、角色可见、审批要求、注入模式。策略只做减法，不能放宽权限。写入和外发工具必须逐次审批。</p><p className="mb-0">生效于 {formatTime(effectiveAt)} · 草稿更新于 {formatTime(updatedAt)}</p></details>
      <section className="min-w-0 space-y-3">
        <h3 className="m-0 text-sm font-semibold leading-6 text-ink">变更轨迹（最近 {revisions.length} 条，与 version 对账）</h3>
        {revisions.length === 0 ? <p className="m-0 text-xs text-ink-2">暂无策略变更记录</p> : <div className="overflow-x-auto rounded-lg border border-solid border-line bg-surface"><table aria-label="工具策略变更轨迹" className="w-full border-collapse text-left text-xs leading-6 text-ink-2"><thead><tr>{['#', '版本', '动作', '操作者', '时间', '改了什么'].map((label) => <th key={label} className="border-0 border-b border-solid border-line bg-bg-soft px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{[...revisions].reverse().map((revision) => <tr key={`${revision.seq}-${revision.at}`}><td className="px-3 py-2">{revision.seq}</td><td className="px-3 py-2">v{revision.version}</td><td className="px-3 py-2">{revision.action === 'activate' ? '生效' : '草稿'}</td><td className="px-3 py-2">{revision.actor}</td><td className="whitespace-nowrap px-3 py-2">{formatTime(revision.at)}</td><td className="px-3 py-2">{revision.changes.length ? revision.changes.map((change, index) => <div key={index} className="font-mono wrap-anywhere">{change.tool} · {change.field}: {change.from || '—'} → {change.to || '—'}</div>) : '无字段变化'}</td></tr>)}</tbody></table></div>}
      </section>
      <AiMcpServersPanel />
      {view && <ToolPolicyDialog {...view} fallbackFocusRef={searchRef} onClose={() => setView(null)} onApply={editEntry} />}
    </div>
  )
}
