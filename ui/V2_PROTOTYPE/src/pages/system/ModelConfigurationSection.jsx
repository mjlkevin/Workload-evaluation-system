import { useRef, useState } from 'react'
import SystemObjectList, { SystemBadge, systemPrimaryButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'

const status = (row) => !row.wired ? '规划中' : row.diffs.length ? '有草稿待生效' : '已生效'

export default function ModelConfigurationSection({ providers, effectiveProviders, credentials, scenarios, loading, error, onRetry, onCreateProvider, onEditProvider, onEditScenario, onVerifyScenario, formatTime }) {
  const [selected, setSelected] = useState(null)
  const providerSearch = useRef(null)
  const scenarioSearch = useRef(null)
  const provider = selected?.kind === 'provider' ? providers.find((row) => row.id === selected.id) : null
  const scenario = selected?.kind === 'scenario' ? scenarios.find((row) => row.id === selected.id) : null
  const credentialLabel = (row) => {
    const active = effectiveProviders[row.id]
    return !active ? '—' : active.keyConfigured ? `已配置 ${active.keyHint || ''} · ${active.keySource === 'store' ? '凭据托管' : '环境变量'}` : '未配置'
  }
  return <div className="space-y-6">
    <section className="space-y-3" aria-label="供应商管理">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="m-0 text-sm font-semibold text-ink">模型供应商</h3><p className="mb-0 mt-1 text-xs leading-5 text-ink-2">凭据按供应商加密托管{credentials?.lastAudit && ` · 最近变更：${credentials.lastAudit.action === 'set' ? '设置密钥' : credentials.lastAudit.action === 'clear' ? '清除密钥' : credentials.lastAudit.action} · ${credentials.lastAudit.actor} · ${formatTime(credentials.lastAudit.at)}`}</p></div><div className="flex flex-wrap items-center gap-2">{credentials && <><SystemBadge tone={credentials.source === 'store' ? 'ok' : 'warn'}>{credentials.source === 'store' ? '凭据域托管（加密落库）' : credentials.source === 'env' ? '环境变量兜底' : '凭据未配置'}</SystemBadge><SystemBadge tone={credentials.kekReady ? 'ok' : 'warn'}>KEK {credentials.kekReady ? '就绪' : '未配置'}</SystemBadge></>}</div></div>
      <SystemObjectList title="模型供应商" tableLabel="模型供应商" rows={providers} searchInputRef={providerSearch} loading={loading} error={error} onRetry={onRetry}
        searchText={(row) => [row.name, row.id, row.protocol, row.baseUrl, ...(row.models || []).map((model) => model.id)].join(' ')}
        filters={[{ value: 'enabled', label: '启用', matches: (row) => row.enabled !== false }, { value: 'disabled', label: '停用', matches: (row) => row.enabled === false }]}
        actions={<button type="button" className={systemPrimaryButton} onClick={onCreateProvider} disabled={loading || Boolean(error)}>+ 新增供应商</button>}
        columns={[
          { key: 'name', label: '供应商', render: (row) => <div><span className="font-medium">{row.name}</span><div className="text-xs text-ink-2">{row.protocol || 'openai-compatible'}</div></div> },
          { key: 'baseUrl', label: 'Base URL', hideBelow: 'lg', render: (row) => <span className="block max-w-64 truncate font-mono text-xs" title={row.baseUrl}>{row.baseUrl || '—'}</span> },
          { key: 'models', label: '模型', hideBelow: 'md', render: (row) => <span className="block max-w-48 truncate font-mono text-xs" title={(row.models || []).map((model) => model.id).join(' · ')}>{(row.models || []).map((model) => model.id).join(' · ') || '—'}</span> },
          { key: 'credential', label: 'API Key', hideBelow: 'lg', render: (row) => <span className="text-xs">{credentialLabel(row)}</span> },
          { key: 'status', label: '状态', render: (row) => <SystemBadge tone={row.enabled !== false ? 'ok' : 'neutral'}>{row.enabled !== false ? '启用' : '停用'}</SystemBadge> },
          { key: 'actions', label: '操作', className: 'w-28 whitespace-nowrap', render: (row) => <div className="flex items-center justify-end"><button type="button" aria-label={`查看 ${row.name}`} className={systemTextButton} onClick={() => setSelected({ kind: 'provider', id: row.id })}>查看</button><button type="button" className={systemTextButton} onClick={() => onEditProvider(row)}>编辑</button></div> },
        ]} />
    </section>
    <section className="space-y-3" aria-label="场景配置"><h3 className="m-0 text-sm font-semibold text-ink">场景模型绑定</h3>
      <SystemObjectList title="场景模型绑定" tableLabel="场景模型绑定" rows={scenarios} searchInputRef={scenarioSearch} loading={loading} error={error} onRetry={onRetry}
        searchText={(row) => [row.title, row.desc, row.resolvedModel, row.scenario?.providerName, row.sourceLabel, row.paramSummary, ...(row.scenario?.notes || [])].join(' ')}
        filters={['已生效', '有草稿待生效', '规划中'].map((value) => ({ value, label: value, matches: (row) => status(row) === value }))}
        columns={[
          { key: 'title', label: '场景', render: (row) => <span className="font-medium">{row.title}</span> },
          { key: 'model', label: '生效模型', render: (row) => <div className="max-w-40 wrap-anywhere font-mono text-xs">{row.resolvedModel}{row.scenario?.providerName && <div className="font-sans text-ink-2">{row.scenario.providerName}</div>}</div> },
          { key: 'source', label: '来源', hideBelow: 'lg', render: (row) => <SystemBadge tone="brand">{row.sourceLabel}</SystemBadge> },
          { key: 'params', label: '关键参数', hideBelow: 'lg', render: (row) => <span className="text-xs text-ink-2">{row.wired ? row.paramSummary : '—'}</span> },
          { key: 'lastVerified', label: '最近验证', hideBelow: 'lg', render: (row) => row.scenario?.lastVerified ? <div className="text-xs text-ink-2">{row.scenario.lastVerified.ok ? '✓' : '✗'} {formatTime(row.scenario.lastVerified.at)}<div className="font-mono">{row.scenario.lastVerified.model}</div></div> : '—' },
          { key: 'status', label: '状态', render: (row) => <SystemBadge tone={!row.wired ? 'neutral' : row.diffs.length ? 'warn' : 'ok'}>{status(row)}</SystemBadge> },
          { key: 'actions', label: '操作', className: 'whitespace-nowrap', render: (row) => <div className="flex items-center justify-end"><button type="button" aria-label={`查看 ${row.title}`} className={systemTextButton} onClick={() => setSelected({ kind: 'scenario', id: row.id })}>查看</button><button type="button" className={systemTextButton} disabled={!row.wired} onClick={() => onEditScenario(row)}>编辑</button><button type="button" className={systemTextButton} disabled={!row.wired || row.verifying || credentials?.configured === false} onClick={() => onVerifyScenario(row)}>{row.verifying ? '验证中…' : '验证此场景'}</button></div> },
        ]} />
    </section>
    <SystemObjectDialog open={Boolean(provider || scenario)} title={provider ? '模型供应商详情' : '场景模型详情'} description={provider?.name || scenario?.title} onClose={() => setSelected(null)} fallbackFocusRef={provider ? providerSearch : scenarioSearch}>
      {provider && <SystemObjectFacts items={[
        { label: '供应商', value: provider.name }, { label: '标识', value: provider.id }, { label: '协议', value: provider.protocol || 'openai-compatible' },
        { label: 'Base URL', value: provider.baseUrl }, { label: '状态', value: provider.enabled !== false ? '启用' : '停用' }, { label: 'API Key', value: credentialLabel(provider) },
        { label: '模型', value: <div className="space-y-1 font-mono">{(provider.models || []).map((model) => <div key={model.id}>{model.id}</div>)}</div> },
      ]} />}
      {scenario && <div className="space-y-5"><SystemObjectFacts items={[
        { label: '场景', value: scenario.title }, { label: '用途', value: scenario.desc }, { label: '生效模型', value: scenario.resolvedModel },
        { label: '供应商', value: scenario.scenario?.providerName }, { label: '来源', value: scenario.sourceLabel }, { label: '状态', value: status(scenario) }, { label: '关键参数', value: scenario.wired ? scenario.paramSummary : '—' },
        { label: '最近验证', value: scenario.scenario?.lastVerified ? `${scenario.scenario.lastVerified.ok ? '通过' : '失败'} · ${formatTime(scenario.scenario.lastVerified.at)} · ${scenario.scenario.lastVerified.model}` : '未验证' },
      ]} /><div><h4 className="mb-2 mt-0 text-sm font-semibold text-ink">接线参数</h4><div className="flex flex-wrap gap-2">{scenario.scenario?.wiredParams?.length ? scenario.scenario.wiredParams.map((param) => <SystemBadge key={param}>{param}</SystemBadge>) : <span className="text-sm text-ink-2">该场景暂无接线参数</span>}</div>{scenario.scenario?.notes?.length > 0 && <ul className="mb-0 pl-5 text-sm leading-6 text-ink-2">{scenario.scenario.notes.map((note) => <li key={note}>{note}</li>)}</ul>}</div><div><h4 className="mb-2 mt-0 text-sm font-semibold text-ink">草稿 vs 生效</h4>{scenario.diffs.length ? <ul className="m-0 pl-5 text-sm leading-6 text-ink">{scenario.diffs.map((diff) => <li key={diff.field}><span className="font-mono">{diff.field}</span> {diff.from} → <strong>{diff.to}</strong></li>)}</ul> : <span className="text-sm text-ink-2">草稿与生效一致</span>}</div></div>}
    </SystemObjectDialog>
  </div>
}
