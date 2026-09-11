import { useEffect, useState } from 'react'
import { useAiToolPolicy, normalizeEntry } from '../../hooks/useAiToolPolicy.js'

/**
 * 批次 6a：AI 工具清单（系统管理 · 只读，运行时从 ToolRegistry 派生）。
 * 批次 6b：清单仍是唯一事实来源、永不可编辑；本页新增的是挂在清单上的**策略决定**
 * （启用 / 角色可见 / 审批策略 / 注入模式）——编辑进草稿、显式生效、version 递增、
 * 变更轨迹可查（system_configs 第五配置区，与其余四区同套 draft→生效 机制）。
 * token 列为批次 3 计量口径（定义注入模型时的开销），合计为当前注入集开销。
 */

const V2_ROLES = [
  { id: 'SALES', label: '销售' },
  { id: 'PRE_SALES', label: '售前' },
  { id: 'IMPL', label: '实施' },
  { id: 'PM', label: '项目经理' },
  { id: 'DEV', label: '开发' },
  { id: 'PMO', label: 'PMO' },
  { id: 'ADMIN', label: '系统管理员' },
]

const ROLE_LABELS = Object.fromEntries(V2_ROLES.map((role) => [role.id, role.label]))

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : String(value)
}

export default function AiToolInventoryPanel() {
  const {
    tools, summary, version, draftPolicies, activePolicies,
    updatedAt, effectiveAt, revisions,
    loading, saving, activating, error, dirty,
    load, saveDraft, activate, setEntry, resetDraftToActive,
  } = useAiToolPolicy()
  const [savingOk, setSavingOk] = useState(false)

  useEffect(() => {
    load()
  }, [load])

  const writerCount = tools.filter((tool) => tool.mutates).length
  const exfilCount = tools.filter((tool) => tool.exfiltrates).length
  const callableCount = tools.filter((tool) => tool.callable).length

  const entryFor = (tool) => normalizeEntry(draftPolicies[tool.name] ?? activePolicies[tool.name])
  const codeApprovalRequired = (tool) => tool.mutates === true || tool.exfiltrates === true
  const roleDisabled = (tool) => entryFor(tool).enabled === false

  // 任何编辑都作废「已保存」提示，避免它挂在过期状态上
  const editEntry = (toolName, patch) => {
    setSavingOk(false)
    setEntry(toolName, patch)
  }

  const handleSave = async () => {
    setSavingOk(false)
    const ok = await saveDraft(draftPolicies)
    if (ok) setSavingOk(true)
  }

  const handleActivate = async () => {
    setSavingOk(false)
    await activate()
  }

  const toggleRole = (tool, roleId) => {
    const current = entryFor(tool)
    const visibleRoles = current.visibleRoles.includes(roleId)
      ? current.visibleRoles.filter((role) => role !== roleId)
      : [...current.visibleRoles, roleId]
    editEntry(tool.name, { visibleRoles })
  }

  return (
    <div>
      <div className="sys-toolbar">
        <span className="meta">
          共 {tools.length} 个工具 · 其中 {writerCount} 个会写数据 · {exfilCount} 个会外发数据 · 你本人可调用 {callableCount} 个
          {' · '}当前注入 {summary.injectedCount ?? 0} 个 / {summary.injectedTokens ?? 0} tokens
          {loading ? ' · 加载中...' : ''}
        </span>
        <button type="button" className="btn btn-out btn-sm" onClick={load} disabled={loading}>
          ↻ 刷新
        </button>
      </div>

      <p className="sys-field__v--dim" style={{ margin: '0 0 10px', fontSize: 12 }}>
        工具本身（名称、参数、实现）来自代码，清单只读不可编辑；本页编辑的是**策略决定**——启用、角色可见、审批要求、注入模式。
        策略只做减法：capability 权限之上再裁一层，两层都通过才注入；任何策略都不能放宽权限。改完先「保存草稿」，「生效」后才对模型注入起作用。
        {exfilCount > 0
          ? '外发类工具（把数据送出系统）必须逐次审批，且不可配置为免审批。'
          : '「外发」维度独立于「写入」：不改本地库但把数据送出系统的工具同样必须逐次审批。'}
      </p>

      <div className="sys-toolbar" style={{ gap: 8, alignItems: 'center' }}>
        <span className="meta">
          生效版本 v{version}
          {effectiveAt ? ` · 生效于 ${formatTime(effectiveAt)}` : ''}
          {updatedAt ? ` · 草稿更新于 ${formatTime(updatedAt)}` : ''}
        </span>
        {dirty ? <span className="bdg warn"><span className="dot" />草稿未生效</span> : <span className="bdg muted"><span className="dot" />草稿与生效一致</span>}
        {savingOk ? <span className="bdg acc"><span className="dot" />草稿已保存</span> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-out btn-sm" onClick={() => { setSavingOk(false); resetDraftToActive() }} disabled={!dirty || saving || activating}>
          放弃草稿
        </button>
        <button type="button" className="btn btn-out btn-sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? '保存中...' : '保存草稿'}
        </button>
        <button type="button" className="btn btn-pri btn-sm" onClick={handleActivate} disabled={!dirty || activating}>
          {activating ? '生效中...' : '生效'}
        </button>
      </div>

      {error ? <div className="sys-empty">{error}</div> : null}

      {!error && tools.length === 0 && !loading ? <div className="sys-empty">暂无已注册的工具</div> : null}

      {tools.length > 0 ? (
        <div className="sys-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>工具</th>
                <th>说明</th>
                <th>所需权限</th>
                <th>写入</th>
                <th>外发</th>
                <th title="定义（名称+描述+参数 schema）注入模型时的 token 估算，批次 3 计量口径">Token</th>
                <th>启用</th>
                <th>可见角色</th>
                <th>审批策略</th>
                <th>注入模式</th>
                <th>生效注入</th>
                <th>本人可调用</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => {
                const entry = entryFor(tool)
                return (
                  <tr key={tool.name}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{tool.name}</span>
                      {tool.category ? (
                        <div>
                          <span className="tag brd" style={{ fontSize: 10 }}>{tool.category}</span>
                        </div>
                      ) : null}
                    </td>
                    <td><span className="sys-cell-clip" title={tool.description}>{tool.description || '—'}</span></td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{tool.capability || '—'}</span></td>
                    <td>
                      <span className={`bdg ${tool.mutates ? 'warn' : 'muted'}`}><span className="dot" />{tool.mutates ? '会写数据' : '只读'}</span>
                    </td>
                    <td>
                      {/* 外发独立于写入：琥珀告警色——送出系统的数据不可回收 */}
                      <span className={`bdg ${tool.exfiltrates ? 'warn' : 'muted'}`}><span className="dot" />{tool.exfiltrates ? '会外发' : '不外发'}</span>
                    </td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{tool.tokens}</span></td>
                    <td>
                      <input
                        type="checkbox"
                        className="sys-check"
                        checked={entry.enabled}
                        onChange={(event) => editEntry(tool.name, { enabled: event.target.checked })}
                        aria-label={`启用 ${tool.name}`}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 220 }}>
                        {V2_ROLES.map((role) => {
                          const on = entry.visibleRoles.includes(role.id)
                          return (
                            <button
                              key={role.id}
                              type="button"
                              className={`tag ${on ? 'acc' : 'brd'}`}
                              title={on ? `已限定对「${role.label}」可见（取消勾选=不限制）` : `对「${role.label}」${entry.visibleRoles.length ? '不可见' : '可见（未设限）'}`}
                              aria-pressed={on}
                              disabled={roleDisabled(tool)}
                              onClick={() => toggleRole(tool, role.id)}
                            >
                              {role.label}
                            </button>
                          )
                        })}
                        {entry.visibleRoles.length === 0 ? <span className="meta" style={{ fontSize: 11 }}>全部角色（仅受权限位约束）</span> : null}
                      </div>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={entry.approvalStrategy}
                        disabled={codeApprovalRequired(tool) || roleDisabled(tool)}
                        title={
                          codeApprovalRequired(tool)
                            ? '该工具按代码事实必须逐次审批（写/外发），策略不可放宽'
                            : '只读工具默认免审批，可收紧为逐次确认'
                        }
                        onChange={(event) => editEntry(tool.name, { approvalStrategy: event.target.value })}
                      >
                        <option value="default">{codeApprovalRequired(tool) ? '必须审批（代码下限）' : '按代码（免审批）'}</option>
                        <option value="user-confirm">逐次确认</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={entry.injectionMode}
                        disabled={roleDisabled(tool)}
                        title="注入模式只能降档：按需发现 = 不再主动注入（发现类工具本就只能按需发现，二者互不冲突）"
                        onChange={(event) => editEntry(tool.name, { injectionMode: event.target.value })}
                      >
                        <option value="default">跟随代码{tool.discoverable ? '（按需发现）' : '（常驻）'}</option>
                        <option value="on-demand">强制按需发现</option>
                      </select>
                    </td>
                    <td>
                      <span
                        className={`bdg ${tool.injected ? 'acc' : 'muted'}`}
                        title={
                          tool.injected
                            ? '按当前生效策略，该工具会注入给模型的这位使用者'
                            : '按当前生效策略不注入（权限位 / 停用 / 角色不可见 / 按需降档 之一）'
                        }
                      >
                        <span className="dot" />{tool.injected ? '注入' : '不注入'}
                      </span>
                    </td>
                    <td>
                      {/* 权限差异不是错误态：不可调用只给中性品牌色，与「会写数据」的琥珀告警区分开 */}
                      <span
                        className={`bdg ${tool.callable ? 'muted' : 'brd'}`}
                        title={
                          tool.callable
                            ? `你本人持有 ${tool.capability}，可直接调用`
                            : `工具已在系统中注册，但你本人缺少 ${tool.capability}，无法调用`
                        }
                      >
                        <span className="dot" />
                        {tool.callable ? '可调用' : '不可调用'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>变更轨迹（最近 {revisions.length} 条，与 version 对账）</h3>
        {revisions.length === 0 ? (
          <div className="sys-empty">暂无策略变更记录</div>
        ) : (
          <div className="sys-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>版本</th>
                  <th>动作</th>
                  <th>操作者</th>
                  <th>时间</th>
                  <th>改了什么</th>
                </tr>
              </thead>
              <tbody>
                {[...revisions].reverse().map((revision) => (
                  <tr key={`${revision.seq}-${revision.at}`}>
                    <td><span className="mono">{revision.seq}</span></td>
                    <td><span className="mono">v{revision.version}</span></td>
                    <td>
                      <span className={`bdg ${revision.action === 'activate' ? 'acc' : 'muted'}`}>
                        <span className="dot" />{revision.action === 'activate' ? '生效' : '草稿'}
                      </span>
                    </td>
                    <td><span className="mono">{revision.actor}</span></td>
                    <td><span style={{ fontSize: 11 }}>{formatTime(revision.at)}</span></td>
                    <td>
                      {revision.changes.length === 0
                        ? <span className="meta" style={{ fontSize: 11 }}>无字段变化</span>
                        : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {revision.changes.map((change, index) => (
                              <span key={`${revision.seq}-${index}`} className="mono" style={{ fontSize: 11 }}>
                                {change.tool} · {change.field}: {change.from || '—'} → {change.to || '—'}
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
    </div>
  )
}
