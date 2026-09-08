import { apiClient } from './client.js'
import { unwrap } from './utils.js'

// ============================================================
// 基础管理 · 行业主数据 API 访问层（批次 10a）
// ============================================================
// 口径（AGENTS.md §7）：页面不直拼散乱请求，统一经本层。
//
// 本层**不提供任何删除函数**——行业主数据禁止硬删（历史记录按名称文本
// 引用行业），唯一允许的「下线」动作是停用。后端对 DELETE 一律回 405，
// 前端连入口都不给，避免用户以为「点了没反应是 bug」。

const BASE = '/master-data/industries'

/** 两层树（含停用项），管理页列表用。 */
export async function listIndustryTree() {
  return unwrap(await apiClient.get(`${BASE}/tree`), 'items') ?? []
}

/** 新建单据的行业下拉选项：只含启用项，父停用则子也不出。 */
export async function listIndustryOptions() {
  return unwrap(await apiClient.get(`${BASE}/options`), 'items') ?? []
}

export async function createIndustryCategory({ name, sortOrder }) {
  return unwrap(await apiClient.post(`${BASE}/categories`, { name, sortOrder }), 'category')
}

export async function updateIndustryCategory(id, patch) {
  return unwrap(await apiClient.patch(`${BASE}/categories/${id}`, patch), 'category')
}

export async function setIndustryCategoryStatus(id, status) {
  return unwrap(await apiClient.post(`${BASE}/categories/${id}/status`, { status }), 'row')
}

export async function createIndustrySubcategory({ categoryId, name, sortOrder }) {
  return unwrap(await apiClient.post(`${BASE}/subcategories`, { categoryId, name, sortOrder }), 'subcategory')
}

export async function updateIndustrySubcategory(id, patch) {
  return unwrap(await apiClient.patch(`${BASE}/subcategories/${id}`, patch), 'subcategory')
}

export async function setIndustrySubcategoryStatus(id, status) {
  return unwrap(await apiClient.post(`${BASE}/subcategories/${id}/status`, { status }), 'row')
}
