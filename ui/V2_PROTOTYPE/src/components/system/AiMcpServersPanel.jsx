import { useEffect, useMemo, useState } from 'react'
import { useMcpServers, MCP_DEFAULT_SERVER } from '../../hooks/useMcpServers.js'
import { Dialog, DialogActions } from '../ui/Dialog.jsx'

/**
 * 批次 7：MCP 第三方服务接入（系统管理 · 工具策略页 · 第六配置区）。
 *
 * 与代码工具的三个一眼可辨的差异（都来自后端裁决，不是样式偏好）：
 *  · 默认不可用：服务要登记并**生效**才连接；连上后每个工具还要**逐个放行**；
 *  · 放行绑定义摘要：第三方改了 description/参数即自动回落，必须重新探测重新放行；
 *  · 恒外发恒审批：MCP 工具永远逐次用户确认，配置里没有免审批开关。
 */

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : String(value)
}

function endpointOf(server) {
  return server.transport === 'http' ? server.url : [server.command, ...(server.args || [])].join(' ')
}

const EMPTY_FORM = { ...MCP_DEFAULT_SERVER, args: [] }

const V2_ROLES = [
  { id: 'SALES', label: '销售' },
  { id: 'PRE_SALES', label: '售前' },
  { id: 'IMPL', label: '实施' },
  { id: 'PM', label: '项目经理' },
  { id: 'DEV', label: '开发' },
  { id: 'PMO', label: 'PMO' },
  { id: 'ADMIN', label: '系统管理员' },
]

function formatSchema(schema) {
  try {
    return JSON.stringify(schema ?? null, null, 2)
  } catch {
    return String(schema ?? '')
  }
}

function ServerFormDialog({ open, initial, existingIds, isNew, onClose, onSubmit }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  useEffect(() => {
    if (open) setForm({ ...EMPTY_FORM, ...(initial || {}), args: (initial?.args || []).join(' ') })
  }, [open, initial])
  const patch = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const invalid = !form.id || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(form.id)
    || (form.transport === 'http' && !form.url)
    || (form.transport === 'stdio' && !form.command)
  return (
    <Dialog open={open} title={isNew ? '登记 MCP 服务' : `编辑 MCP 服务 ${initial?.id || ''}`} onClose={onClose} wide>
      <div className="sys-form">
        <label className="sys-field">
          <span className="sys-field__k">服务 ID（稳定前缀，改名即新服务）</span>
          <input
            className="input"
            value={form.id}
            disabled={!isNew}
            onChange={(event) => patch('id', event.target.value)}
            placeholder="im_hub"
          />
        </label>
        <label className="sys-field">
          <span className="sys-field__k">展示名</span>
          <input className="input" value={form.name} onChange={(event) => patch('name', event.target.value)} placeholder="IM 汇总服务" />
        </label>
        <label className="sys-field">
          <span className="sys-field__k">传输方式</span>
          <select className="input" value={form.transport} onChange={(event) => patch('transport', event.target.value)}>
            <option value="http">HTTP（Streamable）</option>
            <option value="stdio">stdio（本机子进程）</option>
          </select>
        </label>
        {form.transport === 'http' ? (
          <>
            <label className="sys-field">
              <span className="sys-field__k">服务地址</span>
              <input className="input" value={form.url} onChange={(event) => patch('url', event.target.value)} placeholder="https://host/mcp" />
            </label>
            <label className="sys-field">
              <span className="sys-field__k">凭据携带</span>
              <select className="input" value={form.authType} onChange={(event) => patch('authType', event.target.value)}>
                <option value="none">无</option>
                <option value="bearer">Bearer（值从凭据域现取）</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="sys-field">
              <span className="sys-field__k">命令（白名单：node/npx/tsx 或绝对路径）</span>
              <input className="input" value={form.command} onChange={(event) => patch('command', event.target.value)} placeholder="node" />
            </label>
            <label className="sys-field">
              <span className="sys-field__k">参数（空格分隔）</span>
              <input className="input" value={form.args} onChange={(event) => patch('args', event.target.value)} placeholder="/opt/mcp/server.cjs" />
            </label>
          </>
        )}
        <label className="sys-field">
          <span className="sys-field__k">凭据引用（credentials 域 scope；密钥本体永不进本页）</span>
          <input className="input" value={form.credentialScope} onChange={(event) => patch('credentialScope', event.target.value)} placeholder="mcp:im_hub" />
        </label>
        <label className="sys-field">
          <span className="sys-field__k">超时（毫秒，500–60000）</span>
          <input
            className="input"
            type="number"
            value={form.timeoutMs}
            onChange={(event) => patch('timeoutMs', Number(event.target.value) || 8000)}
          />
        </label>
      </div>
      <DialogActions>
        <button type="button" className="btn btn-out btn-sm" onClick={onClose}>取消</button>
        <button
          type="button"
          className="btn btn-pri btn-sm"
          disabled={invalid}
          onClick={() => onSubmit({
            ...form,
            name: form.name || form.id,
            args: typeof form.args === 'string' ? form.args.split(/\s+/).filter(Boolean) : form.args,
          })}
        >
          确定（进草稿，需保存并生效）
        </button>
      </DialogActions>
    </Dialog>
  )
}

function ToolDetailDialog({ open, toolRow, onClose }) {
  return (
    <Dialog open={open} title={`MCP 工具详情 · ${toolRow?.reportedName || ''}`} onClose={onClose} wide>
      <div className="sys-form" style={{ maxHeight: '70vh', overflow: 'auto' }}>
        <div className="sys-field">
          <span className="sys-field__k">稳定名（注入模型用）</span>
          <span className="mono" style={{ fontSize: 12 }}>{toolRow?.stableName || '—'}</span>
        </div>
        <div className="sys-field">
          <span className="sys-field__k">说明（第三方撰写，注入模型前经 2000 字符裁剪）</span>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: 0 }}>{toolRow?.description || '—'}</pre>
        </div>
        <div className="sys-field">
          <span className="sys-field__k">参数 schema（进模型上下文的 JSON Schema）</span>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, margin: 0 }}>{formatSchema(toolRow?.inputSchema)}</pre>
        </div>
        <div className="sys-field">
          <span className="sys-field__k">定义摘要</span>
          <span className="mono" style={{ fontSize: 11 }}>{toolRow?.digest || '—'}</span>
        </div>
      </div>
      <DialogActions>
        <button type="button" className="btn btn-out btn-sm" onClick={onClose}>关闭</button>
      </DialogActions>
    </Dialog>
  )
}

function ApproveDialog({ open, toolRow, selectedRoles, onChangeRoles, onClose, onConfirm }) {
  const invalid = selectedRoles.length === 0
  return (
    <Dialog open={open} title={`放行 MCP 工具 · ${toolRow?.reportedName || ''}`} onClose={onClose}>
      <div className="sys-form">
        <p className="sys-field__v--dim" style={{ margin: '0 0 10px' }}>
          必须至少选择一个角色；未选角色不能提交。放行后仅被选中的角色可在工作台看到该工具。
        </p>
        <div className="sys-field">
          <span className="sys-field__k">可见角色</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {V2_ROLES.map((role) => (
              <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(role.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selectedRoles, role.id]
                      : selectedRoles.filter((id) => id !== role.id)
                    onChangeRoles(next)
                  }}
                />
                {role.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogActions>
        <button type="button" className="btn btn-out btn-sm" onClick={onClose}>取消</button>
        <button
          type="button"
          className="btn btn-pri btn-sm"
          disabled={invalid}
          onClick={() => onConfirm(selectedRoles)}
        >
          放行（进草稿）
        </button>
      </DialogActions>
    </Dialog>
  )
}

export default function AiMcpServersPanel() {
  const {
    version, draftServers, activeServers, updatedAt, effectiveAt, revisions,
    loading, saving, activating, error, unsavedLocal, pendingActivation,
    probes, probing,
    load, saveDraft, activate, probe, setServers, discardLocalEdits,
  } = useMcpServers()
  const [formState, setFormState] = useState(null) // { mode: 'add'|'edit', server }
  const [expanded, setExpanded] = useState('')
  const [savedOk, setSavedOk] = useState(false)
  const [detailTool, setDetailTool] = useState(null) // { toolRow }
  const [approvalTool, setApprovalTool] = useState(null) // { server, toolRow }
  const [selectedRoles, setSelectedRoles] = useState([])

  useEffect(() => { load() }, [load])

  const activeIds = useMemo(() => new Set(activeServers.map((server) => server.id)), [activeServers])
  const edit = (server) => {
    setSavedOk(false)
    setServers((current) => current.map((entry) => (entry.id === server.id ? server : entry)))
  }

  const upsert = (server) => {
    setSavedOk(false)
    setServers((current) => {
      const exists = current.some((entry) => entry.id === server.id)
      return exists ? current.map((entry) => (entry.id === server.id ? server : entry)) : [...current, server]
    })
    setFormState(null)
  }

  const remove = (serverId) => {
    setSavedOk(false)
    setServers((current) => current.filter((entry) => entry.id !== serverId))
  }

  const toggleApproval = (server, toolRow, selectedRoles) => {
    setSavedOk(false)
    const existing = server.approvedTools?.[toolRow.reportedName]
    const nextEntry = Object.fromEntries(
      Object.entries(server.approvedTools || {}).filter(([name]) => name !== toolRow.reportedName),
    )
    const approvedTools = existing
      ? nextEntry
      : { ...nextEntry, [toolRow.reportedName]: { digest: toolRow.digest, allowedRoles: selectedRoles } }
    edit({ ...server, approvedTools })
  }

  const handleSave = async () => { if (await saveDraft(draftServers)) setSavedOk(true) }
  const handleActivate = async () => { setSavedOk(false); await activate() }

  return (
    <div style={{ marginTop: 26 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>MCP 第三方服务（第六配置区）</h3>
      <p className="sys-field__v--dim" style={{ margin: '0 0 10px', fontSize: 12 }}>
        这里配的是**接哪些服务**与**放行它们的哪些工具**。服务上报的工具清单每次现问、绝不缓存；
        MCP 工具与代码工具的默认相反：登记≠可连（要生效），连上≠可用（要逐个放行），
        放行过也不算数（对方改了描述或参数即自动回落，需重新人工放行）。
        MCP 工具永远逐次审批，不存在免审批配置。凭据只存引用，密钥本体在凭据域。
      </p>

      <div className="sys-toolbar" style={{ gap: 8, alignItems: 'center' }}>
        <span className="meta">
          MCP 配置版本 v{version}
          {effectiveAt ? ` · 生效于 ${formatTime(effectiveAt)}` : ''}
          {updatedAt ? ` · 草稿更新于 ${formatTime(updatedAt)}` : ''}
          {loading ? ' · 加载中...' : ''}
        </span>
        {unsavedLocal ? <span className="bdg warn" title="页面编辑未写入服务端草稿，此时「生效」不会带上它们"><span className="dot" />MCP：有未保存的修改</span> : null}
        {pendingActivation ? <span className="bdg warn"><span className="dot" />MCP：草稿未生效</span> : null}
        {!unsavedLocal && !pendingActivation ? <span className="bdg muted"><span className="dot" />MCP：草稿与生效一致</span> : null}
        {savedOk ? <span className="bdg acc"><span className="dot" />MCP：草稿已保存</span> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-out btn-sm" onClick={() => setFormState({ mode: 'add' })}>＋ 登记 MCP 服务</button>
        <button type="button" className="btn btn-out btn-sm" onClick={() => { setSavedOk(false); discardLocalEdits() }} disabled={!unsavedLocal}>放弃未保存（MCP）</button>
        <button type="button" className="btn btn-out btn-sm" onClick={handleSave} disabled={!unsavedLocal || saving}>{saving ? '保存中...' : '保存 MCP 草稿'}</button>
        <button type="button" className="btn btn-pri btn-sm" onClick={handleActivate} disabled={!pendingActivation || unsavedLocal || activating} title={unsavedLocal ? '先保存草稿再生效' : '把服务端草稿提升为生效版本（version +1）'}>
          {activating ? '生效中...' : '生效 MCP 配置'}
        </button>
      </div>

      {error ? <div className="sys-empty">{error}</div> : null}
      {draftServers.length === 0 && !loading ? <div className="sys-empty">未登记任何 MCP 服务（默认状态：什么都不连）</div> : null}

      {draftServers.length > 0 ? (
        <div className="sys-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>服务</th>
                <th>传输 / 端点</th>
                <th>凭据引用</th>
                <th>超时</th>
                <th>放行工具</th>
                <th>生效状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {draftServers.map((server) => {
                const probeResult = probes[server.id]
                const approvedCount = Object.keys(server.approvedTools || {}).length
                return (
                  <tr key={server.id} style={{ verticalAlign: 'top' }}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{server.id}</span>
                      <div className="meta" style={{ fontSize: 11 }}>{server.name}</div>
                    </td>
                    <td><span className="sys-cell-clip mono" style={{ fontSize: 11 }} title={endpointOf(server)}>{server.transport} · {endpointOf(server)}</span></td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{server.credentialScope ? `${server.credentialScope}${server.authType === 'bearer' ? '（bearer）' : ''}` : '—'}</span></td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{server.timeoutMs}ms</span></td>
                    <td><span className="mono">{approvedCount}</span></td>
                    <td>
                      {activeIds.has(server.id)
                        ? <span className="bdg acc"><span className="dot" />已生效</span>
                        : <span className="bdg muted"><span className="dot" />仅草稿</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-out btn-sm" onClick={() => setFormState({ mode: 'edit', server })}>编辑</button>
                        <button
                          type="button"
                          className="btn btn-out btn-sm"
                          disabled={probing === server.id}
                          title="每次真连接、真发 tools/list，结果不落任何缓存"
                          onClick={async () => {
                            await probe(server.id, 'draft')
                            setExpanded(server.id)
                          }}
                        >
                          {probing === server.id ? '现问...' : '拉取工具'}
                        </button>
                        <button type="button" className="btn btn-out btn-sm" onClick={() => remove(server.id)}>移除</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {expanded && probes[expanded] ? (
        <div style={{ margin: '8px 0 0 12px' }}>
          {probes[expanded].ok === false ? (
            <div className="sys-empty">连接/列工具失败：{probes[expanded].errorKind || 'unknown'}（该服务本轮工具缺席，不影响对话与其他服务）</div>
          ) : (
            <div className="sys-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>上报工具</th>
                    <th>稳定名（注入模型用）</th>
                    <th>说明（第三方撰写，逐看后再放行）</th>
                    <th>定义摘要</th>
                    <th>放行状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(probes[expanded].tools || []).map((toolRow) => {
                    const server = draftServers.find((entry) => entry.id === expanded) || { approvedTools: {} }
                    const approved = Boolean(server.approvedTools?.[toolRow.reportedName])
                    return (
                      <tr key={toolRow.reportedName}>
                        <td><span className="mono">{toolRow.reportedName}</span></td>
                        <td><span className="mono" style={{ fontSize: 11 }}>{toolRow.stableName}</span></td>
                        <td>
                          <span className="sys-cell-clip" title={toolRow.description}>{toolRow.description || '—'}</span>
                          {' '}
                          <button
                            type="button"
                            className="btn btn-link btn-sm"
                            style={{ padding: 0, fontSize: 12 }}
                            onClick={() => setDetailTool(toolRow)}
                          >
                            查看全文
                          </button>
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: 10 }}>{toolRow.digest.slice(0, 12)}…</span>
                          {' '}
                          <button
                            type="button"
                            className="btn btn-link btn-sm"
                            style={{ padding: 0, fontSize: 12 }}
                            onClick={() => setDetailTool(toolRow)}
                          >
                            schema
                          </button>
                        </td>
                        <td>
                          {toolRow.approvalStatus === 'definition-changed' ? <span className="bdg warn"><span className="dot" />定义已变·待重放行</span> : null}
                          {toolRow.approvalStatus === 'not-approved' && !approved ? <span className="bdg muted"><span className="dot" />未放行</span> : null}
                          {(approved || toolRow.approvalStatus === 'approved') ? <span className="bdg acc"><span className="dot" />已放行{approved && toolRow.approvalStatus !== 'approved' ? '（草稿）' : ''}</span> : null}
                        </td>
                        <td>
                          {approved ? (
                            <button type="button" className="btn btn-out btn-sm" disabled={!server} onClick={() => toggleApproval(server, toolRow, [])}>
                              收回放行
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-out btn-sm"
                              disabled={!server}
                              onClick={() => {
                                setApprovalTool({ server, toolRow })
                                setSelectedRoles([])
                              }}
                            >
                              放行（进草稿）
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>MCP 配置轨迹（最近 {revisions.length} 条）</h3>
        {revisions.length === 0 ? <div className="sys-empty">暂无 MCP 变更记录</div> : (
          <div className="sys-table-wrap">
            <table className="table">
              <thead>
                <tr><th>#</th><th>版本</th><th>动作</th><th>操作者</th><th>时间</th><th>改了什么</th></tr>
              </thead>
              <tbody>
                {[...revisions].reverse().map((revision) => (
                  <tr key={`${revision.seq}-${revision.at}`}>
                    <td><span className="mono">{revision.seq}</span></td>
                    <td><span className="mono">v{revision.version}</span></td>
                    <td><span className={`bdg ${revision.action === 'activate' ? 'acc' : 'muted'}`}><span className="dot" />{revision.action === 'activate' ? '生效' : '草稿'}</span></td>
                    <td><span className="mono">{revision.actor}</span></td>
                    <td><span style={{ fontSize: 11 }}>{formatTime(revision.at)}</span></td>
                    <td>
                      {revision.changes.length === 0
                        ? <span className="meta" style={{ fontSize: 11 }}>无字段变化</span>
                        : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {revision.changes.map((change, index) => (
                              <span key={`${revision.seq}-${index}`} className="mono" style={{ fontSize: 11 }}>
                                {change.target} · {change.field}: {change.from || '—'} → {change.to || '—'}
                              </span>
                            ))}
                          </div>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ToolDetailDialog
        open={Boolean(detailTool)}
        toolRow={detailTool}
        onClose={() => setDetailTool(null)}
      />
      <ApproveDialog
        open={Boolean(approvalTool)}
        toolRow={approvalTool?.toolRow}
        selectedRoles={selectedRoles}
        onChangeRoles={setSelectedRoles}
        onClose={() => setApprovalTool(null)}
        onConfirm={(roles) => {
          if (approvalTool) {
            toggleApproval(approvalTool.server, approvalTool.toolRow, roles)
          }
          setApprovalTool(null)
        }}
      />
      <ServerFormDialog
        open={Boolean(formState)}
        isNew={formState?.mode === 'add'}
        existingIds={draftServers.map((server) => server.id)}
        initial={formState?.mode === 'edit' ? formState.server : null}
        onClose={() => setFormState(null)}
        onSubmit={upsert}
      />
    </div>
  )
}
