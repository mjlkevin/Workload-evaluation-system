import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapList, unwrapSingle } from '../api/utils.js'

const DEFAULT_RULES = [
  { module: '总方案', code: 'GL', prefix: 'GL-', format: 'GL-NNNNN', example: 'GL-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
  { module: '需求', code: 'RQ', prefix: 'RQ-', format: 'RQ-NNNNN', example: 'RQ-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
  { module: '实施评估', code: 'IA', prefix: 'IA-', format: 'IA-NNNNN', example: 'IA-04003', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
  { module: '开发评估', code: 'DV', prefix: 'DV-', format: 'DV-NNNNN', example: 'DV-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
  { module: '资源成本', code: 'RS', prefix: 'RS-', format: 'RS-NNNNN', example: 'RS-04001', status: 'active', activatedAt: '2026-01-15T08:00:00Z' },
  { module: '评审', code: 'RV', prefix: 'RV-', format: 'RV-NNNNN', example: 'RV-04001', status: 'draft', activatedAt: null },
]

const DEFAULT_MODELS = [
  { name: 'KIMI 评估', status: 'online', endpoint: 'https://api.moonshot.cn/v1/chat/completions', profile: 'default-v1', temp: '0.2', tokens: '8192', desc: '用于实施评估与开发评估的自动打标与摘要生成。' },
  { name: '文件解析', status: 'online', endpoint: 'https://api.moonshot.cn/v1/files', profile: 'default-v1', temp: '0.1', tokens: '4096', desc: '用于 Excel/Word/PDF 的结构化提取与内容解析。' },
  { name: '生成模型', status: 'offline', endpoint: 'https://api.moonshot.cn/v1/generate', profile: 'generate-v1', temp: '0.3', tokens: '8192', desc: '用于方案生成、五段叙事与 SOW 草案自动撰写。' },
]

const DEFAULT_RATECARD = [
  { role: '实施顾问', price: '¥3,200 CNY' },
  { role: '架构师', price: '¥4,000 CNY' },
  { role: '项目经理', price: '¥4,000 CNY' },
  { role: '测试工程师', price: '¥2,800 CNY' },
  { role: '开发工程师', price: '¥3,500 CNY' },
]

const DEFAULT_DSL_RULES = [
  { id: 'R1', type: 'blocking', message: '需求条目必须关联至少一个业务模块', enabled: true },
  { id: 'R2', type: 'blocking', message: '评估人天不得低于基准值的 80%', enabled: true },
  { id: 'R3', type: 'warning', message: '多组织推广估算应提供相似度依据', enabled: true },
  { id: 'R4', type: 'warning', message: '资源成本与实施评估差额超过 10% 需说明', enabled: false },
  { id: 'R5', type: 'blocking', message: '评审通过前必须完成全部 checklist', enabled: true },
]

const DEFAULT_TEMPLATES = [
  { id: 'T1', name: '实施评估标准版', desc: '适用于中大型离散制造项目，含 120+ SKU 条目。', tags: ['制造', '标准实施'] },
  { id: 'T2', name: '快速交付轻量版', desc: '适用于 200 人以下组织，快速上线场景。', tags: ['轻量', '快速交付'] },
  { id: 'T3', name: '定制开发扩展版', desc: '含接口开发、报表定制、第三方集成评估。', tags: ['定制', '扩展'] },
]

const DEFAULT_PROMPTS = {
  assessment: '你是一位资深 ERP 实施评估专家。请根据客户提供的需求访谈纪要，提取关键业务模块、评估复杂度并输出 SKU 主表。',
  parse: '你是一位文档解析专家。请从上传的 Excel/Word/PDF 中提取结构化需求条目，识别业务模块、约束条件与关键干系人。',
  generate: '你是一位技术方案生成专家。请基于已确认的 SKU 主表与资源成本，生成五段叙事方案与 SOW 草案。',
}

function mapRules(raw) {
  return raw.map((r) => ({
    id: r.id || r.ruleId,
    module: r.module || r.moduleName || '',
    code: r.code || r.prefix || '',
    prefix: r.prefix || r.codePrefix || '',
    format: r.format || r.codePattern || '',
    example: r.example || r.codeExample || '',
    status: r.status || (r.active ? 'active' : 'draft'),
    activatedAt: r.activatedAt || '',
  }))
}

function mapDslRules(raw) {
  return raw.map((r) => ({
    id: r.id || r.ruleId || '',
    type: r.type || r.logic || (r.blocking ? 'blocking' : 'warning'),
    message: r.message || r.description || '',
    enabled: Boolean(r.enabled ?? r.active ?? true),
  }))
}

function mapTemplates(raw) {
  return raw.map((t) => ({
    id: t.id || t.templateId || '',
    name: t.name || t.templateName || '',
    desc: t.description || t.desc || '',
    tags: Array.isArray(t.tags) ? t.tags : [],
  }))
}

function mergeFallback(fb) {
  return {
    rules: fb?.rules || DEFAULT_RULES,
    models: fb?.models || DEFAULT_MODELS,
    ratecard: fb?.ratecard || DEFAULT_RATECARD,
    dslRules: fb?.dslRules || DEFAULT_DSL_RULES,
    templates: fb?.templates || DEFAULT_TEMPLATES,
    prompts: fb?.prompts || DEFAULT_PROMPTS,
  }
}

export default function useSystemManagement({
  enabled = isAuthenticated(),
  fallbackData = null,
} = {}) {
  const fallback = useMemo(() => mergeFallback(fallbackData), [fallbackData])

  const [rules, setRules] = useState(fallback.rules)
  const [rulesLoading, setRulesLoading] = useState(false)

  const [models, setModels] = useState(fallback.models)
  const [apiKey, setApiKey] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)

  const [ratecard, setRatecard] = useState(fallback.ratecard)

  const [dslRules, setDslRules] = useState(fallback.dslRules)
  const [dslLoading, setDslLoading] = useState(false)

  const [templates, setTemplates] = useState(fallback.templates)
  const [templatesLoading, setTemplatesLoading] = useState(false)

  const [prompts, setPrompts] = useState(fallback.prompts)

  const [actionLoading, setActionLoading] = useState({})

  const withAction = useCallback(async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      await task()
      return { success: true, error: null }
    } catch (error) {
      return { success: false, error: error?.message || '操作失败' }
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  // --- Rules ---
  const loadRules = useCallback(async () => {
    if (!enabled) return
    setRulesLoading(true)
    try {
      const payload = await apiClient.get('/system/version-code-rules')
      const mapped = mapRules(unwrapList(payload))
      setRules(mapped)
    } catch (_) { /* keep fallback */ }
    finally { setRulesLoading(false) }
  }, [enabled])

  const configureRule = useCallback((ruleId) => withAction(`configure:${ruleId}`, async () => {
    if (enabled) await apiClient.patch(`/system/version-code-rules/${ruleId}/config`, {})
    alert('配置已保存')
  }), [enabled, withAction])

  const activateRule = useCallback((ruleId) => withAction(`activate:${ruleId}`, async () => {
    if (enabled) await apiClient.post(`/system/version-code-rules/${ruleId}/activate`)
    setRules((prev) => prev.map((r) => r.id === ruleId || r.code === ruleId ? { ...r, status: 'active', activatedAt: new Date().toISOString() } : r))
  }), [enabled, withAction])

  const disableRule = useCallback((ruleId) => withAction(`disable:${ruleId}`, async () => {
    if (enabled) await apiClient.post(`/system/version-code-rules/${ruleId}/disable`)
    setRules((prev) => prev.map((r) => r.id === ruleId || r.code === ruleId ? { ...r, status: 'draft', activatedAt: null } : r))
  }), [enabled, withAction])

  // --- Models ---
  const loadModels = useCallback(async () => {
    if (!enabled) return
    setModelsLoading(true)
    try {
      const payload = await apiClient.get('/system/requirement-settings')
      const data = unwrapSingle(payload)
      if (data) {
        if (Array.isArray(data.models)) setModels(data.models)
        if (data.apiKey) setApiKey(data.apiKey)
      }
    } catch (_) { /* keep fallback */ }
    finally { setModelsLoading(false) }
  }, [enabled])

  const saveModelDraft = useCallback(() => withAction('saveModelDraft', async () => {
    if (enabled) await apiClient.patch('/system/requirement-settings/draft', { models, apiKey })
    alert('草稿已保存')
  }), [enabled, models, apiKey, withAction])

  const activateModel = useCallback(() => withAction('activateModel', async () => {
    if (enabled) await apiClient.post('/system/requirement-settings/activate')
    alert('配置已生效')
  }), [enabled, withAction])

  const testApiKey = useCallback((key) => withAction('testApiKey', async () => {
    if (enabled) {
      await apiClient.post('/system/requirement-settings/kimi-api-key/test', { apiKey: key || apiKey })
    }
    alert('连接测试通过')
  }), [enabled, apiKey, withAction])

  // --- DSL ---
  const loadDsl = useCallback(async () => {
    if (!enabled) return
    setDslLoading(true)
    try {
      const payload = await apiClient.get('/system/implementation-dependency-rules')
      const mapped = mapDslRules(unwrapList(payload))
      setDslRules(mapped)
    } catch (_) { /* keep fallback */ }
    finally { setDslLoading(false) }
  }, [enabled])

  const toggleDsl = useCallback((id) => {
    setDslRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
  }, [])

  const saveDslDraft = useCallback(() => withAction('saveDslDraft', async () => {
    if (enabled) await apiClient.patch('/system/implementation-dependency-rules/draft', { rules: dslRules })
    alert('DSL 草稿已保存')
  }), [enabled, dslRules, withAction])

  const activateDsl = useCallback(() => withAction('activateDsl', async () => {
    if (enabled) await apiClient.post('/system/implementation-dependency-rules/activate')
    alert('DSL 规则已生效')
  }), [enabled, withAction])

  // --- Templates ---
  const loadTemplates = useCallback(async () => {
    if (!enabled) return
    setTemplatesLoading(true)
    try {
      const payload = await apiClient.get('/templates')
      const mapped = mapTemplates(unwrapList(payload))
      setTemplates(mapped)
    } catch (_) { /* keep fallback */ }
    finally { setTemplatesLoading(false) }
  }, [enabled])

  const useTemplate = useCallback((templateName) => {
    alert(`已使用模板「${templateName}」`)
  }, [])

  const importTemplate = useCallback((formData) => withAction('importTemplate', async () => {
    if (enabled) {
      await apiClient.upload('/templates/import-json', formData)
    }
    await loadTemplates()
  }), [enabled, loadTemplates, withAction])

  const testPrompt = useCallback((promptText) => withAction('testPrompt', async () => {
    const payload = await apiClient.post('/ai/chat', {
      messages: [{ role: 'user', content: promptText }],
    })
    return payload?.data || payload
  }), [enabled, withAction])

  const savePrompts = useCallback(() => withAction('savePrompts', async () => {
    if (enabled) await apiClient.patch('/system/requirement-settings/draft', { prompts })
  }), [enabled, prompts, withAction])

  // --- Initial load ---
  useEffect(() => {
    if (!enabled) return
    loadRules()
    loadModels()
    loadDsl()
    loadTemplates()
  }, [enabled, loadRules, loadModels, loadDsl, loadTemplates])

  return {
    rules,
    rulesLoading,
    models,
    modelsLoading,
    apiKey,
    setApiKey,
    ratecard,
    dslRules,
    dslLoading,
    templates,
    templatesLoading,
    prompts,
    setPrompts,
    actionLoading,
    actions: {
      configureRule,
      activateRule,
      disableRule,
      saveModelDraft,
      activateModel,
      testApiKey,
      toggleDsl,
      saveDslDraft,
      activateDsl,
      useTemplate,
      importTemplate,
      testPrompt,
      savePrompts,
    },
  }
}
