// ============================================================
// 系统管理信息架构 · 三级 URL 单一事实源
// ============================================================
// 一处登记三处消费：App.jsx 路由 / WorkspaceTabs+Shell 页签 / 旧路由重定向
// 都从本文件派生，不在各处复制路由表（同 baseManagementSections.js 模式）。
//
// 结构：/system/{group}/{section}
//  · 分组表 SYSTEM_MANAGEMENT_GROUPS 决定一级页签与分组父路由跳转；
//  · 子页表 SYSTEM_MANAGEMENT_SECTIONS 挂 groupId，二级即组内子页签；
//  · 旧扁平路由（批次 10a 前的 11 条）全量登记重定向，外部 Agent、
//    文档、书签不断链——删一条都会在 systemManagementSections.test.js 红。
// ============================================================

export const SYSTEM_MANAGEMENT_GROUPS = [
  { id: 'rules', label: '规则与标准', route: '/system/rules' },
  { id: 'ai', label: 'AI 与模型', route: '/system/ai' },
  { id: 'ops', label: '运行与审计', route: '/system/ops' },
]

export const SYSTEM_MANAGEMENT_SECTIONS = [
  // —— 规则与标准 ——
  { id: 'rules', groupId: 'rules', route: '/system/rules/code-rules', label: '编码规则', icon: '#', subtitle: '版本号编码规则管理' },
  { id: 'dsl', groupId: 'rules', route: '/system/rules/dsl-rules', label: 'DSL 规则集', icon: 'D', subtitle: '实施评估依赖规则管理' },
  { id: 'rate', groupId: 'rules', route: '/system/rules/rate-card', label: 'RateCard', icon: 'R', subtitle: '角色人天单价与成本基准' },
  { id: 'tpl', groupId: 'rules', route: '/system/rules/templates', label: '模板', icon: 'T', subtitle: '评估模板与复用资产管理' },
  { id: 'stateMachines', groupId: 'rules', route: '/system/rules/state-machines', label: '状态机规则', icon: '⇄', subtitle: '业务对象状态流转与版本文档管理规则（只读可视化，真源在后端目录）' },
  // —— AI 与模型 ——
  { id: 'model', groupId: 'ai', route: '/system/ai/model-config', label: '模型配置', icon: 'M', subtitle: '接入模型供应商、绑定业务场景并按模型能力配置参数' },
  { id: 'kb', groupId: 'ai', route: '/system/ai/knowledge-base', label: '知识库', icon: 'K', subtitle: '智谱知识库接入与连通性验证' },
  { id: 'kbRetrieval', groupId: 'ai', route: '/system/ai/kb-retrieval', label: '检索诊断', icon: '检', subtitle: '本地知识库中文检索基线诊断与试查' },
  { id: 'tools', groupId: 'ai', route: '/system/ai/tools', label: '工具策略', icon: '⚒', subtitle: 'AI 工具清单（代码派生·只读）与启用/可见/审批/注入策略' },
  { id: 'memory', groupId: 'ai', route: '/system/ai/memory', label: '记忆管理', icon: '忆', subtitle: 'AI 工作台跨会话记忆查看与确认' },
  // —— 运行与审计 ——
  { id: 'sessions', groupId: 'ops', route: '/system/ops/sessions', label: '会话管理', icon: 'S', subtitle: '跨用户 AI 会话审计与跟踪' },
  { id: 'testResults', groupId: 'ops', route: '/system/ops/test-results', label: '测试结果', icon: '✓', subtitle: '人工测试结果登记与追踪' },
]

export const DEFAULT_SYSTEM_MANAGEMENT_ROUTE = SYSTEM_MANAGEMENT_SECTIONS[0].route

// 只做跳转、本身不渲染内容的父路由 → 它指向的默认子页。
// App.jsx 的 <Route element={<Navigate replace/>} /> 和页签条共用这一份事实，
// 不在两处各写一遍路由。
export const SYSTEM_MANAGEMENT_PARENT_ROUTE = '/system'

// 三级重排前的 11 条扁平旧址 → 对应三级新址（旧址末段不变，只插入分组段）
export const LEGACY_SYSTEM_MANAGEMENT_ROUTE_REDIRECTS = {
  '/system/code-rules': '/system/rules/code-rules',
  '/system/model-config': '/system/ai/model-config',
  '/system/knowledge-base': '/system/ai/knowledge-base',
  '/system/kb-retrieval': '/system/ai/kb-retrieval',
  '/system/rate-card': '/system/rules/rate-card',
  '/system/dsl-rules': '/system/rules/dsl-rules',
  '/system/templates': '/system/rules/templates',
  '/system/test-results': '/system/ops/test-results',
  '/system/sessions': '/system/ops/sessions',
  '/system/memory': '/system/ai/memory',
  '/system/tools': '/system/ai/tools',
}

// 分组父路由 → 组内第一个子页
const GROUP_PARENT_REDIRECTS = Object.fromEntries(
  SYSTEM_MANAGEMENT_GROUPS.map((group) => [
    group.route,
    SYSTEM_MANAGEMENT_SECTIONS.find((section) => section.groupId === group.id).route,
  ]),
)

export const ROUTE_REDIRECTS = {
  [SYSTEM_MANAGEMENT_PARENT_ROUTE]: DEFAULT_SYSTEM_MANAGEMENT_ROUTE,
  ...GROUP_PARENT_REDIRECTS,
  ...LEGACY_SYSTEM_MANAGEMENT_ROUTE_REDIRECTS,
}

export function getSystemManagementSectionById(id) {
  return SYSTEM_MANAGEMENT_SECTIONS.find((section) => section.id === id) || SYSTEM_MANAGEMENT_SECTIONS[0]
}

export function getSystemManagementGroupById(id) {
  return SYSTEM_MANAGEMENT_GROUPS.find((group) => group.id === id) || SYSTEM_MANAGEMENT_GROUPS[0]
}

export function getSystemManagementSectionsByGroup(groupId) {
  return SYSTEM_MANAGEMENT_SECTIONS.filter((section) => section.groupId === groupId)
}
