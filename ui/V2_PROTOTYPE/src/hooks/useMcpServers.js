import { useCallback, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { unwrap } from '../api/utils.js'

/**
 * 批次 7：MCP 服务配置（system_configs 第六配置区）。
 *
 * 口径与后端一致：
 *  · 落库的只有服务清单（地址/传输/凭据 scope 引用）与人工放行名单（名字+定义摘要）；
 *    服务上报的工具清单/schema/description **永不缓存**——每次「拉取工具」都真连接真问；
 *  · 编辑只进草稿（PATCH draft），生效要显式 activate——与第五区同套机制；
 *  · 放行以「当前探测到的摘要」为准写入草稿；摘要变了后端运行时自动回落，
 *    页面必须重新探测重新放行。
 */

export const MCP_DEFAULT_SERVER = {
  id: '',
  name: '',
  transport: 'http',
  url: '',
  authType: 'none',
  command: '',
  args: [],
  env: {},
  credentialScope: '',
  timeoutMs: 8000,
  approvedTools: {},
}

function normalizeServers(payload) {
  if (!payload || !Array.isArray(payload.servers)) return []
  return payload.servers.map((server) => ({ ...MCP_DEFAULT_SERVER, ...server }))
}

const serversOf = (config) => JSON.stringify((config?.servers || []).slice().sort((a, b) => a.id.localeCompare(b.id)))

export function useMcpServers() {
  const [version, setVersion] = useState(1)
  const [draft, setDraft] = useState({ servers: [] })
  const [savedDraft, setSavedDraft] = useState({ servers: [] })
  const [active, setActive] = useState({ servers: [] })
  const [updatedAt, setUpdatedAt] = useState('')
  const [effectiveAt, setEffectiveAt] = useState('')
  const [revisions, setRevisions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState('')
  /** serverId → 探测结果（每次现问；不落任何缓存，刷新/重开必须重探） */
  const [probes, setProbes] = useState({})
  const [probing, setProbing] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = unwrap(await apiClient.get('/system/mcp')) || {}
      const nextDraft = { servers: normalizeServers(payload.draft) }
      setVersion(Number(payload.version) || 1)
      setDraft(nextDraft)
      setSavedDraft(nextDraft)
      setActive({ servers: normalizeServers(payload.active) })
      setUpdatedAt(payload.updatedAt || '')
      setEffectiveAt(payload.effectiveAt || '')
      setRevisions(Array.isArray(payload.revisions) ? payload.revisions : [])
      setProbes({})
    } catch (err) {
      setError(`MCP 配置加载失败：${err.message || '请求失败'}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveDraft = useCallback(async (nextServers) => {
    setSaving(true)
    setError('')
    try {
      const data = unwrap(await apiClient.patch('/system/mcp/draft', { servers: nextServers })) || {}
      const serverDraft = { servers: normalizeServers(data.draft) }
      setDraft(serverDraft)
      setSavedDraft(serverDraft)
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
      const data = unwrap(await apiClient.post('/system/mcp/activate', {})) || {}
      setActive({ servers: normalizeServers(data.active) })
      setVersion(Number(data.version) || version)
      setEffectiveAt(data.effectiveAt || '')
      setRevisions(Array.isArray(data.revisions) ? data.revisions : [])
      return true
    } catch (err) {
      setError(`MCP 配置生效失败：${err.message || '请求失败'}`)
      return false
    } finally {
      setActivating(false)
    }
  }, [version])

  /** 现问探测：每次真连接；同一按钮连点两次会看到两次真实结果 */
  const probe = useCallback(async (serverId, source = 'draft') => {
    setProbing(serverId)
    setError('')
    try {
      const data = unwrap(await apiClient.post('/system/mcp/probe', { serverId, source })) || {}
      setProbes((current) => ({ ...current, [serverId]: data }))
      return data
    } catch (err) {
      setError(`服务探测失败：${err.message || '请求失败'}`)
      return null
    } finally {
      setProbing('')
    }
  }, [])

  const setServers = useCallback((updater) => {
    setDraft((current) => ({ servers: typeof updater === 'function' ? updater(current.servers) : updater }))
  }, [])

  const discardLocalEdits = useCallback(() => setDraft(savedDraft), [savedDraft])

  const unsavedLocal = useMemo(() => serversOf(draft) !== serversOf(savedDraft), [draft, savedDraft])
  const pendingActivation = useMemo(() => serversOf(savedDraft) !== serversOf(active), [savedDraft, active])

  return {
    version, draftServers: draft.servers, activeServers: active.servers,
    updatedAt, effectiveAt, revisions,
    loading, saving, activating, error, unsavedLocal, pendingActivation,
    probes, probing,
    load, saveDraft, activate, probe, setServers, discardLocalEdits,
  }
}
