import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SYSTEM_MANAGEMENT_ROUTE,
  LEGACY_SYSTEM_MANAGEMENT_ROUTE_REDIRECTS,
  ROUTE_REDIRECTS,
  SYSTEM_MANAGEMENT_GROUPS,
  SYSTEM_MANAGEMENT_PARENT_ROUTE,
  SYSTEM_MANAGEMENT_SECTIONS,
  getSystemManagementGroupById,
  getSystemManagementSectionsByGroup,
} from '../config/systemManagementSections.js'

// 系统管理三级 URL 的「一处登记三处消费」事实源约束：
// App.jsx 路由、WorkspaceTabs/Shell 页签、旧路由重定向都从这份配置派生，
// 这里钉住配置本身的完整性——改分组/子页时先在这里红。

describe('systemManagementSections 分组配置一致性', () => {
  test('每个子页的 groupId 必须在分组表中登记', () => {
    const groupIds = new Set(SYSTEM_MANAGEMENT_GROUPS.map((g) => g.id))
    for (const section of SYSTEM_MANAGEMENT_SECTIONS) {
      expect(groupIds.has(section.groupId), `${section.id} 的分组 ${section.groupId} 未登记`).toBe(true)
    }
  })

  test('每组子页 route 唯一且为三级 /system/{group}/{slug}', () => {
    const routes = SYSTEM_MANAGEMENT_SECTIONS.map((s) => s.route)
    expect(new Set(routes).size).toBe(routes.length)
    for (const section of SYSTEM_MANAGEMENT_SECTIONS) {
      expect(section.route).toMatch(new RegExp(`^/system/${section.groupId}/[a-z-]+$`))
    }
  })

  test('旧扁平路由重定向全覆盖：11 条旧址全部指向存在的三级新址', () => {
    const knownRoutes = new Set(SYSTEM_MANAGEMENT_SECTIONS.map((s) => s.route))
    for (const [legacy, target] of Object.entries(LEGACY_SYSTEM_MANAGEMENT_ROUTE_REDIRECTS)) {
      expect(legacy).toMatch(/^\/system\/[a-z-]+$/)
      expect(knownRoutes.has(target), `旧址 ${legacy} 指向了不存在的 ${target}`).toBe(true)
    }
    // 阶段 2 之前的 11 个扁平子页一条都不能少
    expect(Object.keys(LEGACY_SYSTEM_MANAGEMENT_ROUTE_REDIRECTS).sort()).toEqual([
      '/system/code-rules',
      '/system/dsl-rules',
      '/system/kb-retrieval',
      '/system/knowledge-base',
      '/system/memory',
      '/system/model-config',
      '/system/rate-card',
      '/system/sessions',
      '/system/templates',
      '/system/test-results',
      '/system/tools',
    ].sort())
  })

  test('ROUTE_REDIRECTS 覆盖父路由与全部分组父路由，目标均为真实子页', () => {
    const knownRoutes = new Set(SYSTEM_MANAGEMENT_SECTIONS.map((s) => s.route))
    expect(ROUTE_REDIRECTS[SYSTEM_MANAGEMENT_PARENT_ROUTE]).toBe(DEFAULT_SYSTEM_MANAGEMENT_ROUTE)
    for (const group of SYSTEM_MANAGEMENT_GROUPS) {
      const target = ROUTE_REDIRECTS[group.route]
      expect(target, `分组父路由 ${group.route} 缺少默认子页跳转`).toBeTruthy()
      expect(knownRoutes.has(target)).toBe(true)
      expect(target.startsWith(`${group.route}/`)).toBe(true)
    }
    // 分组父路由不得与任何子页 route 冲突（否则跳转会把子页吞掉）
    for (const section of SYSTEM_MANAGEMENT_SECTIONS) {
      expect(ROUTE_REDIRECTS[section.route]).toBeUndefined()
    }
  })

  test('默认子页 = 第一个分组的第一个子页；helper 按组过滤一致', () => {
    const firstGroup = SYSTEM_MANAGEMENT_GROUPS[0]
    expect(DEFAULT_SYSTEM_MANAGEMENT_ROUTE).toBe(getSystemManagementSectionsByGroup(firstGroup.id)[0].route)
    expect(getSystemManagementGroupById(firstGroup.id).label).toBe(firstGroup.label)
    // 「状态机规则」子页必须存在且归属规则与标准分组
    const stateMachines = SYSTEM_MANAGEMENT_SECTIONS.find((s) => s.id === 'stateMachines')
    expect(stateMachines).toBeTruthy()
    expect(stateMachines.route).toBe('/system/rules/state-machines')
  })
})
