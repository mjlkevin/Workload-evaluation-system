import { useCallback, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

/**
 * 批次 6b：AI 工具策略（system_configs 第五配置区）。
 *
 * 口径与后端一致：
 *  · 清单永远来自代码（GET /system/ai-tools，批次 6a 裁决），这里只读不改；
 *  · 可编辑的是**挂在清单上的决定**（启用 / 角色可见 / 审批策略 / 注入模式），
 *    编辑只进草稿（PATCH draft），生效要显式 activate——与其余四个配置区同套机制；
 *  · token 占用为批次 3 计量口径，由后端算好下发，前端不自算。
 */

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

const DEFAULT_ENTRY = { enabled: true, visibleRoles: [], approvalStrategy: 'default', injectionMode: 'default' }

export function normalizeEntry(entry) {
  return {
    enabled: entry?.enabled !== false,
    visibleRoles: Array.isArray(entry?.visibleRoles) ? entry.visibleRoles : [],
    approvalStrategy: entry?.approvalStrategy === 'user-confirm' ? 'user-confirm' : 'default',
    injectionMode: entry?.injectionMode === 'on-demand' ? 'on-demand' : 'default',
  }
}

export function useAiToolPolicy() {
  const [tools, setTools] = useState([])
  const [summary, setSummary] = useState({ injectedTokens: 0, injectedCount: 0 })
  const [version, setVersion] = useState(1)
  const [draft, setDraft] = useState({ policies: {} })
  const [active, setActive] = useState({ policies: {} })
  const [updatedAt, setUpdatedAt] = useState('')
  const [effectiveAt, setEffectiveAt] = useState('')
  const [revisions, setRevisions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [inventoryPayload, policyPayload] = await Promise.all([
        apiClient.get('/system/ai-tools'),
        apiClient.get('/system/tool-policy'),
      ])
      const inventory = unwrap(inventoryPayload) || {}
      setTools(normalizeItems(inventory))
      setSummary(inventory.summary || { injectedTokens: 0, injectedCount: 0 })
      const policy = unwrap(policyPayload) || {}
      setVersion(Number(policy.version) || 1)
      setDraft(policy.draft || { policies: {} })
      setActive(policy.active || { policies: {} })
      setUpdatedAt(policy.updatedAt || '')
      setEffectiveAt(policy.effectiveAt || '')
      setRevisions(Array.isArray(policy.revisions) ? policy.revisions : [])
    } catch (err) {
      setError(`工具策略加载失败：${err.message || '请求失败'}`)
      setTools([])
    } finally {
      setLoading(false)
    }
  }, [])

  const saveDraft = useCallback(async (nextPolicies) => {
    setSaving(true)
    setError('')
    try {
      const payload = await apiClient.patch('/system/tool-policy/draft', { policies: nextPolicies })
      const data = unwrap(payload) || {}
      setDraft(data.draft || { policies: nextPolicies })
      setUpdatedAt(data.updatedAt || '')
      setRevisions(Array.isArray(data.revisions) ? data.revisions : [])
      return true
    } catch (err) {
      setError(`草稿保存失败：${err.message || '请求失败'}`)
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const activate = useCallback(async () => {
    setActivating(true)
    setError('')
    try {
      const payload = await apiClient.post('/system/tool-policy/activate', {})
      const data = unwrap(payload) || {}
      setActive(data.active || active)
      setVersion(Number(data.version) || version)
      setEffectiveAt(data.effectiveAt || '')
      setRevisions(Array.isArray(data.revisions) ? data.revisions : [])
      // 生效改变注入集 → 重新拉取清单（injected/tokens 合计由后端重算）
      await load()
      return true
    } catch (err) {
      setError(`策略生效失败：${err.message || '请求失败'}`)
      return false
    } finally {
      setActivating(false)
    }
  }, [active, load, version])

  const setEntry = useCallback((toolName, patch) => {
    setDraft((current) => ({
      ...current,
      policies: {
        ...current.policies,
        [toolName]: normalizeEntry({ ...(current.policies?.[toolName] || DEFAULT_ENTRY), ...patch }),
      },
    }))
  }, [])

  const resetDraftToActive = useCallback(() => setDraft(active), [active])

  const dirty = useMemo(
    () => JSON.stringify(draft.policies || {}) !== JSON.stringify(active.policies || {}),
    [draft, active],
  )

  return {
    tools,
    summary,
    version,
    draftPolicies: draft.policies || {},
    activePolicies: active.policies || {},
    updatedAt,
    effectiveAt,
    revisions,
    loading,
    saving,
    activating,
    error,
    dirty,
    load,
    saveDraft,
    activate,
    setEntry,
    resetDraftToActive,
  }
}
