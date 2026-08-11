import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
import AiSessionAuditPanel from '../components/system/AiSessionAuditPanel.jsx'
import KnowledgeBaseProfilesPanel from '../components/system/KnowledgeBaseProfilesPanel.jsx'
import KnowledgeRetrievalDiagnosePanel from '../components/system/KnowledgeRetrievalDiagnosePanel.jsx'
import MemoryManagementPanel from '../components/system/MemoryManagementPanel.jsx'
import { SYSTEM_MANAGEMENT_SECTIONS, getSystemManagementSectionById } from '../config/systemManagementSections.js'
import useSystemManagement from '../hooks/useSystemManagement.js'
import { useToast } from '../hooks/useToast.jsx'

const PROMPT_TABS = [
  { key: 'assessment', label: '评估提示词' },
  { key: 'parse', label: '文件解析提示词' },
  { key: 'generate', label: '生成提示词' },
]

const MODEL_CARDS = [
  {
    key: 'kimiEvaluation',
    title: '实施评估',
    desc: '用于实施评估与开发评估的自动打标与摘要生成。',
    summaryFields: [
      { label: '模型', path: 'model' },
      { label: 'Temperature', path: 'temperature' },
      { label: '最大 Tokens', path: 'maxTokens' },
      { label: '超时(ms)', path: 'timeoutMs' },
    ],
  },
  {
    key: 'fileParsing',
    title: '文件解析',
    desc: '用于 Excel/Word/PDF 的结构化提取与内容解析。',
    summaryFields: [
      { label: '模型', path: 'model' },
      { label: '最大文件(MB)', path: 'maxFileSizeMb' },
      { label: '最大 Sheet', path: 'maxSheetCount' },
      { label: '严格模式', path: 'strictMode', type: 'bool' },
    ],
  },
  {
    key: 'kimiGeneration',
    title: '内容生成',
    desc: '用于方案生成、五段叙事与 SOW 草案自动撰写。',
    summaryFields: [
      { label: '模型', path: 'model' },
      { label: 'Temperature', path: 'temperature' },
      { label: '最大 Tokens', path: 'maxTokens' },
      { label: '输出风格', path: 'outputStyle' },
    ],
  },
]

const OUTPUT_STYLE_OPTIONS = [
  { value: 'concise', label: '精简' },
  { value: 'balanced', label: '均衡' },
  { value: 'detailed', label: '详细' },
]

// --- T3：模型配置表格化（RP-053）场景映射与展示辅助 ---
const SCENARIO_KEY_BY_CONFIG = {
  kimiEvaluation: 'assessment',
  fileParsing: 'fileParsing',
  kimiGeneration: 'generation',
}

const SOURCE_BADGE = {
  binding: { cls: 'ok', label: '界面绑定' },
  legacy_ui: { cls: 'ok', label: '界面配置' },
  ui: { cls: 'ok', label: '界面配置' },
  evaluation_fallback: { cls: 'warn', label: '评估配置兜底' },
  env_fallback: { cls: 'warn', label: '环境变量兜底' },
}

function formatRelativeTime(iso) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return '—'
  const diffMs = Date.now() - t
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  return `${Math.floor(diffMs / 86_400_000)} 天前`
}

function formatConfigValue(value) {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.join(' ')
  if (value == null || value === '') return '—'
  return String(value)
}

/** 关键参数摘要：只展示真实接线的参数（铁律：不渲染无消费方字段） */
function buildParamSummary(configKey, cfg) {
  if (!cfg) return '—'
  if (configKey === 'kimiEvaluation') {
    return `maxTokens ${cfg.maxTokens ?? '—'} · 超时 ${Math.round((cfg.timeoutMs ?? 0) / 1000)}s`
  }
  if (configKey === 'fileParsing') return '仅模型参数接线'
  return '—'
}

/** 草稿 vs 生效 diff：返回 [{field, from, to}] */
function buildScenarioDiff(draftCfg, activeCfg) {
  if (!draftCfg || !activeCfg) return []
  const keys = new Set([...Object.keys(draftCfg), ...Object.keys(activeCfg)])
  const diffs = []
  for (const key of keys) {
    const d = JSON.stringify(draftCfg[key] ?? null)
    const a = JSON.stringify(activeCfg[key] ?? null)
    if (d !== a) {
      diffs.push({ field: key, from: formatConfigValue(activeCfg[key]), to: formatConfigValue(draftCfg[key]) })
    }
  }
  return diffs
}

const TEST_RESULT_STATUS = {
  passed: { cls: 'ci', label: '通过' },
  failed: { cls: 'lock', label: '失败' },
  blocked: { cls: 'warn', label: '阻塞' },
  skipped: { cls: 'muted', label: '跳过' },
}

export default function SystemManagement({ sectionId }) {
  const {
    rules, modelConfig, modelActiveConfig, effectiveConfig, effectiveLoading, ratecard,
    dslRules, templates, prompts, setPrompts,
    kbConfig, kbLoading,
    testResults, testResultsLoading,
    actionLoading,
    actions,
  } = useSystemManagement()

  const navigate = useNavigate()
  const [dialog, setDialog] = useState(null) // 'prompt' | 'rule' | null
  const [promptTab, setPromptTab] = useState('assessment')
  const [promptResult, setPromptResult] = useState(null)
  const [selectedRuleCode, setSelectedRuleCode] = useState('')
  const [ruleConfigForm, setRuleConfigForm] = useState({ prefix: '', format: '' })
  const [kbTestResult, setKbTestResult] = useState(null)
  const [kbSaveResult, setKbSaveResult] = useState(null)
  const toast = useToast()
  const [editingModel, setEditingModel] = useState(null)
  const [extInput, setExtInput] = useState('')
  const [kbTestingProfileId, setKbTestingProfileId] = useState('')
  const [confirmClearKbKey, setConfirmClearKbKey] = useState(false)
  const [testResultDialog, setTestResultDialog] = useState(false)
  const [testResultForm, setTestResultForm] = useState({ executorName: '', environment: '', account: '', testCaseKey: '', resultStatus: 'passed', screenshotUrl: '', notes: '' })
  const [modelSaveResult, setModelSaveResult] = useState(null)
  const [modelDirty, setModelDirty] = useState(false)
  const [confirmDiscardModel, setConfirmDiscardModel] = useState(false)
  const [modelSaveError, setModelSaveError] = useState(null)
  const [modelSaving, setModelSaving] = useState(false)
  const [expandedScenario, setExpandedScenario] = useState(null)
  // ISS-2026-08-11-001：供应商新增/编辑弹窗 + 弹窗内嵌 Key 块状态
  const [providerDialog, setProviderDialog] = useState(null) // { mode:'create' } | { mode:'edit', id }
  const [providerForm, setProviderForm] = useState({ name: '', baseUrl: '', enabled: true, models: [] })
  const [providerModelInput, setProviderModelInput] = useState('')
  const [providerSaving, setProviderSaving] = useState(false)
  const [providerSaveError, setProviderSaveError] = useState(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyTestResult, setKeyTestResult] = useState(null) // {kind:'success'|'warn'|'error'|'info', text}
  const modelSnapshotRef = useRef(null)

  const dedicatedSection = sectionId ? getSystemManagementSectionById(sectionId) : null
  const activeSection = dedicatedSection || SYSTEM_MANAGEMENT_SECTIONS[0]
  const activeSectionId = activeSection.id
  const tabs = SYSTEM_MANAGEMENT_SECTIONS.map((section) => ({
    ...section,
    count: section.id === 'rules' ? rules.length : undefined,
  }))
  const selectedRule = rules.find((rule) => rule.code === selectedRuleCode) || rules[0]
  const selectedRuleId = selectedRule?.id || selectedRule?.code || ''

  useEffect(() => {
    if (!selectedRuleCode && rules[0]?.code) setSelectedRuleCode(rules[0].code)
  }, [rules, selectedRuleCode])

  const openRuleConfig = (rule) => {
    const target = rule || selectedRule
    if (!target) return
    setSelectedRuleCode(target.code)
    setRuleConfigForm({
      prefix: target.prefix || '',
      format: target.format || '',
    })
    setDialog('rule')
  }

  const handleSaveKbDraft = async () => {
    setKbSaveResult(null)
    const result = await actions.saveKbDraft()
    setKbSaveResult(result.success
      ? { ok: true, message: '知识库配置草稿已保存' }
      : { ok: false, message: result.error || '知识库配置草稿保存失败' })
  }

  const handleActivateKb = async () => {
    setKbSaveResult(null)
    const result = await actions.activateKbConfig()
    const probeIssue = result.details?.find?.((item) => item?.field === 'probe' || item?.field?.endsWith?.('.probe'))
    const probeReason = probeIssue?.reason
    const profileName = kbConfig.knowledgeBases.find((profile) => profile.id === probeIssue?.profileId)?.name
    const gateMessage = probeReason === 'config_changed_after_probe'
      ? profileName
        ? `${profileName}配置已变更，请重新测试后再生效`
        : '配置已变更，请重新测试连通性后再生效'
      : probeReason === 'probe_expired'
        ? profileName
          ? `${profileName}的连通性测试已过期，请重新测试后再生效`
          : '上次连通性测试已过期，请重新测试后再生效'
        : result.status === 409
          ? profileName
            ? `请先测试${profileName}的连通性，再生效配置`
            : '请先完成当前配置的连通性测试，再生效配置'
          : null
    setKbSaveResult(result.success
      ? { ok: true, message: '知识库配置已生效' }
      : { ok: false, message: gateMessage || result.error || '知识库配置生效失败' })
  }

  const handleClearKbKey = async () => {
    const result = await actions.clearKbApiKeyDraft()
    setConfirmClearKbKey(false)
    setKbSaveResult(result.success
      ? { ok: true, message: '已清除草稿中保存的 API Key；如需影响正在使用的配置，请重新测试并生效' }
      : { ok: false, message: result.error || '密钥清除失败' })
  }

  const handleTestKbProfile = async (profileId) => {
    setKbTestingProfileId(profileId)
    setKbTestResult(null)
    try {
      const result = await actions.testKbConnectivity(profileId)
      setKbTestResult(result || { ok: false, error: '连通性测试未返回结果' })
    } finally {
      setKbTestingProfileId('')
    }
  }

  const handleSaveModelDraft = async () => {
    setModelSaveResult(null)
    const result = await actions.saveModelDraft()
    if (result.success) {
      toast.success('模型配置草稿已保存')
    } else {
      toast.error(result.error || '模型配置草稿保存失败')
    }
  }

  const handleActivateModel = async () => {
    setModelSaveResult(null)
    const result = await actions.activateModel()
    if (result.success) {
      toast.success('模型配置已生效')
    } else {
      toast.error(result.error || '模型配置生效失败')
    }
  }

  const handleModelConfigChange = (key, patch) => {
    actions.updateModelConfig(key, patch) // eslint-disable-line -- internal delegation
    setModelDirty(true)
  }

  const requestCloseModelEdit = () => {
    if (modelSaving) return
    if (modelDirty) {
      setConfirmDiscardModel(true)
    } else {
      setEditingModel(null)
    }
  }

  const confirmDiscard = () => {
    if (modelSnapshotRef.current) {
      Object.entries(modelSnapshotRef.current).forEach(([key, value]) => {
        actions.updateModelConfig(key, value) // eslint-disable-line -- restore snapshot
      })
    }
    setConfirmDiscardModel(false)
    setModelDirty(false)
    setModelSaveError(null)
    setEditingModel(null)
  }

  const handleModelEditSave = async () => {
    setModelSaving(true)
    setModelSaveError(null)
    const result = await actions.saveModelDraft()
    setModelSaving(false)
    if (result.success) {
      setModelDirty(false)
      setEditingModel(null)
      setModelSaveResult({ ok: true, message: '草稿已保存' })
      toast.success('模型配置草稿已保存')
    } else {
      setModelSaveError(result.error || '保存失败，请重试')
    }
  }

  // --- ISS-2026-08-11-001：供应商管理与场景绑定 ---
  const effectiveProvidersById = (effectiveConfig?.providers || []).reduce((acc, p) => { acc[p.id] = p; return acc }, {})
  const draftProviders = modelConfig.modelProviders || []

  const openCreateProvider = () => {
    setProviderForm({ name: '', baseUrl: '', enabled: true, models: [] })
    setProviderModelInput('')
    setProviderSaveError(null)
    setKeyInput('')
    setKeyTestResult(null)
    setProviderDialog({ mode: 'create' })
  }

  const openEditProvider = (provider) => {
    setProviderForm({
      name: provider.name || '',
      baseUrl: provider.baseUrl || '',
      enabled: provider.enabled !== false,
      models: (provider.models || []).map((m) => m.id),
    })
    setProviderModelInput('')
    setProviderSaveError(null)
    setKeyInput('')
    setKeyTestResult(null)
    setProviderDialog({ mode: 'edit', id: provider.id })
  }

  const addProviderModel = () => {
    const id = providerModelInput.trim()
    if (!id) return
    setProviderForm((f) => (f.models.includes(id) ? f : { ...f, models: [...f.models, id] }))
    setProviderModelInput('')
  }

  const handleProviderSave = async () => {
    const name = providerForm.name.trim()
    const baseUrl = providerForm.baseUrl.trim()
    if (!name || !baseUrl) {
      setProviderSaveError('供应商名称与 Base URL 必填')
      return
    }
    // 输入框里已键入但未点「添加」的模型 ID 一并收录
    const modelIds = [...providerForm.models]
    const pendingModel = providerModelInput.trim()
    if (pendingModel && !modelIds.includes(pendingModel)) modelIds.push(pendingModel)
    const now = new Date().toISOString()
    const existing = providerDialog?.mode === 'edit'
      ? draftProviders.find((p) => p.id === providerDialog.id)
      : null
    const models = modelIds.map((id) => existing?.models?.find?.((m) => m.id === id)
      || { id, label: id, capabilities: ['chat'], supportedParams: [] })
    let nextProviders
    if (existing) {
      nextProviders = draftProviders.map((p) => (p.id === existing.id
        ? { ...p, name, baseUrl, enabled: providerForm.enabled, models, updatedAt: now }
        : p))
    } else {
      nextProviders = [...draftProviders, {
        id: `p-${Date.now().toString(36)}`,
        name, protocol: 'openai-compatible', baseUrl, enabled: providerForm.enabled,
        models, createdAt: now, updatedAt: now,
      }]
    }
    setProviderSaving(true)
    setProviderSaveError(null)
    actions.updateModelConfig('modelProviders', nextProviders) // eslint-disable-line -- 本地草稿态同步
    const result = await actions.saveModelDraft({ modelProviders: nextProviders })
    setProviderSaving(false)
    if (result.success) {
      setProviderDialog(null)
      toast.success(existing ? '供应商配置已更新（草稿）' : '供应商已新增（草稿），生效配置后正式启用')
    } else {
      setProviderSaveError(result.error || '供应商保存失败，请重试')
    }
  }

  const handleScenarioBindingChange = (configKey, scenarioKey, providerId, modelId) => {
    actions.updateModelConfig('scenarioBindings', { [scenarioKey]: { providerId, modelId } }) // eslint-disable-line -- internal delegation
    actions.updateModelConfig(configKey, { model: modelId }) // eslint-disable-line -- 同步旧场景字段，保持双写一致
    setModelDirty(true)
  }

  // RP-055 批 3：当前场景绑定模型的参数白名单（supportedParams 非空=白名单；空/目录外=不约束，向后兼容）
  const scenarioParamMatrix = (configKey) => {
    const scenarioKey = SCENARIO_KEY_BY_CONFIG[configKey]
    const binding = modelConfig.scenarioBindings?.[scenarioKey] || {}
    const boundProviderId = binding.providerId || draftProviders[0]?.id || ''
    const boundProvider = draftProviders.find((p) => p.id === boundProviderId) || null
    const currentModel = modelConfig[configKey]?.model || binding.modelId || ''
    const meta = (boundProvider?.models || []).find((m) => m.id === currentModel)
    const list = meta?.supportedParams
    return Array.isArray(list) && list.length ? new Set(list) : null
  }
  const isModelParamLocked = (configKey, param) => {
    const matrix = scenarioParamMatrix(configKey)
    return matrix ? !matrix.has(param) : false
  }
  const renderLockedParamHint = (configKey) => (
    (isModelParamLocked(configKey, 'temperature') || isModelParamLocked(configKey, 'maxTokens')) ? (
      <span className="sys-field__v sys-field__v--dim" style={{ fontSize: 11 }}>
        当前模型按平台声明使用固定采样参数，未声明的参数不会发送，已锁定。
      </span>
    ) : null
  )

  const handleTestProviderKey = async (providerId, model) => {
    setKeyTestResult({ kind: 'info', text: '正在测试连接…' })
    const r = await actions.testProviderApiKey(providerId, { apiKey: keyInput.trim() || undefined, model })
    if (r.success) {
      const d = r.data || {}
      const detail = [
        d.requestedModel && `请求模型: ${d.requestedModel}`,
        d.respondedModel && `响应模型: ${d.respondedModel}`,
        d.latencyMs != null && `延迟: ${d.latencyMs}ms`,
      ].filter(Boolean).join(' · ')
      setKeyTestResult({ kind: 'success', text: `连接测试通过${detail ? `（${detail}）` : ''}` })
    } else {
      setKeyTestResult({ kind: 'error', text: r.error || '连接测试失败' })
    }
  }

  const handleSaveProviderKey = async (providerId) => {
    const key = keyInput.trim()
    if (!key) {
      setKeyTestResult({ kind: 'warn', text: '请先输入要保存的 API Key' })
      return
    }
    const r = await actions.setProviderApiKey(providerId, key)
    if (r.success) {
      setKeyInput('')
      setKeyTestResult({ kind: 'success', text: '密钥已加密保存到凭据域' })
      toast.success('API Key 已保存')
    } else {
      setKeyTestResult({ kind: 'error', text: r.error || '密钥保存失败' })
    }
  }

  const handleClearProviderKey = async (providerId) => {
    const r = await actions.clearProviderApiKey(providerId)
    if (r.success) {
      setKeyInput('')
      setKeyTestResult({ kind: 'info', text: '已清除该供应商保存的 API Key' })
    } else {
      setKeyTestResult({ kind: 'error', text: r.error || '密钥清除失败' })
    }
  }

  const renderProviderKeyBlock = (provider, model) => {
    if (!provider) return null
    const eff = effectiveProvidersById[provider.id] || null
    const testing = Boolean(actionLoading[`testProviderKey:${provider.id}`])
    const savingKey = Boolean(actionLoading[`setProviderKey:${provider.id}`])
    return (
      <FormRow label={`API Key（${provider.name}）`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="sys-field__v" style={{ fontSize: 12 }}>
            {eff?.keyConfigured
              ? <>当前密钥：<span className="mono">已配置 {eff.keyHint}</span>{eff.keySource === 'store' ? '（凭据域托管）' : eff.keySource === 'env' ? '（环境变量）' : ''}</>
              : '当前密钥：未配置'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              type="password"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="输入新 API Key（留空则不修改）"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button type="button" className="btn btn-ghost btn-sm" disabled={testing} onClick={() => handleTestProviderKey(provider.id, model)}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={savingKey || !keyInput.trim()} onClick={() => handleSaveProviderKey(provider.id)}>
              {savingKey ? '保存中…' : '保存密钥'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!eff?.keyConfigured} onClick={() => handleClearProviderKey(provider.id)}>
              清除密钥
            </button>
          </div>
          {keyTestResult && (
            <span
              className="sys-field__v"
              style={{
                fontSize: 12,
                color:
                  keyTestResult.kind === 'success' ? 'var(--ok-ink)'
                  : keyTestResult.kind === 'warn' ? 'var(--warn-ink)'
                  : keyTestResult.kind === 'error' ? 'var(--err-ink)'
                  : 'var(--ink-3)',
              }}
            >
              {keyTestResult.text}
            </span>
          )}
          <span className="sys-field__v sys-field__v--dim" style={{ fontSize: 11 }}>
            密钥经 KEK 加密后存入凭据域并记录变更审计；保存后立即生效，无需再点「生效配置」。
          </span>
        </div>
      </FormRow>
    )
  }

  const renderScenarioBinding = (configKey) => {
    const scenarioKey = SCENARIO_KEY_BY_CONFIG[configKey]
    const binding = modelConfig.scenarioBindings?.[scenarioKey] || {}
    const boundProviderId = binding.providerId || draftProviders[0]?.id || ''
    const boundProvider = draftProviders.find((p) => p.id === boundProviderId) || null
    const catalogModels = boundProvider?.models || []
    const currentModel = modelConfig[configKey]?.model || binding.modelId || ''
    if (!draftProviders.length) {
      return (
        <div className="sys-alert" role="alert" style={{ marginBottom: 12 }}>
          暂无模型供应商，请先在「模型供应商」区新增供应商。
        </div>
      )
    }
    const modelOptions = currentModel && !catalogModels.some((m) => m.id === currentModel)
      ? [...catalogModels, { id: currentModel, label: `${currentModel}（目录外）` }]
      : catalogModels
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 14, marginBottom: 2, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormRow label="模型供应商">
            <select
              className="input"
              value={boundProviderId}
              onChange={(e) => {
                const pid = e.target.value
                const prov = draftProviders.find((p) => p.id === pid)
                const firstModel = prov?.models?.[0]?.id || currentModel
                handleScenarioBindingChange(configKey, scenarioKey, pid, firstModel)
              }}
            >
              {draftProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.enabled === false ? '（已停用）' : ''}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="模型">
            <select
              className="input"
              value={currentModel}
              onChange={(e) => handleScenarioBindingChange(configKey, scenarioKey, boundProviderId, e.target.value)}
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label && m.label !== m.id ? `${m.label}（${m.id}）` : m.id}</option>
              ))}
            </select>
          </FormRow>
        </div>
        {boundProvider ? renderProviderKeyBlock(boundProvider, currentModel) : null}
      </div>
    )
  }

  return (
    <PageShell
      crumb={[{ label: '工作台', to: '/' }, { label: '系统管理' }]}
      title={activeSection.label}
      subtitle={activeSection.subtitle}
      actions={[
        <button type="button"
          key="prompt"
          className="btn btn-ghost btn-sm"
          onClick={() => setDialog('prompt')}
        >
          ✎ 提示词
        </button>,
      ]}
    >
      <div className="system-tabs" role="tablist" aria-label="系统管理配置分类">
        {tabs.map((t) => {
          const active = activeSectionId === t.id
          return (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={active}
              className={active ? 'system-tab on' : 'system-tab'}
              onClick={() => { if (!active) navigate(t.route) }}
            >
              <span>{t.label}</span>
              {t.count ? <span className="ct">{t.count}</span> : null}
            </button>
          )
        })}
      </div>

      <div style={{ padding: '18px 24px' }}>
        {activeSectionId === 'rules' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">共 {rules.length} 条编码规则 · 点击卡片选中后可配置 / 生效 / 禁用</span>
              <button type="button" className="btn btn-out btn-sm" onClick={() => openRuleConfig()}>配置</button>
              <button type="button" className="btn btn-pri btn-sm" onClick={async () => { const r = await actions.activateRule(selectedRuleId); r.success ? toast.success('编码规则已生效') : toast.error(r.error || '操作失败') }}>
                ⌁ 生效
              </button>
              <button type="button" className="btn btn-dan btn-sm" onClick={async () => { const r = await actions.disableRule(selectedRuleId); r.success ? toast.success('编码规则已禁用') : toast.error(r.error || '操作失败') }}>
                禁用
              </button>
            </div>
            <div className="sys-grid">
              {rules.map((r) => {
                const selected = selectedRule?.code === r.code
                return (
                  <div
                    key={r.id || r.code}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    className={selected ? 'sys-card sys-card--selected' : 'sys-card'}
                    onClick={() => setSelectedRuleCode(r.code)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedRuleCode(r.code) } }}
                  >
                    <div className="sys-card__hd">
                      <span className="sys-card__title">{r.module}</span>
                      <span className={`bdg ${r.status === 'active' ? 'ci' : 'draft'}`}>
                        <span className="dot" />
                        {r.status === 'active' ? '生效中' : '已禁用'}
                      </span>
                      <span className="sys-card__code mono">{r.code}</span>
                    </div>
                    <div className="sys-card__bd">
                      <div className="sys-field">
                        <span className="sys-field__lb">前缀</span>
                        <span className="sys-field__v mono">{r.prefix}</span>
                      </div>
                      <div className="sys-field">
                        <span className="sys-field__lb">格式</span>
                        <span className="sys-field__v mono">{r.format}</span>
                      </div>
                      <div className="sys-field">
                        <span className="sys-field__lb">示例</span>
                        <span className="sys-field__v mono">{r.example}</span>
                      </div>
                      <div className="sys-field">
                        <span className="sys-field__lb">生效时间</span>
                        <span className="sys-field__v sys-field__v--dim mono">
                          {r.activatedAt ? r.activatedAt.replace('T', ' ').replace('Z', '') : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="sys-card__ft" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-out btn-sm" onClick={() => openRuleConfig(r)}>配置</button>
                      <button type="button" className="btn btn-pri btn-sm" onClick={async () => { const res = await actions.activateRule(r.id || r.code); res.success ? toast.success('编码规则已生效') : toast.error(res.error || '操作失败') }}>⌁ 生效</button>
                      <button type="button" className="btn btn-dan btn-sm" onClick={async () => { const res = await actions.disableRule(r.id || r.code); res.success ? toast.success('编码规则已禁用') : toast.error(res.error || '操作失败') }}>禁用</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeSectionId === 'model' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">修改后先保存草稿再生效</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSaveModelDraft} disabled={actionLoading.saveModelDraft}>
                {actionLoading.saveModelDraft ? '...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri btn-sm" onClick={handleActivateModel} disabled={actionLoading.activateModel}>
                {actionLoading.activateModel ? '...' : '⌁ 生效配置'}
              </button>
            </div>

            {effectiveConfig?.credentials && (!effectiveConfig.credentials.configured || !effectiveConfig.credentials.kekReady) && (
              <div className="sys-alert" role="alert">
                {!effectiveConfig.credentials.configured
                  ? '未配置可用的 API Key：AI 调用当前不可用，请在下方「模型供应商」区对应供应商的编辑弹窗中配置。'
                  : 'CREDENTIAL_KEK 未配置：密钥将无法加密保存，请在后端环境变量中配置后重启服务。'}
              </div>
            )}

            {/* RP-057：区段标题范式——标题 + 单行描述 + 右侧操作/状态，替代孤儿 caption 与表尾状态行 */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '10px 0 8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>模型供应商</h3>
                <span className="sys-field__v sys-field__v--dim" style={{ fontSize: 11 }}>
                  凭据按供应商加密托管
                  {effectiveConfig?.credentials?.lastAudit ? (
                    <>
                      {' · '}最近变更：{effectiveConfig.credentials.lastAudit.action === 'set' ? '设置密钥' : effectiveConfig.credentials.lastAudit.action === 'clear' ? '清除密钥' : effectiveConfig.credentials.lastAudit.action}
                      {' · '}{effectiveConfig.credentials.lastAudit.actor}
                      {' · '}{formatRelativeTime(effectiveConfig.credentials.lastAudit.at)}
                    </>
                  ) : null}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {effectiveConfig?.credentials ? (
                  <>
                    <span className={`tag ${effectiveConfig.credentials.source === 'store' ? 'ok' : effectiveConfig.credentials.source === 'env' ? 'warn' : 'err'}`}>
                      {effectiveConfig.credentials.source === 'store' ? '凭据域托管（加密落库）'
                        : effectiveConfig.credentials.source === 'env' ? '环境变量兜底'
                        : '凭据未配置'}
                    </span>
                    <span className={`tag ${effectiveConfig.credentials.kekReady ? 'ok' : 'err'}`}>
                      KEK {effectiveConfig.credentials.kekReady ? '就绪' : '未配置'}
                    </span>
                  </>
                ) : null}
                <button type="button" className="btn btn-pri btn-sm" onClick={openCreateProvider}>+ 新增供应商</button>
              </div>
            </div>
            <div className="sys-table-wrap" style={{ marginBottom: 14 }}>
              <table className="table sys-model-table" aria-label="模型供应商">
                <thead>
                  <tr>
                    <th>供应商</th>
                    <th>Base URL</th>
                    <th>模型</th>
                    <th>API Key</th>
                    <th>状态</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {draftProviders.map((provider) => {
                    const eff = effectiveProvidersById[provider.id] || null
                    return (
                      <tr key={provider.id} className="sys-model-row">
                        <td>
                          <div className="sys-model-scene">
                            <span className="sys-model-scene__name">{provider.name}</span>
                            <span className="sys-model-scene__purpose mono">{provider.protocol || 'openai-compatible'}</span>
                          </div>
                        </td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{provider.baseUrl || '—'}</span></td>
                        <td>
                          <div className="sys-model-chips">
                            {(provider.models || []).map((m) => <span key={m.id} className="sys-model-chip mono">{m.id}</span>)}
                            {!provider.models?.length ? <span className="sys-model-detail__mut">—</span> : null}
                          </div>
                        </td>
                        <td>
                          {eff ? (
                            eff.keyConfigured ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span className="mono" style={{ fontSize: 12 }}>已配置 {eff.keyHint}</span>
                                <span className={`tag ${eff.keySource === 'store' ? 'ok' : 'warn'}`}>{eff.keySource === 'store' ? '凭据托管' : '环境变量'}</span>
                              </span>
                            ) : <span className="tag err">未配置</span>
                          ) : '—'}
                        </td>
                        <td>
                          <span className={`bdg ${provider.enabled !== false ? 'ci' : 'draft'}`}>
                            <span className="dot" />
                            {provider.enabled !== false ? '启用' : '停用'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditProvider(provider)}>编辑</button>
                        </td>
                      </tr>
                    )
                  })}
                  {!draftProviders.length ? (
                    <tr><td colSpan={6} className="sys-model-detail__mut" style={{ textAlign: 'center', padding: 16 }}>暂无供应商，点击右上角「新增供应商」接入第一家模型服务</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '4px 0 8px' }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>场景模型绑定</h3>
              <span className="sys-field__v sys-field__v--dim" style={{ fontSize: 11 }}>点击行查看接线与差异</span>
            </div>
            <div className="sys-table-wrap">
              <table className="table sys-model-table" aria-label="场景模型绑定">
                <thead>
                  <tr>
                    <th>场景</th>
                    <th>生效模型</th>
                    <th>来源</th>
                    <th>关键参数</th>
                    <th>最近验证</th>
                    <th>状态</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_CARDS.map((card) => {
                    const scenarioKey = SCENARIO_KEY_BY_CONFIG[card.key]
                    const scenario = effectiveConfig?.scenarios?.find((s) => s.key === scenarioKey) || null
                    const activeCfg = modelActiveConfig?.[card.key] || null
                    const draftCfg = modelConfig[card.key] || {}
                    const diffs = buildScenarioDiff(draftCfg, activeCfg)
                    const wired = scenario ? scenario.wired : card.key !== 'kimiGeneration'
                    const resolvedModel = scenario?.resolvedModel || activeCfg?.model || draftCfg.model || '—'
                    const source = scenario?.source || 'binding'
                    const sourceBadge = SOURCE_BADGE[source] || SOURCE_BADGE.binding
                    const lastVerified = scenario?.lastVerified || null
                    const expanded = expandedScenario === card.key
                    const verifyLoading = Boolean(actionLoading[`testScenario:${scenarioKey}`])
                    return (
                      <React.Fragment key={card.key}>
                        <tr
                          className={`sys-model-row${expanded ? ' row-selected' : ''}${wired ? '' : ' sys-model-row--off'}`}
                          onClick={() => setExpandedScenario(expanded ? null : card.key)}
                        >
                          <td>
                            <div className="sys-model-scene">
                              <span className="sys-model-scene__name">{card.title}</span>
                              <span className="sys-model-scene__purpose">{card.desc}</span>
                            </div>
                          </td>
                          <td>
                            <span className="mono">{resolvedModel}</span>
                            {scenario?.providerName ? <div className="sys-model-detail__mut" style={{ fontSize: 11 }}>{scenario.providerName}</div> : null}
                          </td>
                          <td><span className={`tag ${sourceBadge.cls}`}>{sourceBadge.label}</span></td>
                          <td className="sys-model-params">{wired ? buildParamSummary(card.key, activeCfg || draftCfg) : '—'}</td>
                          <td>
                            {lastVerified ? (
                              <span className={`sys-model-verify ${lastVerified.ok ? 'ok' : 'err'}`}>
                                {lastVerified.ok ? '✓' : '✗'} {formatRelativeTime(lastVerified.at)}
                                <span className="sys-model-verify__model mono">{lastVerified.model}</span>
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            {!wired ? (
                              <span className="bdg draft"><span className="dot" />规划中</span>
                            ) : diffs.length ? (
                              <span className="bdg warn"><span className="dot" />有草稿待生效</span>
                            ) : (
                              <span className="bdg ci"><span className="dot" />已生效</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div className="sys-model-actions">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={!wired}
                                title={wired ? '' : '该场景尚未接入业务链路（规划中）'}
                                onClick={() => { modelSnapshotRef.current = JSON.parse(JSON.stringify(modelConfig)); setModelDirty(false); setModelSaveError(null); setKeyInput(''); setKeyTestResult(null); setEditingModel(card.key) }}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={!wired || verifyLoading || (effectiveConfig ? !effectiveConfig.credentials.configured : false)}
                                title={!wired ? '该场景尚未接入业务链路（规划中）' : effectiveConfig && !effectiveConfig.credentials.configured ? '未配置 API Key' : '用生效模型发最小真实请求'}
                                onClick={async () => {
                                  const r = await actions.testScenario(scenarioKey)
                                  if (r.success) {
                                    const d = r.data || {}
                                    const detail = [
                                      d.resolvedModel && `生效模型: ${d.resolvedModel}`,
                                      d.respondedModel && `响应模型: ${d.respondedModel}`,
                                      d.latencyMs != null && `延迟: ${d.latencyMs}ms`,
                                    ].filter(Boolean).join(' · ')
                                    if (d.modelMatch === false) {
                                      toast.warn('验证通过，但模型名不匹配', { detail, duration: 6000 })
                                    } else {
                                      toast.success(`${card.title} 验证通过`, { detail, duration: 5000 })
                                    }
                                  } else {
                                    toast.error(r.error || `${card.title} 验证失败`)
                                  }
                                }}
                              >
                                {verifyLoading ? '验证中…' : '验证此场景'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="sys-model-detail">
                            <td colSpan={7}>
                              <div className="sys-model-detail__grid">
                                <div>
                                  <div className="sys-model-detail__hd">接线参数</div>
                                  {scenario && scenario.wiredParams.length ? (
                                    <div className="sys-model-chips">
                                      {scenario.wiredParams.map((p) => <span key={p} className="sys-model-chip mono">{p}</span>)}
                                    </div>
                                  ) : (
                                    <span className="sys-model-detail__mut">该场景暂无接线参数</span>
                                  )}
                                  {scenario?.notes?.length ? (
                                    <ul className="sys-model-notes">
                                      {scenario.notes.map((n) => <li key={n}>{n}</li>)}
                                    </ul>
                                  ) : null}
                                </div>
                                <div>
                                  <div className="sys-model-detail__hd">草稿 vs 生效</div>
                                  {diffs.length ? (
                                    <ul className="sys-model-diff">
                                      {diffs.map((d) => (
                                        <li key={d.field}>
                                          <span className="mono">{d.field}</span>
                                          <span className="sys-model-diff__change">{d.from} → <b>{d.to}</b></span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="sys-model-detail__mut">草稿与生效一致</span>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

          </div>
        )}


        {activeSectionId === 'kb' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">智谱知识库接入与连通性验证</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSaveKbDraft} disabled={actionLoading.saveKbDraft || kbLoading}>
                {actionLoading.saveKbDraft ? '保存中...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri btn-sm" onClick={handleActivateKb} disabled={actionLoading.activateKbConfig || kbLoading}>
                {actionLoading.activateKbConfig ? '...' : '⌁ 生效配置'}
              </button>
            </div>

            {kbSaveResult && (
              <div
                role={kbSaveResult.ok ? 'status' : 'alert'}
                className={`sys-banner ${kbSaveResult.ok ? 'sys-banner--ok' : 'sys-banner--danger'}`}
              >
                <span className="sys-banner__ic">{kbSaveResult.ok ? '✓' : '✗'}</span>
                <div className="sys-banner__ti">{kbSaveResult.message}</div>
              </div>
            )}

            <div className={`sys-banner ${kbConfig.resolvedFrom !== 'none' ? 'sys-banner--ok' : 'sys-banner--warn'}`}>
              <span className="sys-banner__ic">{kbConfig.resolvedFrom !== 'none' ? '✓' : '⚠'}</span>
              <div>
                <div className="sys-banner__ti">
                  {kbConfig.resolvedFrom === 'store' ? '知识库接入已配置（来自存储）' : kbConfig.resolvedFrom === 'env' ? '知识库接入已配置（来自环境变量）' : '知识库接入未配置'}
                </div>
                <div className="sys-banner__sub">
                  {kbConfig.resolvedFrom !== 'none'
                    ? `当前草稿包含 ${kbConfig.knowledgeBases.length} 个知识库档案，其中 ${kbConfig.knowledgeBases.filter((item) => item.enabled).length} 个已启用`
                    : '请填写共享 API Key，新增知识库档案，保存草稿并逐个测试后再生效'}
                </div>
              </div>
            </div>

            <div className="sys-card">
              <div className="sys-card__hd">
                <span className="sys-card__title">智谱共享接入配置</span>
              </div>
              <div className="sys-card__bd sys-card__bd--col" style={{ paddingTop: 14 }}>
                <div className="sys-field sys-field--loose">
                  <span className="sys-field__lb">API Key</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {kbConfig.apiHint && !kbConfig.apiKey && (
                      <span className="bdg muted">{kbConfig.apiHint}</span>
                    )}
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 200, maxWidth: 400 }}
                      type="password"
                      placeholder="输入智谱 API Key"
                      value={kbConfig.apiKey}
                      onChange={(e) => actions.updateKbConfig({ apiKey: e.target.value })}
                    />
                    {kbConfig.apiKey && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.updateKbConfig({ apiKey: '' })}>
                        清除
                      </button>
                    )}
                    {kbConfig.apiHint && !kbConfig.apiKey && (
                      <button type="button" className="btn btn-dan btn-sm" onClick={() => setConfirmClearKbKey(true)}>
                        清除已保存密钥
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(240px,2fr)', gap: 12 }}>
                  <div className="sys-field sys-field--loose">
                    <span className="sys-field__lb">模型</span>
                    <input
                      className="input"
                      value={kbConfig.model}
                      onChange={(e) => actions.updateKbConfig({ model: e.target.value })}
                    />
                  </div>
                  <div className="sys-field sys-field--loose">
                    <span className="sys-field__lb">API Base URL</span>
                    <input
                      className="input"
                      value={kbConfig.apiBaseUrl}
                      onChange={(e) => actions.updateKbConfig({ apiBaseUrl: e.target.value })}
                    />
                  </div>
                </div>

                <fieldset className="kb-retrieval-params">
                  <legend>检索参数</legend>
                  <div className="kb-retrieval-params__grid">
                    <label>
                      Top K
                      <input className="input" type="number" min="1" max="50" value={kbConfig.retrievalParams.topK} onChange={(e) => actions.updateKbConfig({ retrievalParams: { ...kbConfig.retrievalParams, topK: Number(e.target.value) } })} />
                    </label>
                    <label>
                      Top N
                      <input className="input" type="number" min="1" max="100" value={kbConfig.retrievalParams.topN} onChange={(e) => actions.updateKbConfig({ retrievalParams: { ...kbConfig.retrievalParams, topN: Number(e.target.value) } })} />
                    </label>
                    <label>
                      召回方式
                      <select className="input" value={kbConfig.retrievalParams.recallMethod} onChange={(e) => actions.updateKbConfig({ retrievalParams: { ...kbConfig.retrievalParams, recallMethod: e.target.value } })}>
                        <option value="mixed">混合检索</option>
                        <option value="vector">向量检索</option>
                        <option value="keyword">关键词检索</option>
                      </select>
                    </label>
                    <label>
                      相似度阈值
                      <input className="input" type="number" min="0" max="1" step="0.05" value={kbConfig.retrievalParams.fractionalThreshold} onChange={(e) => actions.updateKbConfig({ retrievalParams: { ...kbConfig.retrievalParams, fractionalThreshold: Number(e.target.value) } })} />
                    </label>
                    <label>
                      重排模型
                      <input className="input" value={kbConfig.retrievalParams.rerankModel} onChange={(e) => actions.updateKbConfig({ retrievalParams: { ...kbConfig.retrievalParams, rerankModel: e.target.value } })} />
                    </label>
                    <label className="kb-retrieval-params__check">
                      <input type="checkbox" checked={kbConfig.retrievalParams.rerankStatus === 1} onChange={(e) => actions.updateKbConfig({ retrievalParams: { ...kbConfig.retrievalParams, rerankStatus: e.target.checked ? 1 : 0 } })} />
                      启用检索重排
                    </label>
                  </div>
                </fieldset>

                <KnowledgeBaseProfilesPanel
                  profiles={kbConfig.knowledgeBases}
                  probes={kbConfig.probes}
                  disabled={kbLoading || actionLoading.saveKbDraft || actionLoading.activateKbConfig}
                  testingProfileId={kbTestingProfileId}
                  onChange={(knowledgeBases) => actions.updateKbConfig({ knowledgeBases })}
                  onTest={handleTestKbProfile}
                />

                {kbTestResult && (
                  <div role={kbTestResult.ok ? 'status' : 'alert'} className={`sys-banner ${kbTestResult.ok ? 'sys-banner--ok' : 'sys-banner--danger'}`}>
                    <span className="sys-banner__ic">{kbTestResult.ok ? '✓' : '✗'}</span>
                    <div>
                      <div className="sys-banner__ti">
                        {kbTestResult.ok
                          ? kbTestResult.warning === 'retrieval_empty' ? '连通性测试通过，但未检索到文档' : '连通性测试通过'
                          : '连通性测试失败'}
                      </div>
                      {kbTestResult.ok ? (
                        <div className="sys-banner__sub">
                          {[
                            kbTestResult.model && `模型 ${kbTestResult.model}`,
                            kbTestResult.knowledgeId && `知识库 ${kbTestResult.knowledgeId}`,
                            kbTestResult.latencyMs !== undefined && `延迟 ${kbTestResult.latencyMs}ms`,
                            kbTestResult.retrievalTriggered !== undefined && `检索触发 ${kbTestResult.retrievalTriggered ? '是' : '否'}`,
                            kbTestResult.testedSource && `凭证来源 ${kbTestResult.testedSource === 'draft_store' ? '草稿存储' : kbTestResult.testedSource === 'environment' ? '环境变量' : '请求参数'}`,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      ) : (
                        <div className="sys-banner__sub">{[kbTestResult.error || '未知错误', kbTestResult.status && `HTTP ${kbTestResult.status}`].filter(Boolean).join(' · ')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeSectionId === 'kbRetrieval' && (
          <KnowledgeRetrievalDiagnosePanel />
        )}

        {activeSectionId === 'rate' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">RateCard · 当前生效 · 共 {ratecard.length} 个角色基准</span>
              <button type="button" className="btn btn-ghost btn-sm">
                编辑
              </button>
            </div>
            <div className="sys-grid">
              {ratecard.map((r) => (
                <div key={r.role} className="sys-card">
                  <div className="sys-card__hd">
                    <span className="sys-card__title">{r.role}</span>
                  </div>
                  <div className="sys-card__bd sys-card__bd--col">
                    <div className="sys-field">
                      <span className="sys-field__lb">人天单价</span>
                      <span className="sys-field__v" style={{ fontSize: 16, fontWeight: 800 }}>{r.price}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSectionId === 'dsl' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">共 {dslRules.length} 条实施评估依赖规则</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const r = await actions.saveDslDraft(); r.success ? toast.success('DSL 草稿已保存') : toast.error(r.error || '保存失败') }}>
                保存草稿
              </button>
              <button type="button" className="btn btn-pri btn-sm" onClick={async () => { const r = await actions.activateDsl(); r.success ? toast.success('DSL 规则已生效') : toast.error(r.error || '操作失败') }}>
                ⌁ 生效
              </button>
            </div>
            <div className="sys-grid">
              {dslRules.map((r) => (
                <div key={r.id} className="sys-card">
                  <div className="sys-card__hd">
                    <span className="sys-card__title mono">{r.id}</span>
                    <span className={`bdg ${r.type === 'blocking' ? 'lock' : 'warn'}`}>
                      <span className="dot" />
                      {r.type === 'blocking' ? '阻断' : '警告'}
                    </span>
                  </div>
                  <div className="sys-card__bd sys-card__bd--col">
                    <div className="sys-field">
                      <span className="sys-field__v sys-field__v--dim" style={{ fontWeight: 500, lineHeight: 1.6 }}>{r.message}</span>
                    </div>
                  </div>
                  <div className="sys-card__ft">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
                      <input type="checkbox" className="sys-check" checked={r.enabled} onChange={() => actions.toggleDsl(r.id)} />
                      {r.enabled ? '已启用' : '已停用'}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSectionId === 'tpl' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">共 {templates.length} 个评估模板与复用资产</span>
            </div>
            <div className="sys-grid">
              {templates.map((t) => (
                <div key={t.id} className="sys-card">
                  <div className="sys-card__hd">
                    <span className="sys-card__title">{t.name}</span>
                  </div>
                  <div className="sys-card__bd sys-card__bd--col">
                    <div className="sys-field">
                      <span className="sys-field__v sys-field__v--dim" style={{ fontWeight: 500, lineHeight: 1.6 }}>{t.desc}</span>
                    </div>
                    <div className="sys-field">
                      <span className="sys-field__lb">标签</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {t.tags.map((tag) => (
                          <span key={tag} className="bdg brd">{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="sys-card__ft">
                    <span className="sp" />
                    <button type="button"
                      className="btn btn-pri btn-sm"
                      onClick={() => { const name = actions.useTemplate(t.name); toast.success(`已使用模板「${name}」`) }}
                    >
                      使用
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSectionId === 'testResults' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">共 {testResults.length} 条人工测试结果登记</span>
              <button type="button" className="btn btn-pri btn-sm" onClick={() => setTestResultDialog(true)}>+ 新建</button>
            </div>
            {testResultsLoading ? (
              <div className="sys-empty">加载中...</div>
            ) : testResults.length === 0 ? (
              <div className="sys-empty">暂无测试结果记录</div>
            ) : (
              <div className="sys-grid">
                {testResults.map((r) => {
                  const st = TEST_RESULT_STATUS[r.resultStatus] || TEST_RESULT_STATUS.skipped
                  return (
                    <div key={r.manualTestResultId} className="sys-card">
                      <div className="sys-card__hd">
                        <span className="sys-card__title mono">{r.testCaseKey || '—'}</span>
                        <span className={`bdg ${st.cls}`}>
                          <span className="dot" />
                          {st.label}
                        </span>
                      </div>
                      <div className="sys-card__bd">
                        <div className="sys-field">
                          <span className="sys-field__lb">执行人</span>
                          <span className="sys-field__v">{r.executorName}</span>
                        </div>
                        <div className="sys-field">
                          <span className="sys-field__lb">环境</span>
                          <span className="sys-field__v">{r.environment}</span>
                        </div>
                        <div className="sys-field">
                          <span className="sys-field__lb">账号</span>
                          <span className="sys-field__v sys-field__v--dim">{r.account || '—'}</span>
                        </div>
                        <div className="sys-field">
                          <span className="sys-field__lb">截图</span>
                          <span className="sys-field__v">
                            {r.screenshotUrl ? <a href={r.screenshotUrl} target="_blank" rel="noreferrer">查看</a> : '—'}
                          </span>
                        </div>
                        {r.notes && (
                          <div className="sys-field sys-field--full">
                            <span className="sys-field__lb">备注</span>
                            <span className="sys-field__v sys-field__v--dim" style={{ fontWeight: 500 }}>{r.notes}</span>
                          </div>
                        )}
                      </div>
                      <div className="sys-card__ft">
                        <span className="sp" />
                        <button type="button" className="btn btn-dan btn-sm" onClick={async () => { if (confirm('确认删除？')) await actions.deleteTestResult(r.harnessRunId, r.manualTestResultId) }}>删除</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeSectionId === 'sessions' && (
          <AiSessionAuditPanel />
        )}

        {activeSectionId === 'memory' && (
          <MemoryManagementPanel />
        )}
      </div>

      {/* 编码规则配置 dialog */}
      <Dialog
        open={dialog === 'rule'}
        title="配置编码规则"
        onClose={() => setDialog(null)}
      >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                前缀
                <input
                  className="input"
                  value={ruleConfigForm.prefix}
                  onChange={(event) => setRuleConfigForm((current) => ({ ...current, prefix: event.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                格式
                <input
                  className="input"
                  value={ruleConfigForm.format}
                  onChange={(event) => setRuleConfigForm((current) => ({ ...current, format: event.target.value }))}
                />
              </label>
            </div>
            <DialogActions>
              <button type="button" className="btn btn-out" onClick={() => setDialog(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-pri"
                disabled={actionLoading[`configure:${selectedRuleId}`]}
                onClick={async () => {
                  const result = await actions.configureRule(selectedRuleId, ruleConfigForm)
                  if (result.success) { setDialog(null); toast.success('编码规则配置已保存') } else { toast.error(result.error || '保存失败') }
                }}
              >
                {actionLoading[`configure:${selectedRuleId}`] ? '保存中...' : '保存配置'}
              </button>
            </DialogActions>
      </Dialog>

      {/* 提示词 dialog */}
      <Dialog
        open={dialog === 'prompt'}
        title="提示词管理"
        onClose={() => setDialog(null)}
        wide
      >
            <div className="tabs" style={{ marginBottom: 12 }}>
              {PROMPT_TABS.map((t) => (
                <span
                  key={t.key}
                  className={promptTab === t.key ? 'on' : ''}
                  onClick={() => setPromptTab(t.key)}
                  style={{ cursor: 'pointer' }}
                >
                  {t.label}
                </span>
              ))}
            </div>
            <textarea
              className="input"
              value={prompts[promptTab]}
              onChange={(e) =>
                setPrompts((prev) => ({ ...prev, [promptTab]: e.target.value }))
              }
              style={{ height: 'auto', minHeight: 200, padding: '10px 12px', lineHeight: 1.6, resize: 'vertical' }}
            />
            {promptResult && (
              <div style={{marginBottom:12,padding:12,background:'var(--bg-soft)',border:'1px solid var(--line)',borderRadius:'var(--r-md)',maxHeight:200,overflowY:'auto'}}>
                <pre style={{margin:0,fontSize:11,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'var(--font-mono)'}}>{JSON.stringify(promptResult, null, 2)}</pre>
              </div>
            )}
            <DialogActions>
              <button type="button" className="btn btn-ghost btn-sm" disabled={actionLoading.testPrompt} onClick={async () => {
                const r = await actions.testPrompt(prompts[promptTab])
                if (r) setPromptResult(r)
              }}>
                {actionLoading.testPrompt ? '测试中...' : '测试'}
              </button>
              <button type="button" className="btn btn-out btn-sm" onClick={() => { setDialog(null); setPromptResult(null) }}>
                取消
              </button>
              <button type="button"
                className="btn btn-pri btn-sm"
                disabled={actionLoading.savePrompts}
                onClick={async () => {
                  await actions.savePrompts()
                  setDialog(null)
                  setPromptResult(null)
                }}
              >
                {actionLoading.savePrompts ? '保存中...' : '保存'}
              </button>
            </DialogActions>
      </Dialog>

      {/* 模型编辑 dialog */}
      <Dialog
        open={Boolean(editingModel)}
        title={`编辑 ${MODEL_CARDS.find((c) => c.key === editingModel)?.title || ''}`}
        onClose={requestCloseModelEdit}
        wide
        dismissDisabled={modelSaving}
      >
            {editingModel ? renderScenarioBinding(editingModel) : null}
            {editingModel === 'kimiEvaluation' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FormRow label="启用">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={modelConfig.kimiEvaluation.enabled} onChange={(e) => handleModelConfigChange('kimiEvaluation', { enabled: e.target.checked })} />
                    启用实施评估场景
                  </label>
                </FormRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="Temperature">
                    <input className="input" type="number" min="0" max="1" step="0.1" value={modelConfig.kimiEvaluation.temperature} disabled={isModelParamLocked('kimiEvaluation', 'temperature')} onChange={(e) => handleModelConfigChange('kimiEvaluation', { temperature: Number(e.target.value) })} />
                  </FormRow>
                  <FormRow label="最大 Tokens">
                    <input className="input" type="number" min="256" max="32000" value={modelConfig.kimiEvaluation.maxTokens} disabled={isModelParamLocked('kimiEvaluation', 'maxTokens')} onChange={(e) => handleModelConfigChange('kimiEvaluation', { maxTokens: Number(e.target.value) })} />
                  </FormRow>
                </div>
                {renderLockedParamHint('kimiEvaluation')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="超时(ms)">
                    <input className="input" type="number" min="3000" max="120000" value={modelConfig.kimiEvaluation.timeoutMs} onChange={(e) => handleModelConfigChange('kimiEvaluation', { timeoutMs: Number(e.target.value) })} />
                  </FormRow>
                  <FormRow label="回退到规则">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={modelConfig.kimiEvaluation.fallbackToRule} onChange={(e) => handleModelConfigChange('kimiEvaluation', { fallbackToRule: e.target.checked })} />
                      启用
                    </label>
                  </FormRow>
                </div>
                <FormRow label="Prompt Profile">
                  <input className="input" value={modelConfig.kimiEvaluation.promptProfile} onChange={(e) => handleModelConfigChange('kimiEvaluation', { promptProfile: e.target.value })} />
                </FormRow>
                <FormRow label="Prompt 模板">
                  <textarea
                    className="input"
                    value={modelConfig.kimiEvaluation.promptTemplate}
                    onChange={(e) => handleModelConfigChange('kimiEvaluation', { promptTemplate: e.target.value })}
                    style={{ height: 'auto', minHeight: 120, padding: '8px 10px', fontSize: 12, lineHeight: 1.5, resize: 'vertical' }}
                  />
                </FormRow>
              </div>
            )}
            {editingModel === 'fileParsing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FormRow label="启用">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={modelConfig.fileParsing.enabled} onChange={(e) => handleModelConfigChange('fileParsing', { enabled: e.target.checked })} />
                    启用文件解析场景
                  </label>
                </FormRow>
                <FormRow label="允许的扩展名">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {(modelConfig.fileParsing.allowedExtensions || []).map((ext) => (
                      <span key={ext} className="bdg brd">
                        {ext}
                        <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => handleModelConfigChange('fileParsing', { allowedExtensions: modelConfig.fileParsing.allowedExtensions.filter((e) => e !== ext) })}>×</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="如 .pdf" value={extInput} onChange={(e) => setExtInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && extInput.trim()) { const v = extInput.trim().startsWith('.') ? extInput.trim() : `.${extInput.trim()}`; handleModelConfigChange('fileParsing', { allowedExtensions: [...new Set([...modelConfig.fileParsing.allowedExtensions, v])] }); setExtInput('') } }} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (extInput.trim()) { const v = extInput.trim().startsWith('.') ? extInput.trim() : `.${extInput.trim()}`; handleModelConfigChange('fileParsing', { allowedExtensions: [...new Set([...modelConfig.fileParsing.allowedExtensions, v])] }); setExtInput('') } }}>添加</button>
                  </div>
                </FormRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="最大文件(MB)">
                    <input className="input" type="number" min="1" max="200" value={modelConfig.fileParsing.maxFileSizeMb} onChange={(e) => handleModelConfigChange('fileParsing', { maxFileSizeMb: Number(e.target.value) })} />
                  </FormRow>
                  <FormRow label="最大 Sheet 数">
                    <input className="input" type="number" min="1" max="200" value={modelConfig.fileParsing.maxSheetCount} onChange={(e) => handleModelConfigChange('fileParsing', { maxSheetCount: Number(e.target.value) })} />
                  </FormRow>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="严格模式">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={modelConfig.fileParsing.strictMode} onChange={(e) => handleModelConfigChange('fileParsing', { strictMode: e.target.checked })} />
                      启用
                    </label>
                  </FormRow>
                  <FormRow label="OCR">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={modelConfig.fileParsing.ocrEnabled} onChange={(e) => handleModelConfigChange('fileParsing', { ocrEnabled: e.target.checked })} />
                      启用
                    </label>
                  </FormRow>
                </div>
              </div>
            )}
            {editingModel === 'kimiGeneration' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FormRow label="启用">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={modelConfig.kimiGeneration.enabled} onChange={(e) => handleModelConfigChange('kimiGeneration', { enabled: e.target.checked })} />
                    启用内容生成场景
                  </label>
                </FormRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="Temperature">
                    <input className="input" type="number" min="0" max="1" step="0.1" value={modelConfig.kimiGeneration.temperature} disabled={isModelParamLocked('kimiGeneration', 'temperature')} onChange={(e) => handleModelConfigChange('kimiGeneration', { temperature: Number(e.target.value) })} />
                  </FormRow>
                  <FormRow label="最大 Tokens">
                    <input className="input" type="number" min="256" max="32000" value={modelConfig.kimiGeneration.maxTokens} disabled={isModelParamLocked('kimiGeneration', 'maxTokens')} onChange={(e) => handleModelConfigChange('kimiGeneration', { maxTokens: Number(e.target.value) })} />
                  </FormRow>
                </div>
                {renderLockedParamHint('kimiGeneration')}
                <FormRow label="输出风格">
                  <select className="input" value={modelConfig.kimiGeneration.outputStyle} onChange={(e) => handleModelConfigChange('kimiGeneration', { outputStyle: e.target.value })}>
                    {OUTPUT_STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </FormRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="风险提示">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={modelConfig.kimiGeneration.includeRiskHints} onChange={(e) => handleModelConfigChange('kimiGeneration', { includeRiskHints: e.target.checked })} />
                      包含
                    </label>
                  </FormRow>
                  <FormRow label="假设说明">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={modelConfig.kimiGeneration.includeAssumptions} onChange={(e) => handleModelConfigChange('kimiGeneration', { includeAssumptions: e.target.checked })} />
                      包含
                    </label>
                  </FormRow>
                </div>
              </div>
            )}
            {modelSaveError && (
              <div role="alert" style={{ background: 'var(--err-soft)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', color: 'var(--err)', fontSize: 12, fontWeight: 700, padding: '8px 12px', marginBottom: 10 }}>
                ✗ {modelSaveError}
              </div>
            )}
            <DialogActions>
              <button type="button" className="btn btn-out btn-sm" onClick={requestCloseModelEdit} disabled={modelSaving}>
                取消
              </button>
              <button type="button" className="btn btn-pri btn-sm" onClick={handleModelEditSave} disabled={modelSaving}>
                {modelSaving ? '保存中...' : '确定'}
              </button>
            </DialogActions>
      </Dialog>

      {/* 供应商新增/编辑 dialog（ISS-2026-08-11-001） */}
      <Dialog
        open={Boolean(providerDialog)}
        title={providerDialog?.mode === 'edit' ? `编辑供应商 · ${providerForm.name || ''}` : '新增供应商'}
        onClose={() => { if (!providerSaving) setProviderDialog(null) }}
        wide
        dismissDisabled={providerSaving}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormRow label="供应商名称">
              <input className="input" placeholder="如 OpenAI" value={providerForm.name} onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))} />
            </FormRow>
            <FormRow label="Base URL">
              <input className="input mono" placeholder="https://api.openai.com/v1" value={providerForm.baseUrl} onChange={(e) => setProviderForm((f) => ({ ...f, baseUrl: e.target.value }))} />
            </FormRow>
          </div>
          <FormRow label="模型目录">
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {providerForm.models.map((id) => (
                  <span key={id} className="bdg brd">
                    {id}
                    <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setProviderForm((f) => ({ ...f, models: f.models.filter((m) => m !== id) }))}>×</span>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="如 gpt-4o"
                  value={providerModelInput}
                  onChange={(e) => setProviderModelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProviderModel() } }}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addProviderModel}>添加</button>
              </div>
            </div>
          </FormRow>
          <FormRow label="启用">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={providerForm.enabled} onChange={(e) => setProviderForm((f) => ({ ...f, enabled: e.target.checked }))} />
              启用该供应商（停用后新绑定不可选，存量绑定仍按原配置运行）
            </label>
          </FormRow>
          {providerDialog?.mode === 'edit' ? (
            renderProviderKeyBlock(
              draftProviders.find((p) => p.id === providerDialog.id) || null,
              providerForm.models[0] || '',
            )
          ) : (
            <span className="sys-field__v sys-field__v--dim" style={{ fontSize: 11 }}>
              保存供应商后可配置 API Key；密钥按供应商独立托管（加密落库 + 变更审计）。
            </span>
          )}
          {providerSaveError && (
            <div role="alert" style={{ background: 'var(--err-soft)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', color: 'var(--err)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>
              ✗ {providerSaveError}
            </div>
          )}
        </div>
        <DialogActions>
          <button type="button" className="btn btn-out btn-sm" onClick={() => setProviderDialog(null)} disabled={providerSaving}>取消</button>
          <button type="button" className="btn btn-pri btn-sm" onClick={handleProviderSave} disabled={providerSaving}>
            {providerSaving ? '保存中...' : '保存供应商'}
          </button>
        </DialogActions>
      </Dialog>

      {/* 模型编辑脏关闭确认 */}
      <Dialog
        open={confirmDiscardModel}
        title="放弃修改"
        description="当前编辑内容尚未保存，确认放弃修改吗？"
        onClose={() => setConfirmDiscardModel(false)}
      >
        <DialogActions>
          <button type="button" className="btn btn-out" onClick={() => setConfirmDiscardModel(false)}>
            继续编辑
          </button>
          <button type="button" className="btn btn-dan" onClick={confirmDiscard}>
            放弃修改
          </button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmClearKbKey}
        title="清除已保存密钥"
        description="此操作会从知识库配置草稿中删除 API Key。如要将清除结果正式生效，仍需重新测试连通性并生效配置。"
        onClose={() => setConfirmClearKbKey(false)}
        dismissDisabled={actionLoading.clearKbApiKeyDraft}
      >
        <DialogActions>
          <button type="button" className="btn btn-out btn-sm" onClick={() => setConfirmClearKbKey(false)} disabled={actionLoading.clearKbApiKeyDraft}>
            取消
          </button>
          <button type="button" className="btn btn-dan btn-sm" onClick={handleClearKbKey} disabled={actionLoading.clearKbApiKeyDraft}>
            {actionLoading.clearKbApiKeyDraft ? '清除中...' : '确认清除'}
          </button>
        </DialogActions>
      </Dialog>

      {/* 新建测试结果 dialog */}
      <Dialog
        open={testResultDialog}
        title="新建人工测试结果"
        onClose={() => setTestResultDialog(false)}
        wide
      >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="执行人 *">
                <input className="input" value={testResultForm.executorName} onChange={(e) => setTestResultForm((f) => ({ ...f, executorName: e.target.value }))} />
              </FormRow>
              <FormRow label="环境 *">
                <input className="input" value={testResultForm.environment} onChange={(e) => setTestResultForm((f) => ({ ...f, environment: e.target.value }))} />
              </FormRow>
              <FormRow label="账号">
                <input className="input" value={testResultForm.account} onChange={(e) => setTestResultForm((f) => ({ ...f, account: e.target.value }))} />
              </FormRow>
              <FormRow label="用例编号">
                <input className="input" value={testResultForm.testCaseKey} onChange={(e) => setTestResultForm((f) => ({ ...f, testCaseKey: e.target.value }))} />
              </FormRow>
              <FormRow label="结果状态 *">
                <select className="input" value={testResultForm.resultStatus} onChange={(e) => setTestResultForm((f) => ({ ...f, resultStatus: e.target.value }))}>
                  <option value="passed">通过</option>
                  <option value="failed">失败</option>
                  <option value="blocked">阻塞</option>
                  <option value="skipped">跳过</option>
                </select>
              </FormRow>
              <FormRow label="截图 URL">
                <input className="input" value={testResultForm.screenshotUrl} onChange={(e) => setTestResultForm((f) => ({ ...f, screenshotUrl: e.target.value }))} />
              </FormRow>
              <FormRow label="备注" className="sys-field--full">
                <textarea className="input" style={{ height: 'auto', minHeight: 64, padding: '6px 10px', resize: 'vertical' }} value={testResultForm.notes} onChange={(e) => setTestResultForm((f) => ({ ...f, notes: e.target.value }))} />
              </FormRow>
            </div>
            <DialogActions>
              <button type="button" className="btn btn-out btn-sm" onClick={() => setTestResultDialog(false)}>取消</button>
              <button type="button" className="btn btn-pri btn-sm" onClick={async () => {
                if (!testResultForm.executorName || !testResultForm.environment) { toast.warn('执行人和环境必填'); return }
                await actions.createTestResult(testResultForm)
                setTestResultDialog(false)
                setTestResultForm({ executorName: '', environment: '', account: '', testCaseKey: '', resultStatus: 'passed', screenshotUrl: '', notes: '' })
              }}>确定</button>
            </DialogActions>
      </Dialog>
    </PageShell>
  )
}

function FormRow({ label, children, className }) {
  return (
    <div className={`sys-field sys-field--loose${className ? ` ${className}` : ''}`}>
      <span className="sys-field__lb">{label}</span>
      {children}
    </div>
  )
}
