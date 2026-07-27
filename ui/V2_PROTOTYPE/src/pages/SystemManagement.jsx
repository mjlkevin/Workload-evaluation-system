import React, { useEffect, useRef, useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
import { getSystemManagementSectionById } from '../config/systemManagementSections.js'
import useSystemManagement from '../hooks/useSystemManagement.js'

const PROMPT_TABS = [
  { key: 'assessment', label: '评估提示词' },
  { key: 'parse', label: '文件解析提示词' },
  { key: 'generate', label: '生成提示词' },
]

const MODEL_CARDS = [
  {
    key: 'kimiEvaluation',
    title: 'KIMI 评估',
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
    title: '生成模型',
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

export default function SystemManagement({ sectionId }) {
  const {
    rules, modelConfig, ratecard,
    dslRules, templates, prompts, setPrompts,
    kbConfig, kbLoading,
    testResults, testResultsLoading,
    actionLoading,
    actions,
  } = useSystemManagement()

  const [tab, setTab] = useState('rules')
  const [dialog, setDialog] = useState(null) // 'prompt' | null
  const [promptTab, setPromptTab] = useState('assessment')
  const [promptResult, setPromptResult] = useState(null)
  const [selectedRuleCode, setSelectedRuleCode] = useState('')
  const [ruleConfigForm, setRuleConfigForm] = useState({ prefix: '', format: '' })
  const [kbTestResult, setKbTestResult] = useState(null)
  const [kbSaveResult, setKbSaveResult] = useState(null)
  const [editingModel, setEditingModel] = useState(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [extInput, setExtInput] = useState('')
  const [kbTesting, setKbTesting] = useState(false)
  const [testResultDialog, setTestResultDialog] = useState(false)
  const [testResultForm, setTestResultForm] = useState({ executorName: '', environment: '', account: '', testCaseKey: '', resultStatus: 'passed', screenshotUrl: '', notes: '' })
  const [modelSaveResult, setModelSaveResult] = useState(null)
  const [modelDirty, setModelDirty] = useState(false)
  const [confirmDiscardModel, setConfirmDiscardModel] = useState(false)
  const [modelSaveError, setModelSaveError] = useState(null)
  const [modelSaving, setModelSaving] = useState(false)
  const modelSnapshotRef = useRef(null)

  const tabs = [
    { id: 'rules', label: '编码规则', count: rules.length },
    { id: 'model', label: '模型配置' },
    { id: 'kb', label: '知识库' },
    { id: 'rate', label: 'RateCard' },
    { id: 'dsl', label: 'DSL 规则集' },
    { id: 'tpl', label: '模板' },
    { id: 'testResults', label: '测试结果' },
  ]
  const dedicatedSection = sectionId ? getSystemManagementSectionById(sectionId) : null
  const activeSectionId = dedicatedSection?.id || tab
  const selectedRule = rules.find((rule) => rule.code === selectedRuleCode) || rules[0]
  const selectedRuleId = selectedRule?.id || selectedRule?.code || ''

  useEffect(() => {
    if (!selectedRuleCode && rules[0]?.code) setSelectedRuleCode(rules[0].code)
  }, [rules, selectedRuleCode])

  const openRuleConfig = () => {
    setRuleConfigForm({
      prefix: selectedRule?.prefix || '',
      format: selectedRule?.format || '',
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
    setKbSaveResult(result.success
      ? { ok: true, message: '知识库配置已生效' }
      : { ok: false, message: result.error || '知识库配置生效失败' })
  }

  const handleSaveModelDraft = async () => {
    setModelSaveResult(null)
    const result = await actions.saveModelDraftWithKey(apiKeyInput || undefined)
    setApiKeyInput('')
    setModelSaveResult(result.success
      ? { ok: true, message: '草稿已保存' }
      : { ok: false, message: result.error || '草稿保存失败' })
  }

  const handleActivateModel = async () => {
    setModelSaveResult(null)
    const result = await actions.activateModel()
    setModelSaveResult(result.success
      ? { ok: true, message: '配置已生效' }
      : { ok: false, message: result.error || '配置生效失败' })
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
    } else {
      setModelSaveError(result.error || '保存失败，请重试')
    }
  }

  return (
    <PageShell
      crumb={dedicatedSection
        ? [{ label: '工作台', to: '/' }, { label: dedicatedSection.label }]
        : '工作台 / 系统管理'}
      title={dedicatedSection?.label || '系统管理'}
      subtitle={dedicatedSection?.subtitle || '编码规则 / 模型配置 / 知识库 / RateCard / DSL'}
      actions={[
        <button type="button"
          key="prompt"
          className="btn btn-ghost"
          style={{ height: 32, fontSize: 12, padding: '0 12px' }}
          onClick={() => setDialog('prompt')}
        >
          ✎ 提示词
        </button>,
      ]}
    >
      {!dedicatedSection && (
        <div className="system-tabs" role="tablist" aria-label="系统管理配置分类">
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                type="button"
                key={t.id}
                role="tab"
                aria-selected={active}
                className={active ? 'system-tab on' : 'system-tab'}
                onClick={() => setTab(t.id)}
              >
                <span>{t.label}</span>
                {t.count ? <span className="ct">{t.count}</span> : null}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ padding: '18px 24px' }}>
        {activeSectionId === 'rules' && (
          <div className="section system-card" style={{ margin: 0 }}>
            <div className="hd">
              <span>版本号编码规则</span>
              <span className="bdg ci" style={{ fontSize: 10, padding: '1px 6px' }}><span className="dot" />当前生效 v3</span>
              <div className="right">
                <button type="button" className="btn btn-out" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={openRuleConfig}>
                  配置
                </button>
                <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.activateRule(selectedRuleId)}>
                  ⌁ 生效
                </button>
                <button type="button" className="btn btn-dan" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.disableRule(selectedRuleId)}>
                  禁用
                </button>
              </div>
            </div>
            <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              <thead>
                <tr>
                  <th>模块</th>
                  <th>编码</th>
                  <th>前缀</th>
                  <th>格式</th>
                  <th>示例</th>
                  <th>状态</th>
                  <th>生效时间</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => {
                  const selected = selectedRule?.code === r.code
                  return (
                  <tr
                    key={i}
                    className={selected ? 'row-selected' : ''}
                    onClick={() => setSelectedRuleCode(r.code)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedRuleCode(r.code) }}
                    aria-selected={selected}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{r.module}</td>
                    <td className="mono">{r.code}</td>
                    <td className="mono">{r.prefix}</td>
                    <td className="mono">{r.format}</td>
                    <td className="mono">{r.example}</td>
                    <td>
                      <span className={`bdg ${r.status === 'active' ? 'ci' : 'draft'}`} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                        <span className="dot" />
                        {r.status === 'active' ? '生效中' : '已禁用'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {r.activatedAt ? r.activatedAt.replace('T', ' ').replace('Z', '') : '—'}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeSectionId === 'model' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={handleSaveModelDraft} disabled={actionLoading.saveModelDraft}>
                {actionLoading.saveModelDraft ? '...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={handleActivateModel} disabled={actionLoading.activateModel}>
                {actionLoading.activateModel ? '...' : '⌁ 生效配置'}
              </button>
            </div>

            {modelSaveResult && (
              <div
                role="status"
                style={{
                  background: modelSaveResult.ok ? 'var(--ok-soft)' : 'var(--err-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  color: modelSaveResult.ok ? 'var(--ok)' : 'var(--err)',
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 12,
                  padding: '10px 14px',
                }}
              >
                {modelSaveResult.ok ? '✓ ' : '✗ '}{modelSaveResult.message}
              </div>
            )}
            <div className="grid-3-eq" style={{ gap: 16 }}>
              {MODEL_CARDS.map((card) => {
                const cfg = modelConfig[card.key] || {}
                return (
                  <div
                    key={card.key}
                    style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16 }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {card.title}
                      <span
                        className="bdg"
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          background: cfg.enabled ? 'var(--ok-soft)' : 'var(--err-soft)',
                          color: cfg.enabled ? 'var(--ok)' : 'var(--err)',
                        }}
                      >
                        <span className="dot" style={{ background: cfg.enabled ? 'var(--ok)' : 'var(--err)' }} />
                        {cfg.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                    <div className="grid-2-eq" style={{ marginTop: 10 }}>
                      {card.summaryFields.map((f) => {
                        let val = cfg[f.path]
                        if (f.type === 'bool') val = val ? '是' : '否'
                        return (
                          <div key={f.path} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label
                              style={{
                                fontSize: 11,
                                color: 'var(--ink-3)',
                                fontFamily: 'var(--font-mono)',
                                textTransform: 'uppercase',
                                letterSpacing: '.06em',
                                fontWeight: 700,
                              }}
                            >
                              {f.label}
                            </label>
                            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{String(val ?? '—')}</div>
                          </div>
                        )
                      })}
                    </div>
                    <div
                      style={{
                        background: 'var(--brand-soft)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-md)',
                        padding: '12px 14px',
                        marginTop: 14,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 12,
                        color: 'var(--ink-2)',
                      }}
                    >
                      <span style={{ flex: 1 }}>{card.desc}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px', height: 30 }} onClick={() => { modelSnapshotRef.current = JSON.parse(JSON.stringify(modelConfig)); setModelDirty(false); setModelSaveError(null); setEditingModel(card.key) }}>
                          编辑
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px', height: 30 }} onClick={() => actions.testApiKey()}>
                          {actionLoading.testApiKey ? '...' : '测试连通性'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16, marginTop: 16 }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>API Key 管理</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    color: 'var(--ink)',
                    background: 'var(--bg-soft)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    letterSpacing: '.04em',
                  }}
                >
                  {modelConfig.kimiCredentials.hint
                    ? `已配置 ${modelConfig.kimiCredentials.hint}`
                    : modelConfig.kimiCredentials.resolvedFrom === 'env'
                      ? '来自环境变量 KIMI_API_KEY'
                      : '（未配置）'}
                </span>
                <input
                  className="input"
                  type="password"
                  style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                  placeholder="输入新 API Key（留空则不修改）"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.testApiKey(apiKeyInput)}>
                  测试连接
                </button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => { setApiKeyInput(''); actions.clearApiKeyDraft() }}>
                  清除密钥
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
                {modelConfig.kimiCredentials.resolvedFrom === 'store' ? '当前使用仓库存储密钥'
                  : modelConfig.kimiCredentials.resolvedFrom === 'env' ? '当前使用环境变量'
                  : '未配置可用密钥，保存草稿后生效'}
              </div>
            </div>
          </div>
        )}


        {activeSectionId === 'kb' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={handleSaveKbDraft} disabled={actionLoading.saveKbDraft || kbLoading}>
                {actionLoading.saveKbDraft ? '保存中...' : '保存草稿'}
              </button>
              <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={handleActivateKb} disabled={actionLoading.activateKbConfig || kbLoading}>
                {actionLoading.activateKbConfig ? '...' : '⌁ 生效配置'}
              </button>
            </div>

            {kbSaveResult && (
              <div
                role="status"
                style={{
                  background: kbSaveResult.ok ? 'var(--ok-soft)' : 'var(--err-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  color: kbSaveResult.ok ? 'var(--ok)' : 'var(--err)',
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 16,
                  padding: '10px 14px',
                }}
              >
                {kbSaveResult.ok ? '✓ ' : '✗ '}{kbSaveResult.message}
              </div>
            )}

            {/* 状态卡片 */}
            <div style={{
              background: kbConfig.resolvedFrom !== 'none' ? 'var(--ok-soft)' : 'var(--warn-soft)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
            }}>
              <span style={{ fontSize: 16 }}>{kbConfig.resolvedFrom !== 'none' ? '✓' : '⚠'}</span>
              <div>
                <div style={{ fontWeight: 700, color: kbConfig.resolvedFrom !== 'none' ? 'var(--ok)' : 'var(--warn-ink)' }}>
                  {kbConfig.resolvedFrom === 'store' ? '知识库已配置（来自存储）' : kbConfig.resolvedFrom === 'env' ? '知识库已配置（来自环境变量）' : '知识库未配置'}
                </div>
                <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>
                  {kbConfig.resolvedFrom !== 'none' ? 'AI 工作台可检索真实知识库文档' : '请在下方填写 API Key 和知识库 ID，保存草稿后点击“生效配置”'}
                </div>
              </div>
            </div>

            {/* 配置表单 */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>智谱知识库配置</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* API Key */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                    API Key
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {kbConfig.apiHint && !kbConfig.apiKey && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)', background: 'var(--bg-soft)', padding: '5px 8px', borderRadius: 4 }}>
                        {kbConfig.apiHint}
                      </span>
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
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 28 }} onClick={() => actions.updateKbConfig({ apiKey: '' })}>
                        清除
                      </button>
                    )}
                  </div>
                </div>

                {/* Knowledge ID */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                    知识库 ID
                  </label>
                  <input
                    className="input"
                    style={{ maxWidth: 400 }}
                    placeholder="输入智谱知识库 ID"
                    value={kbConfig.knowledgeId}
                    onChange={(e) => actions.updateKbConfig({ knowledgeId: e.target.value })}
                  />
                </div>

                {/* Model */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 180 }}>
                    <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                      模型
                    </label>
                    <input
                      className="input"
                      style={{ maxWidth: 200 }}
                      value={kbConfig.model}
                      onChange={(e) => actions.updateKbConfig({ model: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2, minWidth: 240 }}>
                    <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                      API Base URL
                    </label>
                    <input
                      className="input"
                      value={kbConfig.apiBaseUrl}
                      onChange={(e) => actions.updateKbConfig({ apiBaseUrl: e.target.value })}
                    />
                  </div>
                </div>

                {/* 连通性测试 */}
                <div style={{
                  background: 'var(--brand-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 4,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>
                    测试知识库连通性，将使用当前填写的凭证调用智谱 API 进行验证。
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '6px 14px', height: 32, whiteSpace: 'nowrap' }}
                    disabled={kbTesting || kbLoading}
                    onClick={async () => {
                      setKbTesting(true)
                      setKbTestResult(null)
                      try {
                        const result = await actions.testKbConnectivity()
                        setKbTestResult(result || { ok: false, error: '连通性测试未返回结果' })
                      } finally {
                        setKbTesting(false)
                      }
                    }}
                  >
                    {kbTesting ? '测试中...' : '测试连通性'}
                  </button>
                </div>

                {/* 测试结果 */}
                {kbTestResult && (
                  <div
                    role={kbTestResult.ok ? 'status' : 'alert'}
                    style={{
                    background: kbTestResult.ok ? 'var(--ok-soft)' : 'var(--err-soft)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    padding: '12px 14px',
                    fontSize: 12,
                  }}>
                    <div style={{ fontWeight: 700, color: kbTestResult.ok ? 'var(--ok)' : 'var(--err)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{kbTestResult.ok ? '✓' : '✗'}</span>
                      <span>{kbTestResult.ok ? '连通性测试通过' : '连通性测试失败'}</span>
                    </div>
                    {kbTestResult.ok ? (
                      <div>
                        {kbTestResult.warning === 'retrieval_empty' && (
                          <div style={{ color: 'var(--warn-ink)', marginBottom: 8 }}>
                            连接成功，但固定测试语句未检索到文档
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', color: 'var(--ink-2)' }}>
                          {kbTestResult.model && <div><span style={{ color: 'var(--ink-3)', fontSize: 11 }}>模型</span><br/><span style={{ fontFamily: 'var(--font-mono)' }}>{kbTestResult.model}</span></div>}
                          {kbTestResult.knowledgeId && <div><span style={{ color: 'var(--ink-3)', fontSize: 11 }}>知识库 ID</span><br/><span style={{ fontFamily: 'var(--font-mono)' }}>{kbTestResult.knowledgeId}</span></div>}
                          {kbTestResult.latencyMs !== undefined && <div><span style={{ color: 'var(--ink-3)', fontSize: 11 }}>延迟</span><br/><span style={{ fontFamily: 'var(--font-mono)' }}>{kbTestResult.latencyMs}ms</span></div>}
                          {kbTestResult.retrievalTriggered !== undefined && <div><span style={{ color: 'var(--ink-3)', fontSize: 11 }}>检索触发</span><br/><span>{kbTestResult.retrievalTriggered ? '是' : '否'}</span></div>}
                          {kbTestResult.testedSource && <div><span style={{ color: 'var(--ink-3)', fontSize: 11 }}>凭证来源</span><br/><span>{kbTestResult.testedSource === 'draft_store' ? '草稿存储' : kbTestResult.testedSource === 'environment' ? '环境变量' : '请求参数'}</span></div>}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ color: 'var(--err)', fontWeight: 600 }}>{kbTestResult.error || '未知错误'}</div>
                        {kbTestResult.status && <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 4, fontFamily: 'var(--font-mono)' }}>HTTP {kbTestResult.status}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeSectionId === 'rate' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>RateCard · 当前生效</span>
              <div className="right">
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }}>
                  编辑
                </button>
              </div>
            </div>
            <div className="bd">
              <div className="grid-3-eq">
                {ratecard.map((r) => (
                  <div
                    key={r.role}
                    style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{r.role}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{r.price}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeSectionId === 'dsl' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>DSL 规则集</span>
              <div className="right">
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.saveDslDraft()}>
                  保存草稿
                </button>
                <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => actions.activateDsl()}>
                  ⌁ 生效
                </button>
              </div>
            </div>
            <div className="bd" style={{ padding: 0 }}>
              <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>启用</th>
                    <th>规则 ID</th>
                    <th>类型</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {dslRules.map((r) => (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={r.enabled} onChange={() => actions.toggleDsl(r.id)} />
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{r.id}</td>
                      <td>
                        <span
                          className="bdg"
                          style={{
                            fontSize: 10.5,
                            padding: '1px 6px',
                            background: r.type === 'blocking' ? 'var(--err-soft)' : 'var(--warn-soft)',
                            color: r.type === 'blocking' ? 'var(--err)' : 'var(--warn-ink)',
                          }}
                        >
                          {r.type === 'blocking' ? '阻断' : '警告'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSectionId === 'tpl' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>模板管理</span>
            </div>
            <div className="bd">
              <div className="grid-3-eq">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      background: 'var(--bg-soft)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-lg)',
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6, flex: 1 }}>{t.desc}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bdg"
                          style={{ fontSize: 10, padding: '1px 6px', background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button type="button"
                      className="btn btn-pri"
                      style={{ height: 30, fontSize: 12, padding: '0 12px', marginTop: 4 }}
                      onClick={() => actions.useTemplate(t.name)}
                    >
                      使用
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeSectionId === 'testResults' && (
          <div className="section" style={{ margin: 0 }}>
            <div className="hd">
              <span>人工测试结果</span>
              <div className="right">
                <button type="button" className="btn btn-pri" style={{ fontSize: 12, padding: '6px 12px', height: 32 }} onClick={() => setTestResultDialog(true)}>+ 新建</button>
              </div>
            </div>
            <div className="bd">
              {testResultsLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>加载中...</div>
              ) : testResults.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>暂无测试结果记录</div>
              ) : (
                <table className="table" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
                  <thead>
                    <tr>
                      <th>用例编号</th>
                      <th>执行人</th>
                      <th>环境</th>
                      <th>账号</th>
                      <th>状态</th>
                      <th>截图</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResults.map((r) => (
                      <tr key={r.manualTestResultId}>
                        <td className="mono" style={{ fontSize: 12 }}>{r.testCaseKey || '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.executorName}</td>
                        <td style={{ fontSize: 12 }}>{r.environment}</td>
                        <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.account || '—'}</td>
                        <td>
                          <span className={`bdg ${r.resultStatus === 'passed' ? 'ci' : r.resultStatus === 'failed' ? 'draft' : ''}`} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                            <span className="dot" />
                            {r.resultStatus === 'passed' ? '通过' : r.resultStatus === 'failed' ? '失败' : r.resultStatus === 'blocked' ? '阻塞' : '跳过'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {r.screenshotUrl ? <a href={r.screenshotUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>查看</a> : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--ink-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || '—'}</td>
                        <td>
                          <button type="button" className="btn btn-dan" style={{ height: 24, fontSize: 11, padding: '0 8px' }} onClick={async () => { if (confirm('确认删除？')) await actions.deleteTestResult(r.harnessRunId, r.manualTestResultId) }}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
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
                  if (result.success) setDialog(null)
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
              value={prompts[promptTab]}
              onChange={(e) =>
                setPrompts((prev) => ({ ...prev, [promptTab]: e.target.value }))
              }
              style={{
                width: '100%',
                minHeight: 200,
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.6,
                outline: 'none',
                resize: 'vertical',
              }}
            />
            {promptResult && (
              <div style={{marginBottom:12,padding:12,background:'var(--bg-soft)',border:'1px solid var(--line)',borderRadius:'var(--r-md)',maxHeight:200,overflowY:'auto'}}>
                <pre style={{margin:0,fontSize:11,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'var(--font-mono)'}}>{JSON.stringify(promptResult, null, 2)}</pre>
              </div>
            )}
            <DialogActions>
              <button type="button" className="btn btn-ghost" style={{ height: 30, fontSize: 12, padding: '0 14px' }} disabled={actionLoading.testPrompt} onClick={async () => {
                const r = await actions.testPrompt(prompts[promptTab])
                if (r) setPromptResult(r)
              }}>
                {actionLoading.testPrompt ? '测试中...' : '测试'}
              </button>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => { setDialog(null); setPromptResult(null) }}>
                取消
              </button>
              <button type="button"
                className="btn btn-pri"
                style={{ height: 30, fontSize: 12, padding: '0 14px' }}
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
            {editingModel === 'kimiEvaluation' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FormRow label="启用" full>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={modelConfig.kimiEvaluation.enabled} onChange={(e) => handleModelConfigChange('kimiEvaluation', { enabled: e.target.checked })} />
                    启用 KIMI 评估模型
                  </label>
                </FormRow>
                <FormRow label="模型标识">
                  <input className="input" value={modelConfig.kimiEvaluation.model} onChange={(e) => handleModelConfigChange('kimiEvaluation', { model: e.target.value })} />
                </FormRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="Temperature">
                    <input className="input" type="number" min="0" max="1" step="0.1" value={modelConfig.kimiEvaluation.temperature} onChange={(e) => handleModelConfigChange('kimiEvaluation', { temperature: Number(e.target.value) })} />
                  </FormRow>
                  <FormRow label="最大 Tokens">
                    <input className="input" type="number" min="256" max="32000" value={modelConfig.kimiEvaluation.maxTokens} onChange={(e) => handleModelConfigChange('kimiEvaluation', { maxTokens: Number(e.target.value) })} />
                  </FormRow>
                </div>
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
                    value={modelConfig.kimiEvaluation.promptTemplate}
                    onChange={(e) => handleModelConfigChange('kimiEvaluation', { promptTemplate: e.target.value })}
                    style={{ width: '100%', minHeight: 120, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, outline: 'none', resize: 'vertical' }}
                  />
                </FormRow>
              </div>
            )}
            {editingModel === 'fileParsing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FormRow label="启用" full>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={modelConfig.fileParsing.enabled} onChange={(e) => handleModelConfigChange('fileParsing', { enabled: e.target.checked })} />
                    启用文件解析模型
                  </label>
                </FormRow>
                <FormRow label="模型标识">
                  <input className="input" value={modelConfig.fileParsing.model} onChange={(e) => handleModelConfigChange('fileParsing', { model: e.target.value })} />
                </FormRow>
                <FormRow label="允许的扩展名">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {(modelConfig.fileParsing.allowedExtensions || []).map((ext) => (
                      <span key={ext} className="bdg" style={{ fontSize: 11, padding: '2px 8px', background: 'var(--brand-soft)', color: 'var(--brand-ink)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {ext}
                        <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => handleModelConfigChange('fileParsing', { allowedExtensions: modelConfig.fileParsing.allowedExtensions.filter((e) => e !== ext) })}>×</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="如 .pdf" value={extInput} onChange={(e) => setExtInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && extInput.trim()) { const v = extInput.trim().startsWith('.') ? extInput.trim() : `.${extInput.trim()}`; handleModelConfigChange('fileParsing', { allowedExtensions: [...new Set([...modelConfig.fileParsing.allowedExtensions, v])] }); setExtInput('') } }} />
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', height: 28 }} onClick={() => { if (extInput.trim()) { const v = extInput.trim().startsWith('.') ? extInput.trim() : `.${extInput.trim()}`; handleModelConfigChange('fileParsing', { allowedExtensions: [...new Set([...modelConfig.fileParsing.allowedExtensions, v])] }); setExtInput('') } }}>添加</button>
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
                <FormRow label="启用" full>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={modelConfig.kimiGeneration.enabled} onChange={(e) => handleModelConfigChange('kimiGeneration', { enabled: e.target.checked })} />
                    启用生成模型
                  </label>
                </FormRow>
                <FormRow label="模型标识">
                  <input className="input" value={modelConfig.kimiGeneration.model} onChange={(e) => handleModelConfigChange('kimiGeneration', { model: e.target.value })} />
                </FormRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormRow label="Temperature">
                    <input className="input" type="number" min="0" max="1" step="0.1" value={modelConfig.kimiGeneration.temperature} onChange={(e) => handleModelConfigChange('kimiGeneration', { temperature: Number(e.target.value) })} />
                  </FormRow>
                  <FormRow label="最大 Tokens">
                    <input className="input" type="number" min="256" max="32000" value={modelConfig.kimiGeneration.maxTokens} onChange={(e) => handleModelConfigChange('kimiGeneration', { maxTokens: Number(e.target.value) })} />
                  </FormRow>
                </div>
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
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={requestCloseModelEdit} disabled={modelSaving}>
                取消
              </button>
              <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={handleModelEditSave} disabled={modelSaving}>
                {modelSaving ? '保存中...' : '确定'}
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

      {/* 新建测试结果 dialog */}
      <Dialog
        open={testResultDialog}
        title="新建人工测试结果"
        onClose={() => setTestResultDialog(false)}
        wide
      >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="执行人 *">
                <input style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }} value={testResultForm.executorName} onChange={(e) => setTestResultForm((f) => ({ ...f, executorName: e.target.value }))} />
              </FormRow>
              <FormRow label="环境 *">
                <input style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }} value={testResultForm.environment} onChange={(e) => setTestResultForm((f) => ({ ...f, environment: e.target.value }))} />
              </FormRow>
              <FormRow label="账号">
                <input style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }} value={testResultForm.account} onChange={(e) => setTestResultForm((f) => ({ ...f, account: e.target.value }))} />
              </FormRow>
              <FormRow label="用例编号">
                <input style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }} value={testResultForm.testCaseKey} onChange={(e) => setTestResultForm((f) => ({ ...f, testCaseKey: e.target.value }))} />
              </FormRow>
              <FormRow label="结果状态 *">
                <select style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }} value={testResultForm.resultStatus} onChange={(e) => setTestResultForm((f) => ({ ...f, resultStatus: e.target.value }))}>
                  <option value="passed">通过</option>
                  <option value="failed">失败</option>
                  <option value="blocked">阻塞</option>
                  <option value="skipped">跳过</option>
                </select>
              </FormRow>
              <FormRow label="截图 URL">
                <input style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }} value={testResultForm.screenshotUrl} onChange={(e) => setTestResultForm((f) => ({ ...f, screenshotUrl: e.target.value }))} />
              </FormRow>
              <FormRow label="备注" full>
                <textarea style={{ width: '100%', minHeight: 60, padding: '6px 8px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--r-md)', resize: 'vertical', fontFamily: 'inherit' }} value={testResultForm.notes} onChange={(e) => setTestResultForm((f) => ({ ...f, notes: e.target.value }))} />
              </FormRow>
            </div>
            <DialogActions>
              <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setTestResultDialog(false)}>取消</button>
              <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={async () => {
                if (!testResultForm.executorName || !testResultForm.environment) { alert('执行人和环境必填'); return }
                await actions.createTestResult(testResultForm)
                setTestResultDialog(false)
                setTestResultForm({ executorName: '', environment: '', account: '', testCaseKey: '', resultStatus: 'passed', screenshotUrl: '', notes: '' })
              }}>确定</button>
            </DialogActions>
      </Dialog>
    </PageShell>
  )
}

function FormRow({ label, children, full }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...(full ? {} : {}) }}>
      <label style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
        {label}
      </label>
      {children}
    </div>
  )
}
