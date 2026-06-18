/**
 * VCS 状态机映射 — 供 VersionRecord 系列表共用
 *
 * 后端返回的 checkoutStatus + versionDocStatus / status 组合
 * → 前端中文状态标签（与 ListPage filterTags 对齐）
 *
 * @param {Object} record
 * @param {string} [record.checkoutStatus]      — 'checked_out' | 'checked_in'
 * @param {string} [record.versionDocStatus]    — 'reviewed' | 'drafting' | ...
 * @param {string} [record.status]              — 可能直接是中文或英文枚举
 * @returns {string} 中文状态
 */
export function mapVcsStatus(record = {}) {
  // 若后端已返回中文状态，优先透传（防御性）
  const knownStatuses = new Set([
    '已检出', '已检入', '进行中', '待评审', '已归档',
    '已发布', '评审中', '已通过', '驳回', '已完成',
  ])
  if (knownStatuses.has(record.status)) return record.status

  // VCS 机状态映射
  if (record.checkoutStatus === 'checked_out') return '已检出'
  if (record.checkoutStatus === 'checked_in') {
    if (record.versionDocStatus === 'reviewed') return '已检入'
    if (record.versionDocStatus === 'drafting') return '进行中'
  }
  if (record.status === 'archived') return '已归档'

  return '进行中'
}
