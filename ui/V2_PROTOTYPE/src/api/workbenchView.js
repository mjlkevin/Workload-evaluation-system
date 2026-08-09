// ============================================================
// Workbench 统一视图 API 客户端（O5 Sprint 3A）
// ============================================================
// 封装 GET /api/v1/ai/home-workbench/view

import { apiClient } from './client.js'
import { unwrap } from './utils'

/**
 * 获取工作台统一视图。
 * 返回 { sessions, runs, tasks, artifacts, failedRuns }
 * 任何失败都抛错，由调用方处理。
 */
export async function getWorkbenchView() {
  const payload = await apiClient.get('/ai/home-workbench/view', undefined, {
    suppressUnauthorizedRedirect: true,
  })
  return unwrap(payload)
}
