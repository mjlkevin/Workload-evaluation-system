import React, { useState, useMemo } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

// ============================================================
// Agent 场景地图数据
// ============================================================

const SCENARIO_CATEGORIES = [
  {
    id: 1,
    label: '直接回答',
    riskLevel: '低风险',
    riskColor: 'var(--ok)',
    riskBg: 'var(--ok-soft)',
    description: '规则匹配 · 可自动处理',
    scenarios: [
      { name: '能力发现 / 问候', input: '"你能做什么？" "你好"', handler: '规则匹配，返回能力列表', status: 'done', codeRef: 'workbench-intent.service.ts' },
      { name: '元问题（模型/身份）', input: '"你用的是什么模型？"', handler: '规则匹配，静态回答', status: 'done', codeRef: 'workbench-intent.service.ts' },
      { name: '通用业务问答', input: '"这个风险是什么意思？"', handler: '模型直接生成回答', status: 'done', codeRef: 'workbench-intent.service.ts' },
    ],
  },
  {
    id: 2,
    label: '查知识库',
    riskLevel: '风险较低',
    riskColor: 'var(--ok)',
    riskBg: 'var(--ok-soft)',
    description: 'RAG 检索 · 可自动处理',
    scenarios: [
      { name: '产品知识查询', input: '"金蝶云有哪些模块？"', handler: 'RAG 检索智谱知识库', status: 'done', codeRef: 'knowledge-tool.service.ts' },
      { name: '行业知识查询', input: '"制造业痛点有哪些？"', handler: 'RAG 检索知识库', status: 'done', codeRef: 'knowledge-tool.service.ts' },
      { name: '文档/方案搜索', input: '"知识库有没有相关方案？"', handler: '显式知识库查询', status: 'done', codeRef: 'knowledge-tool.service.ts' },
    ],
  },
  {
    id: 3,
    label: '查工具',
    riskLevel: '风险中等',
    riskColor: 'var(--warn)',
    riskBg: 'var(--warn-soft)',
    description: 'Tool Calling · 需规则与权限',
    scenarios: [
      { name: '查询我的项目', input: '"我之前创建过哪些项目？"', handler: 'Tool Calling 查询项目列表', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '查询评估记录', input: '"我的评估状态怎样？"', handler: 'Tool Calling 查询评估数据', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '附件解析与问答', input: '上传 Excel/Word/PDF 后提问', handler: '附件上下文 + 模型回答', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '工作量估算', input: '"帮我估算这个项目"', handler: 'Tool Calling 调用估算引擎', status: 'done', codeRef: 'agent/tools/presales.tools.ts' },
      { name: '历史项目检索', input: '"找类似的项目"', handler: 'Tool Calling 相似度检索', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '变更影响分析', input: '"这个变更影响哪些模块？"', handler: '接入 change-management 模块', status: 'todo', codeRef: '待实现' },
      { name: '销售简报生成', input: '"帮我生成销售简报"', handler: '接入 sales-briefing 模块', status: 'todo', codeRef: '待实现' },
      { name: '开发评估查询', input: '"开发工作量是多少？"', handler: '接入 dev-assessment 模块', status: 'todo', codeRef: '待实现' },
      { name: '团队协作查询', input: '"谁在评审这个项目？"', handler: '接入 collab 协同模块', status: 'todo', codeRef: '待实现' },
      { name: 'WBS 查询', input: '"WBS 分解是什么？"', handler: '接入 wbs 路由', status: 'todo', codeRef: '待实现' },
      { name: '模板查询/推荐', input: '"有什么评估模板可用？"', handler: '接入 templates 模块', status: 'todo', codeRef: '待实现' },
      { name: '规则查询', input: '"当前使用的评估规则？"', handler: '接入 rules 模块', status: 'todo', codeRef: '待实现' },
    ],
  },
  {
    id: 4,
    label: '人工确认',
    riskLevel: '风险较高',
    riskColor: 'var(--err)',
    riskBg: 'var(--err-soft)',
    description: 'Human-in-the-loop · 需审批留痕',
    scenarios: [
      { name: '生成需求解析报告 v1', input: '"生成需求解析报告"', handler: '确认后执行，生成 Harness 报告', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '提交补充信息生成 v2', input: '结构化卡片填写后提交', handler: 'Human-in-the-loop 审批后执行', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '创建评估草稿', input: '"帮我建一个项目评估草稿"', handler: '写动作需确认（requiresConfirm）', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '进入正式评估', input: '"进入正式评估"', handler: '写动作需确认', status: 'done', codeRef: 'workbench-dispatch.service.ts' },
      { name: '版本检入/检出/升版', input: '版本操作请求', handler: '需权限校验 + 确认', status: 'done', codeRef: 'versions.usecase.ts' },
      { name: '导出操作', input: '"帮我导出评估报告"', handler: '接入 exports 模块，需确认数据范围', status: 'todo', codeRef: '待实现' },
      { name: '变更管理提交', input: '"提交这个变更申请"', handler: '接入 change-management 写操作', status: 'todo', codeRef: '待实现' },
      { name: '团队邀请/权限变更', input: '"邀请某人加入团队"', handler: '接入 team 模块写操作，需 admin 确认', status: 'todo', codeRef: '待实现' },
    ],
  },
  {
    id: 5,
    label: '不适合 Agent',
    riskLevel: '风险高',
    riskColor: '#dc2626',
    riskBg: '#fee2e2',
    description: '拒绝或严格处理',
    scenarios: [
      { name: '用户管理操作', input: '"帮我删除某个用户"', handler: '规则拒绝，仅 admin 可操作', status: 'done', codeRef: 'RBAC 中间件' },
      { name: '强制解锁版本', input: '"强制解锁这个版本"', handler: '严格权限流程', status: 'done', codeRef: 'versions.usecase.ts' },
      { name: '系统配置修改', input: '"修改系统规则"', handler: '需 admin 权限 + 审批', status: 'done', codeRef: 'system.usecase.ts' },
      { name: '无关/违规请求', input: '闲聊、乱码、与系统无关', handler: 'unsupported_or_out_of_scope 拒绝', status: 'done', codeRef: 'workbench-intent.service.ts' },
      { name: '数据删除/批量操作', input: '"批量删除所有草稿"', handler: '需增加破坏性操作识别 + 安全阈值', status: 'rework', codeRef: '待强化' },
      { name: '跨用户数据访问', input: '尝试查看他人项目/评估', handler: '需强化 RBAC 边界 + Agent 层权限预检', status: 'rework', codeRef: '待强化' },
    ],
  },
]

// ============================================================
// Prompt 角色边界数据
// ============================================================

const ROLE_BOUNDARIES = [
  {
    role: 'system',
    label: 'SystemMessage',
    icon: '🛡',
    color: 'var(--brand)',
    bg: 'var(--brand-soft)',
    responsibility: '定义边界和规则',
    source: '后端注入',
    userCanOverride: false,
    details: [
      '定义模型的角色、任务、禁止事项和事实来源',
      '由后端根据业务角色（售前/交付/PM/PMO/开发/管理）注入',
      '用户输入不能覆盖或修改此边界',
      'Agent 路径始终有安全默认值兜底',
    ],
    codeRef: 'model-provider.ts · ChatRole',
  },
  {
    role: 'user',
    label: 'HumanMessage',
    icon: '👤',
    color: 'var(--ok)',
    bg: 'var(--ok-soft)',
    responsibility: '表达当前请求',
    source: '前端传入',
    userCanOverride: true,
    details: [
      '包含用户提问、补充信息与情绪表达',
      '用于帮助模型理解当前请求',
      '不能修改系统规则与业务边界',
      '前端传入 system 角色会被显式拒绝（防 prompt injection）',
    ],
    codeRef: 'chat.service.ts · normalizeHomeMessages',
  },
  {
    role: 'assistant',
    label: 'AssistantMessage',
    icon: '',
    color: 'var(--accent)',
    bg: 'var(--accent-soft)',
    responsibility: '模型生成的回复',
    source: '模型输出',
    userCanOverride: false,
    details: [
      '模型在系统规则约束下生成的回复',
      '包含建议动作、表单块、知识库引用等',
      '写入 AI Session 供多轮对话上下文使用',
      '不会伪装为工具结果或其他角色',
    ],
    codeRef: 'chat.service.ts · appendAiSessionEvent',
  },
  {
    role: 'tool',
    label: 'ToolMessage',
    icon: '🔧',
    color: 'var(--teal)',
    bg: 'var(--teal-soft)',
    responsibility: '工具执行结果',
    source: '系统注入',
    userCanOverride: false,
    details: [
      '工具调用后的执行结果回填给模型',
      '使用标准 tool 角色（OpenAI 兼容协议）',
      '携带 toolCallId 关联对应的 tool_call',
      '与 assistant 消息严格区分，避免模型混淆',
    ],
    codeRef: 'orchestrator.ts · toolResultMessage',
  },
]

const SECURITY_RULES = [
  { rule: '前端 system 角色注入防护', status: '已实现', detail: 'normalizeHomeMessages 显式拒绝 role="system" 的传入消息' },
  { rule: 'Agent 始终有 SystemMessage', status: '已实现', detail: 'runAgent 不传 systemPrompt 时使用 DEFAULT_SYSTEM_PROMPT 安全默认值' },
  { rule: '工具结果使用标准 tool 角色', status: '已实现', detail: 'toolResultMessage 返回 role:"tool" + toolCallId，不再伪装为 assistant' },
  { rule: 'Kimi Provider 透传 tool_call_id', status: '已实现', detail: 'toKimiMessage 对 tool 角色消息携带 tool_call_id 字段' },
  { rule: '写操作 Human-in-the-loop 确认', status: '已实现', detail: 'AgentTool.mutates=true 时需用户 confirm 后才执行' },
  { rule: 'RBAC 权限预检', status: '已实现', detail: 'ToolRegistry.listToolsFor 按用户 capability 过滤可用工具' },
  { rule: '破坏性操作显式拒绝', status: '待强化', detail: '批量删除等高风险操作需在意图路由层增加识别规则' },
  { rule: '跨用户数据访问 Agent 层预检', status: '待强化', detail: '在 Agent 执行查询前增加 owner 隔离预检' },
]

// ============================================================
// 样式工具
// ============================================================

const statusBadge = {
  done: { label: '已实现', bg: 'var(--ok-soft)', color: 'var(--ok)', dot: 'var(--ok)' },
  todo: { label: '待实现', bg: 'var(--warn-soft)', color: 'var(--warn)', dot: 'var(--warn)' },
  rework: { label: '待强化', bg: '#fee2e2', color: '#dc2626', dot: '#dc2626' },
}

// ============================================================
// 页面组件
// ============================================================

export default function AgentManagement() {
  const [tab, setTab] = useState('scenario') // 'scenario' | 'boundary'
  const [expandedCategory, setExpandedCategory] = useState(null)

  const stats = useMemo(() => {
    let done = 0, todo = 0, rework = 0
    SCENARIO_CATEGORIES.forEach((cat) => {
      cat.scenarios.forEach((s) => {
        if (s.status === 'done') done++
        else if (s.status === 'todo') todo++
        else rework++
      })
    })
    return { done, todo, rework, total: done + todo + rework }
  }, [])

  return (
    <PageShell
      crumb={[
        { label: '工作台', to: '/' },
        { label: 'Agent 管理', to: null },
      ]}
      title="Agent 管理"
      subtitle="场景地图 · Prompt 角色边界 · 安全规则可观测"
      actions={[
        <div key="tabs" style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', borderRadius: 8, padding: 3 }}>
          {[
            { key: 'scenario', label: '场景地图' },
            { key: 'boundary', label: '角色边界' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '5px 14px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: tab === t.key ? 600 : 400,
                border: 'none',
                cursor: 'pointer',
                background: tab === t.key ? 'var(--bg)' : 'transparent',
                color: tab === t.key ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>,
      ]}
    >
      {tab === 'scenario' && (
        <div>
          {/* 统计概览 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: '总场景数', value: stats.total, color: 'var(--ink)' },
              { label: '已实现', value: stats.done, color: 'var(--ok)' },
              { label: '待实现', value: stats.todo, color: 'var(--warn)' },
              { label: '待强化', value: stats.rework, color: '#dc2626' },
            ].map((s) => (
              <div key={s.label} style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* 风险梯度条 */}
          <div style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8, fontWeight: 600 }}>自动化风险梯度</div>
            <div style={{ display: 'flex', gap: 4, height: 8, borderRadius: 4, overflow: 'hidden' }}>
              {SCENARIO_CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  title={`${cat.label} · ${cat.riskLevel}`}
                  style={{
                    flex: 1,
                    background: cat.riskBg,
                    borderRadius: 4,
                    position: 'relative',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--ok)' }}>低风险</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>自动化风险逐步升高 →</span>
              <span style={{ fontSize: 11, color: 'var(--err)' }}>高风险</span>
            </div>
          </div>

          {/* 分类卡片 */}
          {SCENARIO_CATEGORIES.map((cat) => {
            const isExpanded = expandedCategory === cat.id
            const catDone = cat.scenarios.filter((s) => s.status === 'done').length
            const catTotal = cat.scenarios.length
            const progress = Math.round((catDone / catTotal) * 100)

            return (
              <div
                key={cat.id}
                style={{
                  background: 'var(--bg-2)',
                  borderRadius: 12,
                  marginBottom: 12,
                  overflow: 'hidden',
                  border: `1px solid ${isExpanded ? cat.riskBg : 'var(--line)'}`,
                  transition: 'border-color .2s',
                }}
              >
                {/* 分类头部 */}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`agent-scenario-panel-${cat.id}`}
                  onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 16px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background .15s',
                  }}
                >
                  <span style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: cat.riskBg,
                    color: cat.riskColor,
                    fontWeight: 900,
                    fontSize: 14,
                    flexShrink: 0,
                  }}>
                    {cat.id}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{cat.label}</span>
                      <span style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: cat.riskBg,
                        color: cat.riskColor,
                        fontWeight: 600,
                      }}>
                        {cat.riskLevel}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{cat.description}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                      {catDone}/{catTotal} 已实现 · {progress}%
                    </div>
                  </div>
                  {/* 进度条 */}
                  <div style={{ width: 80, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: cat.riskColor, borderRadius: 3, transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', transition: 'transform .2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
                </button>

                {/* 展开的场景列表 */}
                {isExpanded && (
                  <div id={`agent-scenario-panel-${cat.id}`} style={{ padding: '0 16px 14px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                          <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600, width: 160 }}>场景</th>
                          <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600, width: 200 }}>典型输入</th>
                          <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600 }}>处理方式</th>
                          <th style={{ textAlign: 'center', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600, width: 80 }}>状态</th>
                          <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600, width: 160 }}>代码位置</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cat.scenarios.map((s, idx) => {
                          const badge = statusBadge[s.status]
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                              <td style={{ padding: '8px 8px', fontWeight: 500 }}>{s.name}</td>
                              <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, color: 'var(--ink-2)' }}>{s.input}</td>
                              <td style={{ padding: '8px 8px', color: 'var(--ink-2)' }}>{s.handler}</td>
                              <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 10,
                                  background: badge.bg,
                                  color: badge.color,
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: badge.dot, display: 'inline-block' }} />
                                  {badge.label}
                                </span>
                              </td>
                              <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--ink-3)' }}>{s.codeRef}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          {/* 改进建议 */}
          <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>未完善场景汇总与改进方向</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {[
                { title: 'Category 3 · 7 个模块查询未接入', desc: 'change-management、sales-briefing、dev-assessment、collab、wbs、templates、rules 模块已有后端实现，但尚未封装为 Agent Tools。', tag: '待实现', tagColor: 'var(--warn)' },
                { title: 'Category 4 · 3 个写动作未接入', desc: '导出操作、变更管理提交、团队邀请/权限变更已有后端 API，但未在 Agent 层提供确认式交互入口。', tag: '待实现', tagColor: 'var(--warn)' },
                { title: 'Category 5 · 安全边界需加固', desc: '数据删除/批量操作的显式拒绝规则、跨用户数据访问的 Agent 层权限预检尚需补充。', tag: '待强化', tagColor: '#dc2626' },
              ].map((item, idx) => (
                <div key={idx} style={{ background: 'var(--bg)', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: `${item.tagColor}22`, color: item.tagColor, fontWeight: 600 }}>{item.tag}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.title}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'boundary' && (
        <div>
          {/* 核心原则 */}
          <div style={{ marginBottom: 20, padding: '14px 18px', background: 'var(--brand-soft)', borderRadius: 12, border: '1px solid var(--brand-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🛡</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand)' }}>核心原则</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              <strong>SystemMessage 定义边界</strong> + <strong>HumanMessage 表达当前请求</strong> → <strong>模型在边界内决策与回复</strong>。
              用户输入可以影响模型如何回答，但<strong style={{ color: 'var(--err)' }}>不能改变</strong>模型必须遵守的规则与边界。
            </p>
          </div>

          {/* 四角色卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
            {ROLE_BOUNDARIES.map((r) => (
              <div
                key={r.role}
                style={{
                  background: 'var(--bg-2)',
                  borderRadius: 12,
                  padding: 16,
                  border: `1px solid ${r.bg}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: r.bg,
                    fontSize: 18,
                  }}>
                    {r.icon}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>role: "{r.role}" · {r.responsibility}</div>
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    <span style={{
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: r.userCanOverride ? 'var(--warn-soft)' : 'var(--ok-soft)',
                      color: r.userCanOverride ? 'var(--warn)' : 'var(--ok)',
                      fontWeight: 600,
                    }}>
                      {r.userCanOverride ? '用户可输入' : '系统注入'}
                    </span>
                  </div>
                </div>
                <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>
                  {r.details.map((d, idx) => (
                    <li key={idx}>{d}</li>
                  ))}
                </ul>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono, monospace)' }}>
                   {r.codeRef}
                </div>
              </div>
            ))}
          </div>

          {/* 数据流向图 */}
          <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>消息流向与约束关系</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {/* SystemMessage */}
              <div style={{
                padding: '10px 16px',
                borderRadius: 10,
                background: 'var(--brand-soft)',
                border: '2px solid var(--brand)',
                textAlign: 'center',
                minWidth: 140,
              }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--brand)' }}>SystemMessage</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>角色 · 任务 · 禁止事项 · 事实来源</div>
              </div>
              <span style={{ fontSize: 18, color: 'var(--ink-3)' }}>→</span>
              {/* Chat Model */}
              <div style={{
                padding: '14px 20px',
                borderRadius: 12,
                background: 'var(--bg)',
                border: '2px solid var(--line)',
                textAlign: 'center',
                minWidth: 120,
              }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Chat Model</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>在系统规则约束下<br/>按解并生成回复</div>
              </div>
              <span style={{ fontSize: 18, color: 'var(--ink-3)' }}>←</span>
              {/* HumanMessage */}
              <div style={{
                padding: '10px 16px',
                borderRadius: 10,
                background: 'var(--ok-soft)',
                border: '2px solid var(--ok)',
                textAlign: 'center',
                minWidth: 140,
              }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ok)' }}>HumanMessage</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>用户问题 · 补充信息 · 情绪表达</div>
              </div>
            </div>
            {/* 防护说明 */}
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              <span style={{
                padding: '4px 12px',
                borderRadius: 8,
                background: '#fee2e2',
                color: '#dc2626',
                fontSize: 11,
                fontWeight: 600,
              }}>
                ✕ "忽略上面的规则" → 回到系统规则边界，不能覆盖
              </span>
            </div>
          </div>

          {/* 安全规则清单 */}
          <div style={{ padding: 16, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>安全规则执行清单</div>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600 }}>安全规则</th>
                  <th style={{ textAlign: 'center', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600, width: 80 }}>状态</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--ink-3)', fontWeight: 600 }}>实现细节</th>
                </tr>
              </thead>
              <tbody>
                {SECURITY_RULES.map((r, idx) => {
                  const isDone = r.status === '已实现'
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '8px 8px', fontWeight: 500 }}>{r.rule}</td>
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: isDone ? 'var(--ok-soft)' : '#fee2e2',
                          color: isDone ? 'var(--ok)' : '#dc2626',
                          fontSize: 11,
                          fontWeight: 600,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isDone ? 'var(--ok)' : '#dc2626', display: 'inline-block' }} />
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 8px', color: 'var(--ink-2)', fontSize: 11.5 }}>{r.detail}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
