export const SYSTEM_MANAGEMENT_SECTIONS = [
  { id: 'rules', route: '/system/code-rules', label: '编码规则', icon: '#', subtitle: '版本号编码规则管理' },
  { id: 'model', route: '/system/model-config', label: '模型配置', icon: 'M', subtitle: '接入模型供应商、绑定业务场景并按模型能力配置参数' },
  { id: 'kb', route: '/system/knowledge-base', label: '知识库', icon: 'K', subtitle: '智谱知识库接入与连通性验证' },
  { id: 'kbRetrieval', route: '/system/kb-retrieval', label: '检索诊断', icon: '检', subtitle: '本地知识库中文检索基线诊断与试查' },
  { id: 'rate', route: '/system/rate-card', label: 'RateCard', icon: 'R', subtitle: '角色人天单价与成本基准' },
  { id: 'dsl', route: '/system/dsl-rules', label: 'DSL 规则集', icon: 'D', subtitle: '实施评估依赖规则管理' },
  { id: 'tpl', route: '/system/templates', label: '模板', icon: 'T', subtitle: '评估模板与复用资产管理' },
  { id: 'testResults', route: '/system/test-results', label: '测试结果', icon: '✓', subtitle: '人工测试结果登记与追踪' },
  { id: 'sessions', route: '/system/sessions', label: '会话管理', icon: 'S', subtitle: '全量用户 AI 会话审计与跟踪' },
  { id: 'memory', route: '/system/memory', label: '记忆管理', icon: '忆', subtitle: 'AI 工作台跨会话记忆查看与确认' },
  { id: 'tools', route: '/system/tools', label: '工具清单', icon: '⚒', subtitle: 'AI 工作台可调用工具与权限位一览' },
]

export const DEFAULT_SYSTEM_MANAGEMENT_ROUTE = SYSTEM_MANAGEMENT_SECTIONS[0].route

// 只做跳转、本身不渲染内容的父路由 → 它指向的默认子页。
// App.jsx 的 <Route element={<Navigate replace/>} /> 和页签条共用这一份事实，
// 不在两处各写一遍路由。
export const SYSTEM_MANAGEMENT_PARENT_ROUTE = '/system'

export const ROUTE_REDIRECTS = {
  [SYSTEM_MANAGEMENT_PARENT_ROUTE]: DEFAULT_SYSTEM_MANAGEMENT_ROUTE,
}

export function getSystemManagementSectionById(id) {
  return SYSTEM_MANAGEMENT_SECTIONS.find((section) => section.id === id) || SYSTEM_MANAGEMENT_SECTIONS[0]
}
