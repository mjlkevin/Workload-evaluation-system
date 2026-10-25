import TestResultsSection from './system/TestResultsSection.jsx'
import ModelConfigurationSection from './system/ModelConfigurationSection.jsx'
import TemplatesSection from './system/TemplatesSection.jsx'
import RateCardSection from './system/RateCardSection.jsx'
import DslRulesSection from './system/DslRulesSection.jsx'
import CodeRulesSection from './system/CodeRulesSection.jsx'
import React, { useEffect, useRef, useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
import AiSessionAuditPanel from '../components/system/AiSessionAuditPanel.jsx'
import KnowledgeBaseSection from './system/KnowledgeBaseSection.jsx'
import KnowledgeRetrievalDiagnosePanel from '../components/system/KnowledgeRetrievalDiagnosePanel.jsx'
import MemoryManagementPanel from '../components/system/MemoryManagementPanel.jsx'
import AiToolInventoryPanel from '../components/system/AiToolInventoryPanel.jsx'
import { SYSTEM_MANAGEMENT_SECTIONS, getSystemManagementSectionById } from '../config/systemManagementSections.js'
import StateMachinesSection from './system/StateMachinesSection.jsx'
import SystemManagementNav from './system/SystemManagementNav.jsx'
import useSystemManagement from '../hooks/useSystemManagement.js'
import { useToast } from '../hooks/useToast.jsx'

const PROMPT_TABS = [
  { key: 'assessment', label: '评估提示词' },
  { key: 'parse', label: '文件解析提示词' },
  { key: 'generate', label: '生成提示词' },
]

// DEF-2026-09-02-001：知识库连通性失败 → 人话原因。仅按后端已分类的 reason
// 出文案，供应商原始 code/msg 附注在括号内；文案不含密钥与请求体片段，
// 无映射时回退后端 message（HTTP 状态由横幅降为次要信息拼接）。
function describeKbTestFailure(kbTestResult) {
  const detail = Array.isArray(kbTestResult?.details)
    ? kbTestResult.details.find((d) => d && d.field === 'knowledgeBase')
    : null
  const code = detail?.providerCode
  const providerMessage = detail?.providerMessage
  const suffix = code != null
    ? `（智谱 code=${code}${providerMessage ? `，供应商：${providerMessage.slice(0, 80)}` : ''}）`
    : ''
  switch (detail?.reason) {
    case 'provider_unspecified_rejection':
      return code === 500
        ? '供应商拒绝（智谱 code=500，常见于重排未授权），可尝试关闭检索重排'
        : `供应商未说明原因的拒绝${suffix}`
    case 'authentication_failed':
      return `供应商鉴权失败${suffix}，请检查 API 密钥是否有效`
    case 'invalid_arguments':
      return `供应商参数错误${suffix}，请检查知识库 ID 与检索参数`
    case 'rate_limited':
      return '供应商请求限流，请稍后重试'
    case 'provider_unavailable':
      return '供应商服务暂不可用，请稍后重试'
    case 'provider_rejected':
      return `供应商拒绝请求${suffix}`
    case 'unknown':
      return `供应商返回未知错误${suffix}`
    default:
      return kbTestResult?.error || '未知错误'
  }
}

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



export default function SystemManagement({ sectionId }) {
  const {
    rules, rulesLoading, rulesError, modelConfig, modelsLoading, modelsError, modelActiveConfig, effectiveConfig, effectiveLoading, effectiveError, loadEffective, ratecard,
    dslRules, dslLoading, dslError, dslUnsaved, dslPending, dslVersion, templates, templatesLoading, templatesError, prompts, setPrompts,
    kbConfig, kbLoading, kbError,
    testResults, testResultsLoading, testResultsError, testResultsMoreLoading, testResultsHasMore,
    actionLoading,
    actions,
  } = useSystemManagement()

  const [dialog, setDialog] = useState(null) // 'prompt' | null
  const [promptTab, setPromptTab] = useState('assessment')
  const [promptResult, setPromptResult] = useState(null)
  const toast = useToast()
  const [editingModel, setEditingModel] = useState(null)
  const [extInput, setExtInput] = useState('')
  const [kbTestingProfileId, setKbTestingProfileId] = useState('')
  const [confirmClearKbKey, setConfirmClearKbKey] = useState(false)
  const [modelSaveResult, setModelSaveResult] = useState(null)
  const [modelDirty, setModelDirty] = useState(false)
  const [confirmDiscardModel, setConfirmDiscardModel] = useState(false)
  const [modelSaveError, setModelSaveError] = useState(null)
  const [modelSaving, setModelSaving] = useState(false)
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
  const handleSaveKbDraft = async () => {
    const result = await actions.saveKbDraft()
    if (result.success) {
      toast.success('知识库配置草稿已保存')
    } else {
      toast.error(result.error || '知识库配置草稿保存失败')
    }
    // DEF-2026-09-02-001：占位形态知识库 ID 仅警告不阻断（后端已附带 warnings）
    if (result.success && Array.isArray(result.data?.warnings) && result.data.warnings.length) {
      result.data.warnings.forEach((warning) => {
        toast.warn(warning.message || '知识库 ID 形似占位值，请确认已替换为真实 ID')
      })
    }
  }

  const handleActivateKb = async () => {
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
    if (result.success) {
      toast.success('知识库配置已生效')
    } else {
      toast.error(gateMessage || result.error || '知识库配置生效失败')
    }
  }

  const handleClearKbKey = async () => {
    const result = await actions.clearKbApiKeyDraft()
    setConfirmClearKbKey(false)
    if (result.success) {
      toast.success('已清除草稿中保存的 API Key；如需影响正在使用的配置，请重新测试并生效')
    } else {
      toast.error(result.error || '密钥清除失败')
    }
  }

  const handleTestKbProfile = async (profileId) => {
    setKbTestingProfileId(profileId)
    try {
      const result = (await actions.testKbConnectivity(profileId)) || { ok: false, error: '连通性测试未返回结果' }
      if (result.ok) {
        const detail = [
          result.model && `模型 ${result.model}`,
          result.knowledgeId && `知识库 ${result.knowledgeId}`,
          result.latencyMs !== undefined && `延迟 ${result.latencyMs}ms`,
          result.retrievalTriggered !== undefined && `检索触发 ${result.retrievalTriggered ? '是' : '否'}`,
          result.testedSource && `凭证来源 ${result.testedSource === 'draft_store' ? '草稿存储' : result.testedSource === 'environment' ? '环境变量' : '请求参数'}`,
        ].filter(Boolean).join(' · ')
        const message = result.warning === 'retrieval_empty' ? '连通性测试通过，但未检索到文档' : '连通性测试通过'
        toast.success(message, detail ? { detail } : undefined)
      } else {
        toast.error('连通性测试未通过', { detail: [describeKbTestFailure(result), result.status && `HTTP ${result.status}`].filter(Boolean).join(' · ') })
      }
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
      <SystemManagementNav activeSection={activeSection} ruleCount={rules.length} />

      <div className="min-w-0 pt-5">
        {activeSectionId === 'rules' && (
          <CodeRulesSection rules={rules} loading={rulesLoading} error={rulesError} onRetry={actions.loadRules} actions={actions} actionLoading={actionLoading} />
        )}

        {activeSectionId === 'model' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">修改后先保存草稿再生效</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSaveModelDraft} disabled={actionLoading.saveModelDraft || actionLoading.activateModel || modelsLoading || effectiveLoading || Boolean(modelsError || effectiveError)}>
                {actionLoading.saveModelDraft ? '...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri btn-sm" onClick={handleActivateModel} disabled={actionLoading.activateModel || actionLoading.saveModelDraft || modelsLoading || effectiveLoading || Boolean(modelsError || effectiveError)}>
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

            <ModelConfigurationSection
              providers={draftProviders} effectiveProviders={effectiveProvidersById} credentials={effectiveConfig?.credentials}
              loading={modelsLoading || effectiveLoading} error={modelsError || effectiveError} onRetry={() => Promise.all([actions.loadModels(), loadEffective()])}
              onCreateProvider={openCreateProvider} onEditProvider={openEditProvider} formatTime={formatRelativeTime}
              scenarios={MODEL_CARDS.map((card) => {
                const scenarioKey = SCENARIO_KEY_BY_CONFIG[card.key]
                const scenario = effectiveConfig?.scenarios?.find((entry) => entry.key === scenarioKey) || null
                const activeCfg = modelActiveConfig?.[card.key] || null
                const draftCfg = modelConfig[card.key] || {}
                return { ...card, id: card.key, scenarioKey, scenario, diffs: buildScenarioDiff(draftCfg, activeCfg),
                  wired: scenario ? scenario.wired : card.key !== 'kimiGeneration',
                  resolvedModel: scenario?.resolvedModel || activeCfg?.model || draftCfg.model || '—',
                  sourceLabel: (SOURCE_BADGE[scenario?.source] || SOURCE_BADGE.binding).label,
                  paramSummary: buildParamSummary(card.key, activeCfg || draftCfg),
                  verifying: Boolean(actionLoading[`testScenario:${scenarioKey}`]),
                }
              })}
              onEditScenario={(row) => { modelSnapshotRef.current = JSON.parse(JSON.stringify(modelConfig)); setModelDirty(false); setModelSaveError(null); setKeyInput(''); setKeyTestResult(null); setEditingModel(row.key) }}
              onVerifyScenario={async (row) => {
                const result = await actions.testScenario(row.scenarioKey)
                if (result.success) {
                  const data = result.data || {}
                  const detail = [data.resolvedModel && `生效模型: ${data.resolvedModel}`, data.respondedModel && `响应模型: ${data.respondedModel}`, data.latencyMs != null && `延迟: ${data.latencyMs}ms`].filter(Boolean).join(' · ')
                  if (data.modelMatch === false) toast.warn('验证通过，但模型名不匹配', { detail, duration: 6000 })
                  else toast.success(`${row.title} 验证通过`, { detail, duration: 5000 })
                } else toast.error(result.error || `${row.title} 验证失败`)
              }}
            />
          </div>
        )}


        {activeSectionId === 'kb' && (
          <div>
            <div className="sys-toolbar">
              <span className="meta">智谱知识库接入与连通性验证</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleSaveKbDraft} disabled={actionLoading.saveKbDraft || kbLoading || Boolean(kbError)}>
                {actionLoading.saveKbDraft ? '保存中...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri btn-sm" onClick={handleActivateKb} disabled={actionLoading.activateKbConfig || kbLoading || Boolean(kbError)}>
                {actionLoading.activateKbConfig ? '...' : '⌁ 生效配置'}
              </button>
            </div>

            <KnowledgeBaseSection config={kbConfig} loading={kbLoading} error={kbError}
              busy={Boolean(kbLoading || actionLoading.saveKbDraft || actionLoading.activateKbConfig || kbTestingProfileId)}
              testingProfileId={kbTestingProfileId} onRetry={actions.loadKbConfig} onChange={actions.updateKbConfig}
              onTest={handleTestKbProfile} onClearKey={() => setConfirmClearKbKey(true)} />
          </div>
        )}

        {activeSectionId === 'kbRetrieval' && (
          <KnowledgeRetrievalDiagnosePanel />
        )}

        {activeSectionId === 'rate' && (
          <RateCardSection rates={ratecard} />
        )}

        {activeSectionId === 'dsl' && (
          <DslRulesSection rules={dslRules} loading={dslLoading} error={dslError} unsaved={dslUnsaved} pending={dslPending} version={dslVersion} actions={actions} actionLoading={actionLoading} />
        )}

        {activeSectionId === 'tpl' && (
          <TemplatesSection templates={templates} loading={templatesLoading} error={templatesError} onRetry={actions.loadTemplates} />
        )}

        {activeSectionId === 'testResults' && <TestResultsSection rows={testResults} loading={testResultsLoading} error={testResultsError}
          moreLoading={testResultsMoreLoading} hasMore={testResultsHasMore} onRetry={() => actions.loadTestResults()} onLoadMore={() => actions.loadTestResults({ append: true })}
          onCreate={actions.createTestResult} onDelete={actions.deleteTestResult} />}

        {activeSectionId === 'sessions' && (
          <AiSessionAuditPanel />
        )}

        {activeSectionId === 'memory' && (
          <MemoryManagementPanel />
        )}

        {activeSectionId === 'tools' && (
          <AiToolInventoryPanel />
        )}

        {activeSectionId === 'stateMachines' && (
          <StateMachinesSection />
        )}
      </div>

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
