// ============================================================
// 【基础管理】子项清单（批次 10a）
// ============================================================
// 形状与 systemManagementSections.js 一致，导航/路由/页签三处共用这一份事实。
//
// 与【系统管理】的分界（本批立规，后续批次照此判）：
//   基础管理 = 业务记录会引用的主数据（被引用、有启用/停用、禁止硬删）
//   系统管理 = 系统怎么运转的配置（影响系统行为、走草稿→生效版本机制）
// 因此：行业进这里；模型配置、模板、DSL 规则集、RateCard、编码规则留在系统管理。
//
// 本批只装新东西：不把系统管理下任何既有子项搬进来。编码规则 / RateCard
// 的归属边界确实模糊，但那是另开议题单独裁，现在搬只是白折腾且有风险。

export const BASE_MANAGEMENT_SECTIONS = [
  {
    id: 'industries',
    route: '/base-data/industries',
    label: '行业',
    icon: '行',
    subtitle: '行业主数据（一级大类 + 二级细分），供业务单据引用；只停用不硬删',
  },
]

export const DEFAULT_BASE_MANAGEMENT_ROUTE = BASE_MANAGEMENT_SECTIONS[0].route

// 只做跳转、本身不渲染内容的父路由 → 它指向的默认子页。
// App.jsx 的 <Route element={<Navigate replace/>} /> 与页签条共用这一份事实。
export const BASE_MANAGEMENT_PARENT_ROUTE = '/base-data'

// 与 systemManagementSections.js 的 ROUTE_REDIRECTS 平行：各管理区各自登记
// 自己的父路由跳转，不合并进对方那份——归属分界是本批立的规矩。
export const BASE_MANAGEMENT_ROUTE_REDIRECTS = {
  [BASE_MANAGEMENT_PARENT_ROUTE]: DEFAULT_BASE_MANAGEMENT_ROUTE,
}

export function getBaseManagementSectionById(id) {
  return BASE_MANAGEMENT_SECTIONS.find((section) => section.id === id) || BASE_MANAGEMENT_SECTIONS[0]
}
